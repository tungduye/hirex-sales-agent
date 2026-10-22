-- 132: Chưa trả lời also lists Zalo groups where someone tagged my nick ("@Tên nick" or "@All") and the nick has
-- not written in the group since. Deplao keeps no list of who was tagged, so the tag is found by name: the nick's
-- Zalo name and its name in that group. Recorded when the message arrives (trigger), cleared when the nick writes.
begin;

alter table public.omnichannel_conversations add column if not exists mention_pending_at timestamptz;

-- "@Name" in the text (marks and case ignored); the name must end at a word boundary ("@All" is not "@Allen").
create or replace function public.zalo_text_mentions(p_text text, p_names text[])
returns boolean language plpgsql immutable parallel safe set search_path = '' as $$
declare t text := public.vi_fold(coalesce(p_text, '')); n text; needle text; pos integer; start integer; next_char text;
begin
  if position('@' in t) = 0 then return false; end if;
  foreach n in array coalesce(p_names, '{}'::text[]) loop
    if n is null or length(btrim(n)) < 2 then continue; end if;
    needle := '@' || public.vi_fold(btrim(n)); start := 1;
    loop
      pos := position(needle in substr(t, start));
      exit when pos = 0;
      next_char := substr(t, start + pos - 1 + length(needle), 1);
      if next_char = '' or next_char !~ '[[:alnum:]_]' then return true; end if;
      start := start + pos;
    end loop;
  end loop;
  return false;
end $$;
grant execute on function public.zalo_text_mentions(text, text[]) to authenticated, service_role;

-- Names my nick answers to in this group.
create or replace function public.zalo_nick_names(p_channel_account_id uuid, p_group_id text)
returns text[] language sql stable security definer set search_path = '' as $$
  select array['All', 'Tất cả'] || coalesce((select array_agg(a.display_name) from public.channel_accounts a where a.id = p_channel_account_id and a.display_name is not null), '{}')
    || coalesce((select array_agg(m.display_name) from public.zalo_group_members m join public.channel_accounts a on a.id = m.channel_account_id
      where m.channel_account_id = p_channel_account_id and m.group_id = p_group_id and m.member_id = a.external_account_id), '{}')
$$;
revoke all on function public.zalo_nick_names(uuid, text) from public, anon, authenticated;
grant execute on function public.zalo_nick_names(uuid, text) to service_role;

create or replace function public.omnichannel_messages_track_mentions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(new.received_at, new.sent_at, new.created_at);
  v_conv record; v_last_out timestamptz;
begin
  if new.channel_type <> 'ZALO' then return null; end if;
  if new.direction = 'OUTBOUND' then
    update public.omnichannel_conversations set mention_pending_at = null
    where id = new.conversation_id and workspace_id = new.workspace_id and mention_pending_at is not null and mention_pending_at <= v_at;
    return null;
  end if;
  if new.direction <> 'INBOUND' or position('@' in coalesce(new.text_content, '')) = 0 or coalesce(new.sender_external_id, '') = 'system' then return null; end if;
  -- Imported history (older than 14 days) never opens a tag.
  if v_at < now() - interval '14 days' then return null; end if;
  select c.provider_conversation_id, c.metadata into v_conv from public.omnichannel_conversations c
  where c.id = new.conversation_id and c.workspace_id = new.workspace_id;
  if not found then return null; end if;
  -- Groups only: flagged by the sync, or someone other than the chat itself wrote.
  if not (new.sender_external_id is distinct from v_conv.provider_conversation_id
      or upper(coalesce(v_conv.metadata->>'conversationKind', '')) = 'GROUP' or coalesce(v_conv.metadata->>'isGroup', '') = 'true') then return null; end if;
  if not public.zalo_text_mentions(new.text_content, public.zalo_nick_names(new.channel_account_id, v_conv.provider_conversation_id)) then return null; end if;
  -- A late copy of an old tag never reopens a group the nick already answered.
  select max(coalesce(m.sent_at, m.received_at, m.created_at)) into v_last_out from public.omnichannel_messages m
  where m.workspace_id = new.workspace_id and m.conversation_id = new.conversation_id and m.direction = 'OUTBOUND';
  if v_last_out is not null and v_last_out >= v_at then return null; end if;
  update public.omnichannel_conversations set mention_pending_at = greatest(coalesce(mention_pending_at, v_at), v_at)
  where id = new.conversation_id and workspace_id = new.workspace_id;
  return null;
end $$;
revoke all on function public.omnichannel_messages_track_mentions() from public, anon, authenticated;
drop trigger if exists omnichannel_messages_track_mentions on public.omnichannel_messages;
create trigger omnichannel_messages_track_mentions after insert on public.omnichannel_messages
  for each row execute function public.omnichannel_messages_track_mentions();

-- Tags of the last 14 days that are still unanswered.
with tagged as (
  select m.conversation_id, max(coalesce(m.received_at, m.sent_at, m.created_at)) as at
  from public.omnichannel_messages m
  join public.omnichannel_conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
  where m.channel_type = 'ZALO' and m.direction = 'INBOUND' and m.created_at > now() - interval '14 days'
    and position('@' in coalesce(m.text_content, '')) > 0 and coalesce(m.sender_external_id, '') <> 'system'
    and (m.sender_external_id is distinct from c.provider_conversation_id or upper(coalesce(c.metadata->>'conversationKind', '')) = 'GROUP' or coalesce(c.metadata->>'isGroup', '') = 'true')
    and public.zalo_text_mentions(m.text_content, public.zalo_nick_names(c.channel_account_id, c.provider_conversation_id))
  group by m.conversation_id
)
update public.omnichannel_conversations c set mention_pending_at = t.at
from tagged t
where c.id = t.conversation_id
  and not exists (select 1 from public.omnichannel_messages o where o.workspace_id = c.workspace_id and o.conversation_id = c.id
    and o.direction = 'OUTBOUND' and coalesce(o.sent_at, o.received_at, o.created_at) >= t.at);

