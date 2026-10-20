-- 114: Suối Nguồn filters in the database. Tags, first-message dates, the quick tabs (Tất cả, Chưa trả
-- lời, Giao cho tôi, Nhóm, Khác) and search used to run only over the 50 conversations already loaded;
-- they now select from every conversation of the accounts the member may see, page by page (cursor).
-- Everything is security invoker, so row level security still decides what a member can read.
-- Tab counts cover the newest 3,000 conversations of the last 30 days.
begin;

-- Lower case without Vietnamese marks, so "nguyen van a" finds "Nguyễn Văn A".
create or replace function public.vi_fold(p_text text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(coalesce(p_text, '')), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')
$$;

-- Newest-first order of the list, with a stable tie-breaker; walked in chunks (keyset) by the list below.
create index if not exists omnichannel_conversations_inbox_order
  on public.omnichannel_conversations(workspace_id, (coalesce(last_message_at, '-infinity'::timestamptz)) desc, id desc);

-- Conversations that pass the filters, newest first after the cursor, with what decides their tab.
-- Search (name, phone, e-mail, group name, chat id; marks ignored) and "assigned to" are checked before
-- the per-row message lookups, and the chunk is cut before them too, so a page costs a few hundred lookups.
-- Groups: flagged by the sync, or (Zalo) the latest incoming message is from someone other than the chat
-- itself and not Zalo's "system". Khác: the OTHER folder, or e-mail whose latest message is from a robot.
-- No SET clause, so the planner can inline it (every name is schema-qualified).
create or replace function public.inbox_filtered_conversations(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_search text, p_assigned_to uuid, p_since timestamptz, p_before_at timestamptz, p_before_id uuid, p_chunk integer)
returns table(id uuid, sort_at timestamptz, assigned_to uuid, is_group boolean, is_other boolean, latest_direction text)
language sql stable security invoker as $$
  select b.id, b.sort_at, b.assigned_to,
    coalesce(upper(coalesce(b.metadata->>'conversationKind', '')) = 'GROUP' or upper(coalesce(b.metadata->>'threadType', '')) = 'GROUP'
      or coalesce(b.metadata->>'isGroup', '') = 'true' or coalesce(jsonb_typeof(b.metadata->'groupName'), '') = 'string'
      or (b.channel_type = 'ZALO' and inbound.sender_external_id is not null and inbound.sender_external_id is distinct from b.provider_conversation_id
          and inbound.sender_external_id <> 'system'), false),
    coalesce(coalesce(b.metadata->>'folder', '') = 'OTHER' or (b.channel_type = 'EMAIL' and coalesce(public.inbox_is_automated_sender(latest.sender_external_id), false)), false),
    latest.direction
  from (
    select c.id, coalesce(c.last_message_at, '-infinity'::timestamptz) as sort_at, c.assigned_to, c.metadata, c.channel_type, c.provider_conversation_id, c.workspace_id
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
  -- Only Zalo chats the sync did not flag as a group need the latest incoming sender.
  left join lateral (select m.sender_external_id from public.omnichannel_messages m
    where b.channel_type = 'ZALO' and upper(coalesce(b.metadata->>'conversationKind', '')) <> 'GROUP' and upper(coalesce(b.metadata->>'threadType', '')) <> 'GROUP'
      and coalesce(b.metadata->>'isGroup', '') <> 'true' and coalesce(jsonb_typeof(b.metadata->'groupName'), '') <> 'string'
      and m.workspace_id = b.workspace_id and m.conversation_id = b.id and m.direction = 'INBOUND' order by m.created_at desc, m.id desc limit 1) inbound on true
  order by b.sort_at desc, b.id desc
$$;

create or replace function public.inbox_view_matches(p_view text, p_is_group boolean, p_is_other boolean, p_latest_direction text, p_assigned_to uuid, p_user_id uuid)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case coalesce(p_view, 'all')
    when 'groups' then p_is_group
    when 'other' then not p_is_group and p_is_other
    when 'waiting' then not p_is_group and not p_is_other and p_latest_direction = 'INBOUND'
    when 'mine' then not p_is_group and not p_is_other and p_user_id is not null and p_assigned_to is not distinct from p_user_id
    when 'any' then true
    else not p_is_group and not p_is_other end
$$;

-- One page of the list, newest first, after the cursor (sort time + id of the last row returned). Walks the
-- conversations chunk by chunk until the page is full. A call looks at no more than 6,000 conversations:
-- when it stops there, the last row has matched = false and only marks where the next call continues.
create or replace function public.inbox_list_conversations(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_view text, p_search text, p_user_id uuid, p_limit integer, p_before_at timestamptz, p_before_id uuid)
returns table(id uuid, sort_at timestamptz, matched boolean)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_at timestamptz := p_before_at; v_id uuid := p_before_id; v_left integer := least(greatest(coalesce(p_limit, 51), 1), 201);
  v_chunk integer := 200; v_rows integer; v_scanned integer := 0; r record;
  v_assigned uuid := case when p_view = 'mine' then coalesce(p_user_id, '00000000-0000-0000-0000-000000000000'::uuid) end;
begin
  if (v_at is null) <> (v_id is null) then return; end if;
  loop
    v_rows := 0;
    for r in select * from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
        p_search, v_assigned, null, v_at, v_id, v_chunk) loop
      v_rows := v_rows + 1; v_at := r.sort_at; v_id := r.id;
      if public.inbox_view_matches(p_view, r.is_group, r.is_other, r.latest_direction, r.assigned_to, p_user_id) then
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

-- Tab badges: the newest 3,000 conversations active in the last 30 days, per tab, with the same filters and
-- search. capped = true when there were more, so the badge shows "+".
create or replace function public.inbox_view_counts(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date, p_search text, p_user_id uuid)
returns table(view text, total bigint, capped boolean)
language sql stable security invoker set search_path = public as $$
  with f as materialized (
    select * from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, null, now() - interval '30 days', null, null, 3001)
  ), n as (select count(*) > 3000 as capped from f)
  select v.view, count(f.id), (select capped from n)
  from (values ('all'), ('waiting'), ('mine'), ('groups'), ('other')) as v(view)
  left join (select * from f limit 3000) f
    on public.inbox_view_matches(v.view, f.is_group, f.is_other, f.latest_direction, f.assigned_to, p_user_id)
  group by v.view
$$;

revoke all on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer) from public, anon;
revoke all on function public.inbox_list_conversations(uuid[], text[], uuid[], text, date, date, text, text, uuid, integer, timestamptz, uuid) from public, anon;
revoke all on function public.inbox_view_counts(uuid[], text[], uuid[], text, date, date, text, uuid) from public, anon;
grant execute on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer) to authenticated;
grant execute on function public.inbox_list_conversations(uuid[], text[], uuid[], text, date, date, text, text, uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.inbox_view_counts(uuid[], text[], uuid[], text, date, date, text, uuid) to authenticated;
grant execute on function public.vi_fold(text) to authenticated;
grant execute on function public.inbox_view_matches(text, boolean, boolean, text, uuid, uuid) to authenticated;

commit;
