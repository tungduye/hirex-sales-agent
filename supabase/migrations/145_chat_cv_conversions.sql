-- CV chuyển hóa: a candidate sent their CV in a Zalo / Facebook chat (one-to-one), counted once per conversation.
--   * Counted on nicks tuyển dụng (Phân loại nick → "Tuyển dụng") and in any chat that is a reply to a campaign.
--   * The file is recognised by its name (no AI reading): PDF / Word, or a name with CV / resume / hồ sơ / 履歴書…;
--     names that look like a JD, contract, minutes, process, quotation… are left out.
--   * Source: "MKT Zalo" when the candidate replied to a campaign before sending the CV (campaign kept), else chat.
--   * Luồng Rec moves to bước 8 with "Đã có CV". A member setting "Đã có CV" in Luồng Rec also counts.
-- Read by Tổng quan ("CV mới hôm nay"), Soda (cv_chuyen_hoa) and the campaign interactions.
begin;

create or replace function public.is_cv_file_name(p_name text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_name is null or btrim(p_name) = '' then false
    when public.vi_fold(p_name) ~ '(^|[^a-z0-9])(jd|job ?desc(ription)?|mo ta cong viec|contract|hop dong|hd|bien ban|quy trinh|bao gia|hoa don|invoice|proposal|nda|thanh ly|nghiem thu|lop ?[0-9]+|bai tap|thong bao)([^a-z0-9]|$)' then false
    when p_name ~* '\.(pdf|docx?)$' then true
    when public.vi_fold(p_name) ~ '(^|[^a-z0-9])(cv|resume|ho so)([^a-z0-9]|$)' or p_name ~ '(履歴書|職務経歴書|スキルシート)' then true
    else false end
$$;
grant execute on function public.is_cv_file_name(text) to authenticated, service_role;

create table if not exists public.chat_cv_conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  contact_id uuid,
  channel_account_id uuid not null,
  channel_type text not null,
  message_id uuid,
  file_name text not null,
  source text not null default 'FILE',
  first_cv_at timestamptz not null,
  campaign_id uuid,
  campaign_name text,
  created_at timestamptz not null default now(),
  constraint chat_cv_conversions_source check (source in ('FILE', 'REC_FLOW')),
  constraint chat_cv_conversions_channel check (channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE')),
  constraint chat_cv_conversions_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete cascade
);
create unique index if not exists chat_cv_conversions_conversation_key on public.chat_cv_conversions (workspace_id, conversation_id);
create index if not exists chat_cv_conversions_recent on public.chat_cv_conversions (workspace_id, first_cv_at desc);
create index if not exists chat_cv_conversions_nick on public.chat_cv_conversions (workspace_id, channel_account_id, first_cv_at desc);
alter table public.chat_cv_conversions enable row level security;
revoke all on public.chat_cv_conversions from anon, authenticated;
grant select on public.chat_cv_conversions to authenticated;
grant all on public.chat_cv_conversions to service_role;
drop policy if exists chat_cv_conversions_read on public.chat_cv_conversions;
create policy chat_cv_conversions_read on public.chat_cv_conversions for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.can_access_channel_account(channel_account_id));

-- Is this conversation a one-to-one chat (not a group)? Zalo groups also show up as someone else writing in the thread.
create or replace function public.chat_cv_is_one_to_one(p_conversation public.omnichannel_conversations, p_sender text)
returns boolean language sql stable set search_path = '' as $$
  select upper(coalesce(p_conversation.metadata->>'conversationKind', '')) <> 'GROUP' and upper(coalesce(p_conversation.metadata->>'threadType', '')) <> 'GROUP'
    and coalesce(p_conversation.metadata->>'isGroup', '') <> 'true' and coalesce(jsonb_typeof(p_conversation.metadata->'groupName'), '') <> 'string'
    and not (p_conversation.channel_type = 'ZALO' and p_sender is not null and p_sender is distinct from p_conversation.provider_conversation_id and p_sender <> 'system')
$$;

