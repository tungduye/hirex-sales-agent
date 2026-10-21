-- 122: Tương tác chiến dịch (Zalo / Facebook cá nhân) for Soda.
-- 1) campaign_reply_insights: what the candidate meant after replying to a campaign (Quan tâm / Không quan tâm /
--    Chưa rõ), written by the server's AI reader and read again only when the candidate has written something new.
-- 2) campaign_interaction_rows: one row per candidate who replied: campaign, owner, nick, whether the nick answered
--    afterwards, CV file received, Luồng Rec result, the AI reading.
-- 3) campaign_account_progress: per campaign and sending nick, how many of the candidates were reached so far.
-- 4) campaign_replies_to_classify: replies the AI has not read yet (or that changed since).
-- Server only (service role); the Trợ lý checks the member's permission and nicks before showing anything.
begin;

create table public.campaign_reply_insights (
  recipient_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  interest text not null,
  reason text,
  last_inbound_at timestamptz not null,
  classified_at timestamptz not null default now(),
  constraint campaign_reply_insights_recipient_fk foreign key (recipient_id, workspace_id) references public.channel_campaign_recipients(id, workspace_id) on delete cascade,
  constraint campaign_reply_insights_interest_allowed check (interest in ('QUAN_TAM', 'KHONG_QUAN_TAM', 'CHUA_RO')),
  constraint campaign_reply_insights_reason_length check (reason is null or char_length(reason) <= 300)
);
create index campaign_reply_insights_workspace on public.campaign_reply_insights(workspace_id, interest);
alter table public.campaign_reply_insights enable row level security;
revoke all on public.campaign_reply_insights from anon, authenticated;
grant all on public.campaign_reply_insights to service_role;

