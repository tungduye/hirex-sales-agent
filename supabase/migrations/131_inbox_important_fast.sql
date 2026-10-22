-- 131: Quan trọng opens at once. The tab used to walk up to 6,000 conversations to find the few marked important;
-- now the filter can pick only important ones from the start (new last argument, default false keeps every caller).
begin;

create index if not exists omnichannel_conversations_important
  on public.omnichannel_conversations(workspace_id, (coalesce(last_message_at, '-infinity'::timestamptz)) desc, id desc)
  where metadata->>'important' = 'true';

drop function if exists public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer);
create function public.inbox_filtered_conversations(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_search text, p_assigned_to uuid, p_since timestamptz, p_before_at timestamptz, p_before_id uuid, p_chunk integer,
  p_important_only boolean default false)
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

create or replace function public.inbox_matching_conversation_ids(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_view text, p_search text, p_user_id uuid, p_max integer)
returns uuid[]
language sql stable security invoker set search_path = public as $$
  select coalesce(array_agg(f.id order by f.sort_at desc, f.id desc), '{}')
  from (
    select f.id, f.sort_at from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, null, null, null, null, null, p_view = 'important') f
    where public.inbox_view_matches(p_view, f.is_group, f.is_other, f.is_important, f.latest_direction, f.assigned_to, f.channel_account_id,
      p_user_id, case when p_view = 'mine' then public.inbox_owned_account_ids(p_user_id) end, coalesce(btrim(p_search), '') <> '')
    order by f.sort_at desc, f.id desc
    limit least(greatest(coalesce(p_max, 5000), 1), 5000) + 1
  ) f
$$;

commit;
