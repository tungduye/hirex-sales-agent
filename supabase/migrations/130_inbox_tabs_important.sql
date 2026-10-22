-- 130: Suối Nguồn đợt 1.
-- Tabs: All · Của tôi · Nhóm · Chưa trả lời · Quan trọng.
-- * Của tôi = conversations I own: assigned to me, or (one-to-one, not assigned) on a nick whose main user is me.
-- * Quan trọng = conversations marked important (metadata.important), shown in All too.
-- * E-mail from robots and the old "Khác" folder are left out of All / Của tôi / Nhóm, but found when searching.
-- * Ghim trong cá nhân: a pin only the member sees (inbox_personal_pins); "Ghim trong tất cả" is the shared pin.
-- * Phiên bản AI per conversation: metadata.aiRecruiterBotId (+ aiRecruiterBotSince) overrides the nick's bot.
begin;

-- The function gains two columns (important, nick); callers read columns by name.
drop function if exists public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer);
create function public.inbox_filtered_conversations(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_search text, p_assigned_to uuid, p_since timestamptz, p_before_at timestamptz, p_before_id uuid, p_chunk integer)
returns table(id uuid, sort_at timestamptz, assigned_to uuid, is_group boolean, is_other boolean, latest_direction text, is_important boolean, channel_account_id uuid)
language sql stable security invoker as $$
  select b.id, b.sort_at, b.assigned_to,
    coalesce(upper(coalesce(b.metadata->>'conversationKind', '')) = 'GROUP' or upper(coalesce(b.metadata->>'threadType', '')) = 'GROUP'
      or coalesce(b.metadata->>'isGroup', '') = 'true' or coalesce(jsonb_typeof(b.metadata->'groupName'), '') = 'string'
      or (b.channel_type = 'ZALO' and inbound.sender_external_id is not null and inbound.sender_external_id is distinct from b.provider_conversation_id
          and inbound.sender_external_id <> 'system'), false),
    coalesce(coalesce(b.metadata->>'folder', '') = 'OTHER' or (b.channel_type = 'EMAIL' and coalesce(public.inbox_is_automated_sender(latest.sender_external_id), false)), false),
    latest.direction,
    coalesce(b.metadata->>'important', '') = 'true',
    b.channel_account_id
  from (
    select c.id, coalesce(c.last_message_at, '-infinity'::timestamptz) as sort_at, c.assigned_to, c.metadata, c.channel_type, c.provider_conversation_id, c.workspace_id, c.channel_account_id
    from public.omnichannel_conversations c
    left join public.contacts ct on ct.id = c.contact_id
    where c.workspace_id = public.current_workspace_id()
      and c.channel_account_id = any(p_account_ids)
      and coalesce(c.metadata->>'hidden', '') <> 'true'
      and (p_assigned_to is null or c.assigned_to = p_assigned_to)
      and (p_since is null or c.last_message_at >= p_since)
      and (p_before_at is null or (coalesce(c.last_message_at, '-infinity'::timestamptz), c.id) < (p_before_at, p_before_id))
      and (p_channel_types is null or cardinality(p_channel_types) = 0 or c.channel_type = any(p_channel_types))
      and (coalesce(btrim(p_search), '') = '' or public.vi_fold(concat_ws(' ', c.subject, c.metadata->>'participantDisplayName',
        c.metadata->>'conversationDisplayName', c.metadata->>'groupName', c.metadata->>'threadName', c.metadata->>'displayName',
        c.provider_conversation_id, ct.full_name, ct.email, ct.phone)) like '%' || public.vi_fold(btrim(p_search)) || '%')
      and (p_tag_ids is null or cardinality(p_tag_ids) = 0 or (
        case when p_tag_mode = 'any'
          then exists (select 1 from public.conversation_tag_links l where l.conversation_id = c.id and l.tag_id = any(p_tag_ids))
          else (select count(*) from public.conversation_tag_links l where l.conversation_id = c.id and l.tag_id = any(p_tag_ids)) = cardinality(p_tag_ids)
        end))
      and ((p_first_from is null and p_first_to is null) or exists (
        select 1 from (select min(coalesce(m.received_at, m.sent_at, m.created_at)) as first_at from public.omnichannel_messages m
          where m.workspace_id = c.workspace_id and m.conversation_id = c.id) f
        where f.first_at is not null
          and (p_first_from is null or f.first_at >= (p_first_from::timestamp at time zone 'Asia/Ho_Chi_Minh'))
          and (p_first_to is null or f.first_at < ((p_first_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))))
    order by coalesce(c.last_message_at, '-infinity'::timestamptz) desc, c.id desc
    limit p_chunk
  ) b
  left join lateral (select m.direction, m.sender_external_id from public.omnichannel_messages m
    where m.workspace_id = b.workspace_id and m.conversation_id = b.id order by m.created_at desc, m.id desc limit 1) latest on true
  left join lateral (select m.sender_external_id from public.omnichannel_messages m
    where b.channel_type = 'ZALO' and upper(coalesce(b.metadata->>'conversationKind', '')) <> 'GROUP' and upper(coalesce(b.metadata->>'threadType', '')) <> 'GROUP'
      and coalesce(b.metadata->>'isGroup', '') <> 'true' and coalesce(jsonb_typeof(b.metadata->'groupName'), '') <> 'string'
      and m.workspace_id = b.workspace_id and m.conversation_id = b.id and m.direction = 'INBOUND' order by m.created_at desc, m.id desc limit 1) inbound on true
  order by b.sort_at desc, b.id desc
$$;
revoke all on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer) to authenticated;