create or replace function public.campaign_interaction_rows(p_workspace_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table(
  recipient_id uuid, campaign_id uuid, campaign_name text, campaign_status text, owner_name text, campaign_type text,
  channel_type text, channel_account_id uuid, conversation_id uuid, contact_id uuid, candidate_name text,
  replied_at timestamptz, first_reply text, owner_replied_at timestamptz, owner_messages integer,
  inbound_messages integer, last_inbound_at timestamptz, last_inbound_text text, cv_file text,
  rec_outcome text, rec_step smallint, interest text, interest_reason text)
language sql stable security definer set search_path = '' as $$
  select r.id, c.id, c.name, c.status, c.owner_name, c.campaign_type,
    m.channel_type, m.channel_account_id, m.conversation_id, r.contact_id,
    coalesce(nullif(btrim(conv.metadata->>'participantDisplayName'), ''), nullif(btrim(conv.metadata->>'conversationDisplayName'), ''), ct.full_name),
    r.replied_at, left(m.text_content, 300), o.first_at, coalesce(o.total, 0)::integer,
    coalesce(i.total, 0)::integer, i.last_at, left(i.last_text, 300), f.filename,
    s.outcome, s.step, ins.interest, ins.reason
  from public.channel_campaign_recipients r
  join public.channel_campaigns c on c.id = r.campaign_id and c.workspace_id = r.workspace_id
  join public.omnichannel_messages m on m.id = r.source_message_id and m.workspace_id = r.workspace_id
  join public.omnichannel_conversations conv on conv.id = m.conversation_id and conv.workspace_id = m.workspace_id
  left join public.contacts ct on ct.id = r.contact_id and ct.workspace_id = r.workspace_id
  -- The nick's answers after the candidate replied (typed by the owner, Hola/Hole or AI Recruiter).
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
  -- A CV: a PDF/Word file, or any file named CV/resume, from the candidate after the reply.
  left join lateral (
    select a->>'filename' as filename
    from public.omnichannel_messages x
    cross join lateral jsonb_array_elements(case when jsonb_typeof(x.metadata->'attachments') = 'array' then x.metadata->'attachments' else '[]'::jsonb end) a
    where x.workspace_id = r.workspace_id and x.conversation_id = m.conversation_id and x.direction = 'INBOUND' and x.created_at >= m.created_at and x.attachment_count > 0
      and (coalesce(a->>'filename', '') ~* '\.(pdf|docx?)$' or coalesce(a->>'filename', '') ~* '(^|[^[:alnum:]])(cv|resume)([^[:alnum:]]|$)'
        or lower(coalesce(a->>'contentType', '')) in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
    order by x.created_at limit 1
  ) f on true
  left join lateral (
    select st.outcome, st.step from public.candidate_flow_states st
    where st.workspace_id = r.workspace_id and ((r.contact_id is not null and st.contact_id = r.contact_id) or (st.contact_id is null and st.conversation_id = m.conversation_id))
    order by st.updated_at desc limit 1
  ) s on true
  left join public.campaign_reply_insights ins on ins.recipient_id = r.id
  where r.workspace_id = p_workspace_id and r.status = 'REPLIED'
    and (p_from is null or r.replied_at >= p_from) and (p_to is null or r.replied_at < p_to);
$$;

create or replace function public.campaign_account_progress(p_workspace_id uuid)
returns table(
  campaign_id uuid, campaign_name text, campaign_status text, owner_name text, campaign_type text, started_at timestamptz,
  daily_limit integer, channel_account_id uuid, recipients integer, reached integer, replied integer, waiting integer,
  failed integer, unknown integer, stopped integer, messages_sent integer, sent_24h integer, sent_7d integer, last_sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with camp as (
    select c.id, c.name, c.status, c.owner_name, c.campaign_type, c.started_at, c.daily_message_limit
    from public.channel_campaigns c
    where c.workspace_id = p_workspace_id and c.archived_at is null and c.status <> 'DRAFT'
  ), senders as (
    select s.campaign_id, array_agg(s.channel_account_id order by s.priority) as ids
    from public.channel_campaign_senders s join camp on camp.id = s.campaign_id
    where s.workspace_id = p_workspace_id group by s.campaign_id
  ), people as (
    -- Each candidate belongs to the nick that sent them the first message; not reached yet = the only nick of the campaign.
    select r.campaign_id, r.status,
      coalesce(first_step.account_id, case when cardinality(se.ids) = 1 then se.ids[1] end) as account_id,
      first_step.account_id is not null as reached
    from public.channel_campaign_recipients r
    join camp on camp.id = r.campaign_id
    left join senders se on se.campaign_id = r.campaign_id
    left join lateral (
      select st.channel_account_id as account_id from public.channel_campaign_recipient_steps st
      where st.workspace_id = r.workspace_id and st.campaign_id = r.campaign_id and st.recipient_id = r.id and st.status = 'SENT'
      order by st.created_at limit 1
    ) first_step on true
    where r.workspace_id = p_workspace_id
  ), counted as (
    select p.campaign_id, p.account_id, count(*) as recipients, count(*) filter (where p.reached) as reached,
      count(*) filter (where p.status = 'REPLIED') as replied, count(*) filter (where p.status = 'ACTIVE' and not p.reached) as waiting,
      count(*) filter (where p.status = 'FAILED') as failed, count(*) filter (where p.status = 'DELIVERY_UNKNOWN') as unknown,
      count(*) filter (where p.status = 'SUPPRESSED') as stopped
    from people p group by p.campaign_id, p.account_id
  ), sent as (
    select st.campaign_id, st.channel_account_id as account_id, count(*) as messages,
      count(*) filter (where coalesce(st.completed_at, st.updated_at) > now() - interval '24 hours') as day,
      count(*) filter (where coalesce(st.completed_at, st.updated_at) > now() - interval '7 days') as week,
      max(coalesce(st.completed_at, st.updated_at)) as last_at
    from public.channel_campaign_recipient_steps st join camp on camp.id = st.campaign_id
    where st.workspace_id = p_workspace_id and st.status = 'SENT' group by st.campaign_id, st.channel_account_id
  )
  select camp.id, camp.name, camp.status, camp.owner_name, camp.campaign_type, camp.started_at, camp.daily_message_limit,
    coalesce(counted.account_id, sent.account_id),
    coalesce(counted.recipients, 0)::integer, coalesce(counted.reached, 0)::integer, coalesce(counted.replied, 0)::integer, coalesce(counted.waiting, 0)::integer,
    coalesce(counted.failed, 0)::integer, coalesce(counted.unknown, 0)::integer, coalesce(counted.stopped, 0)::integer,
    coalesce(sent.messages, 0)::integer, coalesce(sent.day, 0)::integer, coalesce(sent.week, 0)::integer, sent.last_at
  from counted
  full join sent on sent.campaign_id = counted.campaign_id and sent.account_id is not distinct from counted.account_id
  join camp on camp.id = coalesce(counted.campaign_id, sent.campaign_id);
$$;

create or replace function public.campaign_replies_to_classify(p_limit integer default 40)
returns table(workspace_id uuid, recipient_id uuid, conversation_id uuid, reply_message_at timestamptz, last_inbound_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.workspace_id, r.id, m.conversation_id, m.created_at, latest.at
  from public.channel_campaign_recipients r
  join public.omnichannel_messages m on m.id = r.source_message_id and m.workspace_id = r.workspace_id
  cross join lateral (
    select max(x.created_at) as at from public.omnichannel_messages x
    where x.workspace_id = r.workspace_id and x.conversation_id = m.conversation_id and x.direction = 'INBOUND' and x.created_at >= m.created_at
  ) latest
  left join public.campaign_reply_insights ins on ins.recipient_id = r.id
  where r.status = 'REPLIED' and r.replied_at > now() - interval '90 days'
    and (ins.recipient_id is null or ins.last_inbound_at < latest.at)
  order by (ins.recipient_id is null) desc, r.replied_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 200);
$$;

revoke all on function public.campaign_interaction_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.campaign_account_progress(uuid) from public, anon, authenticated;
revoke all on function public.campaign_replies_to_classify(integer) from public, anon, authenticated;
grant execute on function public.campaign_interaction_rows(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.campaign_account_progress(uuid) to service_role;
grant execute on function public.campaign_replies_to_classify(integer) to service_role;

commit;