drop function if exists public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer, boolean);
create function public.inbox_filtered_conversations(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_search text, p_assigned_to uuid, p_since timestamptz, p_before_at timestamptz, p_before_id uuid, p_chunk integer,
  p_important_only boolean default false)
returns table(id uuid, sort_at timestamptz, assigned_to uuid, is_group boolean, is_other boolean, latest_direction text, is_important boolean, channel_account_id uuid, mention_pending boolean)
language sql stable security invoker as $$
  select b.id, b.sort_at, b.assigned_to,
    coalesce(upper(coalesce(b.metadata->>'conversationKind', '')) = 'GROUP' or upper(coalesce(b.metadata->>'threadType', '')) = 'GROUP'
      or coalesce(b.metadata->>'isGroup', '') = 'true' or coalesce(jsonb_typeof(b.metadata->'groupName'), '') = 'string'
      or (b.channel_type = 'ZALO' and inbound.sender_external_id is not null and inbound.sender_external_id is distinct from b.provider_conversation_id
          and inbound.sender_external_id <> 'system'), false),
    coalesce(coalesce(b.metadata->>'folder', '') = 'OTHER' or (b.channel_type = 'EMAIL' and coalesce(public.inbox_is_automated_sender(latest.sender_external_id), false)), false),
    latest.direction,
    coalesce(b.metadata->>'important', '') = 'true',
    b.channel_account_id,
    b.mention_pending_at is not null
  from (
    select c.id, coalesce(c.last_message_at, '-infinity'::timestamptz) as sort_at, c.assigned_to, c.metadata, c.channel_type, c.provider_conversation_id, c.workspace_id, c.channel_account_id, c.mention_pending_at
    from public.omnichannel_conversations c
    left join public.contacts ct on ct.id = c.contact_id
    where c.workspace_id = public.current_workspace_id()
      and c.channel_account_id = any(p_account_ids)
      and coalesce(c.metadata->>'hidden', '') <> 'true'
      and (not coalesce(p_important_only, false) or c.metadata->>'important' = 'true')
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
revoke all on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer, boolean) from public, anon;
grant execute on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer, boolean) to authenticated;


create or replace function public.inbox_view_matches(p_view text, p_is_group boolean, p_is_other boolean, p_is_important boolean, p_mention_pending boolean,
  p_latest_direction text, p_assigned_to uuid, p_account_id uuid, p_user_id uuid, p_owned uuid[], p_searching boolean)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case coalesce(p_view, 'all')
    when 'groups' then p_is_group
    when 'other' then not p_is_group and p_is_other
    when 'important' then p_is_important
    -- Chưa trả lời: one-to-one chats waiting for us, and groups where my nick was tagged and has not answered.
    when 'waiting' then (not p_is_group and not p_is_other and p_latest_direction = 'INBOUND') or (p_is_group and coalesce(p_mention_pending, false))
    when 'mine' then (not p_is_other or p_searching) and p_user_id is not null
      and (p_assigned_to = p_user_id or (not p_is_group and p_assigned_to is null and p_account_id = any(coalesce(p_owned, '{}'::uuid[]))))
    when 'any' then true
    else not p_is_group and (not p_is_other or p_searching) end
$$;
grant execute on function public.inbox_view_matches(text, boolean, boolean, boolean, boolean, text, uuid, uuid, uuid, uuid[], boolean) to authenticated;
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
        p_search, null, null, v_at, v_id, v_chunk, p_view = 'important') loop
      v_rows := v_rows + 1; v_at := r.sort_at; v_id := r.id;
      if public.inbox_view_matches(p_view, r.is_group, r.is_other, r.is_important, r.mention_pending, r.latest_direction, r.assigned_to, r.channel_account_id, p_user_id, v_owned, v_searching) then
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

create or replace function public.inbox_matching_conversation_ids(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_view text, p_search text, p_user_id uuid, p_max integer)
returns uuid[]
language sql stable security invoker set search_path = public as $$
  select coalesce(array_agg(f.id order by f.sort_at desc, f.id desc), '{}')
  from (
    select f.id, f.sort_at from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, null, null, null, null, null, p_view = 'important') f
    where public.inbox_view_matches(p_view, f.is_group, f.is_other, f.is_important, f.mention_pending, f.latest_direction, f.assigned_to, f.channel_account_id,
      p_user_id, case when p_view = 'mine' then public.inbox_owned_account_ids(p_user_id) end, coalesce(btrim(p_search), '') <> '')
    order by f.sort_at desc, f.id desc
    limit least(greatest(coalesce(p_max, 5000), 1), 5000) + 1
  ) f
$$;


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
    on public.inbox_view_matches(v.view, f.is_group, f.is_other, f.is_important, f.mention_pending, f.latest_direction, f.assigned_to, f.channel_account_id,
      p_user_id, (select owned from o), coalesce(btrim(p_search), '') <> '')
  group by v.view
$$;

drop function if exists public.inbox_view_matches(text, boolean, boolean, boolean, text, uuid, uuid, uuid, uuid[], boolean);

commit;