-- Nicks whose main user is this member (the member's own workspace only). Members cannot read channel_accounts.
create or replace function public.inbox_owned_account_ids(p_user_id uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a.id), '{}') from public.channel_accounts a
  where a.workspace_id = public.current_workspace_id() and p_user_id is not null and a.primary_profile_id = p_user_id;
$$;
revoke all on function public.inbox_owned_account_ids(uuid) from public, anon;
grant execute on function public.inbox_owned_account_ids(uuid) to authenticated, service_role;

create or replace function public.inbox_view_matches(p_view text, p_is_group boolean, p_is_other boolean, p_is_important boolean,
  p_latest_direction text, p_assigned_to uuid, p_account_id uuid, p_user_id uuid, p_owned uuid[], p_searching boolean)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case coalesce(p_view, 'all')
    when 'groups' then p_is_group
    when 'other' then not p_is_group and p_is_other
    when 'important' then p_is_important
    when 'waiting' then not p_is_group and not p_is_other and p_latest_direction = 'INBOUND'
    when 'mine' then (not p_is_other or p_searching) and p_user_id is not null
      and (p_assigned_to = p_user_id or (not p_is_group and p_assigned_to is null and p_account_id = any(coalesce(p_owned, '{}'::uuid[]))))
    when 'any' then true
    else not p_is_group and (not p_is_other or p_searching) end
$$;
grant execute on function public.inbox_view_matches(text, boolean, boolean, boolean, text, uuid, uuid, uuid, uuid[], boolean) to authenticated;

create or replace function public.inbox_list_conversations(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_view text, p_search text, p_user_id uuid, p_limit integer, p_before_at timestamptz, p_before_id uuid)
returns table(id uuid, sort_at timestamptz, matched boolean)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_at timestamptz := p_before_at; v_id uuid := p_before_id; v_left integer := least(greatest(coalesce(p_limit, 51), 1), 201);
  v_chunk integer := 200; v_rows integer; v_scanned integer := 0; r record;
  v_owned uuid[] := case when p_view = 'mine' then public.inbox_owned_account_ids(p_user_id) end;
  v_searching boolean := coalesce(btrim(p_search), '') <> '';