-- Records one conversion (first CV wins) and moves Luồng Rec to bước 8 · Đã có CV.
create or replace function public.record_chat_cv_conversion(p_workspace_id uuid, p_conversation_id uuid, p_message_id uuid, p_file text, p_at timestamptz, p_source text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_conversation public.omnichannel_conversations; v_campaign uuid; v_campaign_name text; v_inserted boolean := false;
begin
  select * into v_conversation from public.omnichannel_conversations where id = p_conversation_id and workspace_id = p_workspace_id;
  if not found or v_conversation.channel_type not in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE') then return false; end if;
  -- The campaign the candidate replied to before sending the CV (latest one).
  select r.campaign_id, c.name into v_campaign, v_campaign_name
  from public.channel_campaign_recipients r
  join public.omnichannel_messages m on m.id = r.source_message_id and m.workspace_id = r.workspace_id
  join public.channel_campaigns c on c.id = r.campaign_id and c.workspace_id = r.workspace_id
  where r.workspace_id = p_workspace_id and m.conversation_id = p_conversation_id and r.status = 'REPLIED' and coalesce(r.replied_at, m.created_at) <= p_at + interval '1 minute'
  order by coalesce(r.replied_at, m.created_at) desc limit 1;
  if v_campaign is null and not exists (select 1 from public.channel_accounts a where a.id = v_conversation.channel_account_id and a.candidate_facts_enabled) then return false; end if;
  insert into public.chat_cv_conversions (workspace_id, conversation_id, contact_id, channel_account_id, channel_type, message_id, file_name, source, first_cv_at, campaign_id, campaign_name)
  values (p_workspace_id, p_conversation_id, v_conversation.contact_id, v_conversation.channel_account_id, v_conversation.channel_type, p_message_id, left(p_file, 300), p_source, p_at, v_campaign, v_campaign_name)
  on conflict (workspace_id, conversation_id) do nothing
  returning true into v_inserted;
  if coalesce(v_inserted, false) and p_source = 'FILE' then
    if v_conversation.contact_id is not null then
      insert into public.candidate_flow_states (workspace_id, contact_id, conversation_id, step, outcome)
      values (p_workspace_id, v_conversation.contact_id, p_conversation_id, 8, 'CV_RECEIVED')
      on conflict (workspace_id, contact_id) where contact_id is not null do update set step = greatest(public.candidate_flow_states.step, 8), outcome = 'CV_RECEIVED';
    else
      insert into public.candidate_flow_states (workspace_id, conversation_id, step, outcome)
      values (p_workspace_id, p_conversation_id, 8, 'CV_RECEIVED')
      on conflict (workspace_id, conversation_id) where contact_id is null do update set step = greatest(public.candidate_flow_states.step, 8), outcome = 'CV_RECEIVED';
    end if;
  end if;
  return coalesce(v_inserted, false);
end $$;
revoke all on function public.record_chat_cv_conversion(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated;

-- A message from the candidate with a CV file.
create or replace function public.chat_cv_on_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_conversation public.omnichannel_conversations; v_file text;
begin
  select * into v_conversation from public.omnichannel_conversations where id = new.conversation_id and workspace_id = new.workspace_id;
  if not found or not public.chat_cv_is_one_to_one(v_conversation, new.sender_external_id) then return null; end if;
  select a->>'filename' into v_file
  from jsonb_array_elements(case when jsonb_typeof(new.metadata->'attachments') = 'array' then new.metadata->'attachments' else '[]'::jsonb end) a
  where public.is_cv_file_name(a->>'filename') limit 1;
  if v_file is null then return null; end if;
  perform public.record_chat_cv_conversion(new.workspace_id, new.conversation_id, new.id, v_file, new.created_at, 'FILE');
  return null;
exception when others then
  return null; -- counting must never stop a message from arriving
end $$;
revoke all on function public.chat_cv_on_message() from public, anon, authenticated;
drop trigger if exists chat_cv_on_message on public.omnichannel_messages;
create trigger chat_cv_on_message after insert on public.omnichannel_messages
for each row when (new.direction = 'INBOUND' and new.attachment_count > 0 and new.channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE'))
execute function public.chat_cv_on_message();

-- A member sets "Đã có CV" in Luồng Rec (CV received another way inside the chat): counts too, once.
create or replace function public.chat_cv_on_flow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_conversation uuid;
begin
  if new.outcome is distinct from 'CV_RECEIVED' or new.updated_by is null or (tg_op = 'UPDATE' and old.outcome is not distinct from 'CV_RECEIVED') then return null; end if;
  v_conversation := new.conversation_id;
  if v_conversation is null and new.contact_id is not null then
    select c.id into v_conversation from public.omnichannel_conversations c
    where c.workspace_id = new.workspace_id and c.contact_id = new.contact_id and c.channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE')
    order by c.last_message_at desc nulls last limit 1;
  end if;
  if v_conversation is not null then perform public.record_chat_cv_conversion(new.workspace_id, v_conversation, null, 'Luồng Rec: Đã có CV', now(), 'REC_FLOW'); end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.chat_cv_on_flow() from public, anon, authenticated;
drop trigger if exists chat_cv_on_flow on public.candidate_flow_states;
create trigger chat_cv_on_flow after insert or update of outcome on public.candidate_flow_states
for each row execute function public.chat_cv_on_flow();

-- A reply to a campaign marked a little later than the CV arrived: look for the CV once the reply is known.
create or replace function public.chat_cv_on_campaign_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status is distinct from 'REPLIED' or new.source_message_id is null or (tg_op = 'UPDATE' and old.status is not distinct from 'REPLIED') then return null; end if;
  select m.workspace_id, m.conversation_id, m.id, a->>'filename' as file, m.created_at into r
  from public.omnichannel_messages s
  join public.omnichannel_messages m on m.workspace_id = s.workspace_id and m.conversation_id = s.conversation_id and m.direction = 'INBOUND' and m.attachment_count > 0 and m.created_at >= s.created_at
  join public.omnichannel_conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(m.metadata->'attachments') = 'array' then m.metadata->'attachments' else '[]'::jsonb end) a
  where s.id = new.source_message_id and s.workspace_id = new.workspace_id and m.channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE')
    and public.is_cv_file_name(a->>'filename') and public.chat_cv_is_one_to_one(c, m.sender_external_id)
  order by m.created_at limit 1;
  if r.conversation_id is not null then perform public.record_chat_cv_conversion(r.workspace_id, r.conversation_id, r.id, r.file, r.created_at, 'FILE'); end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.chat_cv_on_campaign_reply() from public, anon, authenticated;
drop trigger if exists chat_cv_on_campaign_reply on public.channel_campaign_recipients;
create trigger chat_cv_on_campaign_reply after insert or update of status on public.channel_campaign_recipients
for each row execute function public.chat_cv_on_campaign_reply();

-- The last 90 days, as if the trigger had been there.
do $$
declare r record;
begin
  for r in
    select distinct on (m.conversation_id) m.workspace_id, m.conversation_id, m.id, a->>'filename' as file, m.created_at
    from public.omnichannel_messages m
    join public.omnichannel_conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(m.metadata->'attachments') = 'array' then m.metadata->'attachments' else '[]'::jsonb end) a
    where m.direction = 'INBOUND' and m.attachment_count > 0 and m.channel_type in ('ZALO', 'FACEBOOK', 'FACEBOOK_PROFILE') and m.created_at > now() - interval '90 days'
      and public.is_cv_file_name(a->>'filename') and public.chat_cv_is_one_to_one(c, m.sender_external_id)
    order by m.conversation_id, m.created_at
  loop
    perform public.record_chat_cv_conversion(r.workspace_id, r.conversation_id, r.id, r.file, r.created_at, 'FILE');
  end loop;
end $$;

-- Campaign interactions: "có CV" = the same CV chuyển hóa (after the reply).
create or replace function public.campaign_interaction_rows(p_workspace_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(recipient_id uuid, campaign_id uuid, campaign_name text, campaign_status text, owner_name text, campaign_type text, channel_type text, channel_account_id uuid, conversation_id uuid, contact_id uuid, candidate_name text, replied_at timestamp with time zone, first_reply text, owner_replied_at timestamp with time zone, owner_messages integer, inbound_messages integer, last_inbound_at timestamp with time zone, last_inbound_text text, cv_file text, rec_outcome text, rec_step smallint, interest text, interest_reason text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select r.id, c.id, c.name, c.status, c.owner_name, c.campaign_type,
    m.channel_type, m.channel_account_id, m.conversation_id, r.contact_id,
    coalesce(nullif(btrim(conv.metadata->>'participantDisplayName'), ''), nullif(btrim(conv.metadata->>'conversationDisplayName'), ''), ct.full_name),
    r.replied_at, left(m.text_content, 300), o.first_at, coalesce(o.total, 0)::integer,
    coalesce(i.total, 0)::integer, i.last_at, left(i.last_text, 300), f.file_name,
    s.outcome, s.step, ins.interest, ins.reason
  from public.channel_campaign_recipients r
  join public.channel_campaigns c on c.id = r.campaign_id and c.workspace_id = r.workspace_id
  join public.omnichannel_messages m on m.id = r.source_message_id and m.workspace_id = r.workspace_id
  join public.omnichannel_conversations conv on conv.id = m.conversation_id and conv.workspace_id = m.workspace_id
  left join public.contacts ct on ct.id = r.contact_id and ct.workspace_id = r.workspace_id
  left join lateral (
    select min(x.created_at) as first_at, count(*) as total from public.omnichannel_messages x
    where x.workspace_id = r.workspace_id and x.conversation_id = m.conversation_id and x.direction = 'OUTBOUND' and x.created_at > m.created_at
  ) o on true
  left join lateral (
    select count(*) as total, max(x.created_at) as last_at,
      (array_agg(x.text_content order by x.created_at desc) filter (where x.text_content is not null and btrim(x.text_content) <> ''))[1] as last_text
    from public.omnichannel_messages x
    where x.workspace_id = r.workspace_id and x.conversation_id = m.conversation_id and x.direction = 'INBOUND' and x.created_at >= m.created_at
  ) i on true
  left join public.chat_cv_conversions f on f.workspace_id = r.workspace_id and f.conversation_id = m.conversation_id and f.first_cv_at >= m.created_at - interval '1 minute'
  left join lateral (
    select st.outcome, st.step from public.candidate_flow_states st
    where st.workspace_id = r.workspace_id and ((r.contact_id is not null and st.contact_id = r.contact_id) or (st.contact_id is null and st.conversation_id = m.conversation_id))
    order by st.updated_at desc limit 1
  ) s on true
  left join public.campaign_reply_insights ins on ins.recipient_id = r.id
  where r.workspace_id = p_workspace_id and r.status = 'REPLIED'
    and (p_from is null or r.replied_at >= p_from) and (p_to is null or r.replied_at < p_to);
$function$;

commit;