begin
  if (v_at is null) <> (v_id is null) then return; end if;
  loop
    v_rows := 0;
    for r in select * from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
        p_search, null, null, v_at, v_id, v_chunk) loop
      v_rows := v_rows + 1; v_at := r.sort_at; v_id := r.id;
      if public.inbox_view_matches(p_view, r.is_group, r.is_other, r.is_important, r.latest_direction, r.assigned_to, r.channel_account_id, p_user_id, v_owned, v_searching) then
        id := r.id; sort_at := r.sort_at; matched := true; return next;
        v_left := v_left - 1;
        if v_left <= 0 then return; end if;
      end if;
    end loop;
    v_scanned := v_scanned + v_rows;
    if v_rows < v_chunk then return; end if;
    if v_scanned >= 6000 then
      id := v_id; sort_at := v_at; matched := false; return next;
      return;
    end if;
    v_chunk := least(v_chunk * 2, 1600);
  end loop;
end $$;

create or replace function public.inbox_view_counts(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date, p_search text, p_user_id uuid)
returns table(view text, total bigint, capped boolean)
language sql stable security invoker set search_path = public as $$
  with f as materialized (
    select * from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, null, now() - interval '30 days', null, null, 3001)
  ), n as (select count(*) > 3000 as capped from f),
  o as (select public.inbox_owned_account_ids(p_user_id) as owned)
  select v.view, count(f.id), (select capped from n)
  from (values ('all'), ('waiting'), ('mine'), ('groups'), ('other'), ('important')) as v(view)
  left join (select * from f limit 3000) f
    on public.inbox_view_matches(v.view, f.is_group, f.is_other, f.is_important, f.latest_direction, f.assigned_to, f.channel_account_id,
      p_user_id, (select owned from o), coalesce(btrim(p_search), '') <> '')
  group by v.view
$$;

create or replace function public.inbox_matching_conversation_ids(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_view text, p_search text, p_user_id uuid, p_max integer)
returns uuid[]
language sql stable security invoker set search_path = public as $$
  select coalesce(array_agg(f.id order by f.sort_at desc, f.id desc), '{}')
  from (
    select f.id, f.sort_at from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, null, null, null, null, null) f
    where public.inbox_view_matches(p_view, f.is_group, f.is_other, f.is_important, f.latest_direction, f.assigned_to, f.channel_account_id,
      p_user_id, case when p_view = 'mine' then public.inbox_owned_account_ids(p_user_id) end, coalesce(btrim(p_search), '') <> '')
    order by f.sort_at desc, f.id desc
    limit least(greatest(coalesce(p_max, 5000), 1), 5000) + 1
  ) f
$$;

drop function if exists public.inbox_view_matches(text, boolean, boolean, text, uuid, uuid);

-- Ghim trong cá nhân: only the member who pinned sees it.
create table if not exists public.inbox_personal_pins (
  workspace_id uuid not null,
  user_id uuid not null,
  conversation_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, conversation_id),
  constraint inbox_personal_pins_conversation_fk foreign key (conversation_id, workspace_id) references public.omnichannel_conversations(id, workspace_id) on delete cascade,
  constraint inbox_personal_pins_user_fk foreign key (user_id, workspace_id) references public.profiles(id, workspace_id) on delete cascade
);
alter table public.inbox_personal_pins enable row level security;
create policy inbox_personal_pins_own on public.inbox_personal_pins for select to authenticated
  using (user_id = (select auth.uid()) and workspace_id = (select public.current_workspace_id()));
revoke all on public.inbox_personal_pins from public, anon, authenticated;
grant select on public.inbox_personal_pins to authenticated;
grant all on public.inbox_personal_pins to service_role;

create or replace function public.update_inbox_conversation_preference(
  p_conversation_id uuid, p_action text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v public.omnichannel_conversations%rowtype; v_meta jsonb; v_user uuid := auth.uid();
begin
  select * into v from public.omnichannel_conversations
  where id=p_conversation_id and workspace_id=public.current_workspace_id() for update;
  if not found or not public.has_workspace_permission('inbox.update')
    or not public.can_access_channel_account(v.channel_account_id) then return false; end if;
  v_meta:=coalesce(v.metadata,'{}'::jsonb);
  if p_action='MARK_READ' then update public.omnichannel_conversations set unread_count=0 where id=v.id;
  elsif p_action='MARK_UNREAD' then update public.omnichannel_conversations set unread_count=greatest(unread_count,1) where id=v.id;
  elsif p_action='TOGGLE_MUTE' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{muted}',to_jsonb(not coalesce((v_meta->>'muted')::boolean,false))) where id=v.id;
  elsif p_action='TOGGLE_PIN' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{appPinned}',to_jsonb(not coalesce((v_meta->>'appPinned')::boolean,false))) where id=v.id;
  elsif p_action='TOGGLE_OTHER' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{folder}',to_jsonb(case when v_meta->>'folder'='OTHER' then 'PRIMARY' else 'OTHER' end)) where id=v.id;
  elsif p_action='TOGGLE_IMPORTANT' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{important}',to_jsonb(not coalesce((v_meta->>'important')::boolean,false))) where id=v.id;
  elsif p_action='TOGGLE_MY_PIN' then
    if v_user is null then return false; end if;
    if exists (select 1 from public.inbox_personal_pins p where p.user_id=v_user and p.conversation_id=v.id) then
      delete from public.inbox_personal_pins p where p.user_id=v_user and p.conversation_id=v.id;
    else
      insert into public.inbox_personal_pins(workspace_id,user_id,conversation_id) values (v.workspace_id,v_user,v.id);
    end if;
  elsif p_action='SOFT_DELETE' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{hidden}', 'true'::jsonb) where id=v.id;
  else return false; end if;
  return true;
end $$;
revoke all on function public.update_inbox_conversation_preference(uuid,text) from public,anon;
grant execute on function public.update_inbox_conversation_preference(uuid,text) to authenticated;

-- Phiên bản AI: off (staff take over) or on with a chosen bot of the workspace (null = the nick's bot).
create or replace function public.set_inbox_conversation_ai(p_conversation_id uuid, p_enabled boolean, p_bot_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v public.omnichannel_conversations%rowtype; v_meta jsonb;
begin
  select * into v from public.omnichannel_conversations
  where id = p_conversation_id and workspace_id = public.current_workspace_id() for update;
  if not found or not public.has_workspace_permission('inbox.update') or not public.can_access_channel_account(v.channel_account_id) then return false; end if;
  if p_enabled and p_bot_id is not null and not exists (
    select 1 from public.ai_recruiter_bots b where b.id = p_bot_id and b.workspace_id = v.workspace_id and b.enabled) then return false; end if;
  v_meta := coalesce(v.metadata, '{}'::jsonb);
  if not p_enabled then
    update public.omnichannel_conversations set takeover_mode = 'HUMAN_TAKEOVER' where id = v.id;
  elsif p_bot_id is null then
    update public.omnichannel_conversations set takeover_mode = 'BOT_ALLOWED', metadata = v_meta - 'aiRecruiterBotId' - 'aiRecruiterBotSince' where id = v.id;
  else
    update public.omnichannel_conversations set takeover_mode = 'BOT_ALLOWED',
      metadata = v_meta || jsonb_build_object('aiRecruiterBotId', p_bot_id,
        'aiRecruiterBotSince', case when v_meta->>'aiRecruiterBotId' = p_bot_id::text then coalesce(v_meta->'aiRecruiterBotSince', to_jsonb(now())) else to_jsonb(now()) end)
    where id = v.id;
    update public.ai_recruiter_conversation_states set bot_id = p_bot_id, updated_at = now()
    where workspace_id = v.workspace_id and conversation_id = v.id and bot_id <> p_bot_id;
  end if;
  return true;
end $$;
revoke all on function public.set_inbox_conversation_ai(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_inbox_conversation_ai(uuid, boolean, uuid) to authenticated;

commit;
