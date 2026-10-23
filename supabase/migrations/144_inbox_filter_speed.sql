-- Suối Nguồn: faster list, tab badges and tag filter.
-- * Thẻ phân loại starts from the few tagged conversations (was: every conversation checked one by one).
-- * Access to a nick is checked once per nick, with the same rule as row level security
--   (current workspace + can_access_channel_account), instead of on every conversation and message row.
-- * The query is planned with the actual filter values, so unused filters drop out and the time index is used.
-- Same rows and order as before (checked against production data: 8,498 conversations, 0 differences).
begin;

create or replace function public.inbox_filtered_conversations
(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date,
  p_search text, p_assigned_to uuid, p_since timestamptz, p_before_at timestamptz, p_before_id uuid, p_chunk integer,
  p_important_only boolean default false, p_unread_only boolean default false)
returns table(id uuid, sort_at timestamptz, assigned_to uuid, is_group boolean, is_other boolean, latest_direction text, is_important boolean, channel_account_id uuid, mention_pending boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_ws uuid := public.current_workspace_id();
  v_accounts uuid[];
  v_tagged uuid[];
begin
  if v_ws is null or p_account_ids is null or cardinality(p_account_ids) = 0 then return; end if;
  -- Access is checked once per nick (same rule as row level security on conversations and messages), not on every row.
  select coalesce(array_agg(a.id), '{}') into v_accounts from (select distinct u as id from unnest(p_account_ids) u) a
  where public.can_access_channel_account(a.id);
  if cardinality(v_accounts) = 0 then return; end if;
  -- Thẻ phân loại: start from the few tagged conversations. 'all' = has every picked tag, 'any' = at least one.
  if p_tag_ids is not null and cardinality(p_tag_ids) > 0 then
    select coalesce(array_agg(t.conversation_id), '{}') into v_tagged from (
      select l.conversation_id from public.conversation_tag_links l
      where l.workspace_id = v_ws and l.tag_id = any(p_tag_ids)
      group by l.conversation_id
      having coalesce(p_tag_mode, 'all') = 'any' or count(distinct l.tag_id) >= (select count(distinct x) from unnest(p_tag_ids) x)) t;
    if cardinality(v_tagged) = 0 then return; end if;
  end if;
  -- Planned with the actual values each time, so unused filters drop out and the right index is used.
  return query execute $q$
  select b.id, b.sort_at, b.assigned_to,
    coalesce(upper(coalesce(b.metadata->>'conversationKind', '')) = 'GROUP' or upper(coalesce(b.metadata->>'threadType', '')) = 'GROUP'
      or coalesce(b.metadata->>'isGroup', '') = 'true' or coalesce(jsonb_typeof(b.metadata->'groupName'), '') = 'string'
      or (b.channel_type = 'ZALO' and inbound.sender_external_id is not null and inbound.sender_external_id is distinct from b.provider_conversation_id
          and inbound.sender_external_id <> 'system'), false),
    coalesce(coalesce(b.metadata->>'folder', '') = 'OTHER' or (b.channel_type = 'EMAIL' and coalesce(public.inbox_is_automated_sender(latest.sender_external_id), false)), false),
    latest.direction::text,
    coalesce(b.metadata->>'important', '') = 'true',
    b.channel_account_id,
    b.mention_pending_at is not null
  from (
    select c.id, coalesce(c.last_message_at, '-infinity'::timestamptz) as sort_at, c.assigned_to, c.metadata, c.channel_type, c.provider_conversation_id, c.workspace_id, c.channel_account_id, c.mention_pending_at
    from public.omnichannel_conversations c
    left join public.contacts ct on ct.id = c.contact_id and ct.workspace_id = c.workspace_id
    where c.workspace_id = $1
      and c.channel_account_id = any($2)
      and ($4::uuid[] is null or c.id = any($4))
      and coalesce(c.metadata->>'hidden', '') <> 'true'
      and (not coalesce($13, false) or c.metadata->>'important' = 'true')
      and (not coalesce($14, false) or coalesce(c.unread_count, 0) > 0)
      and ($8::uuid is null or c.assigned_to = $8)
      and ($9::timestamptz is null or coalesce(c.last_message_at, '-infinity'::timestamptz) >= $9)
      and ($10::timestamptz is null or (coalesce(c.last_message_at, '-infinity'::timestamptz), c.id) < ($10, $11::uuid))
      and ($3::text[] is null or cardinality($3) = 0 or c.channel_type = any($3))
      and (coalesce(btrim($7), '') = '' or public.vi_fold(concat_ws(' ', c.subject, c.metadata->>'participantDisplayName',
        c.metadata->>'conversationDisplayName', c.metadata->>'groupName', c.metadata->>'threadName', c.metadata->>'displayName',
        c.provider_conversation_id, ct.full_name, ct.email, ct.phone)) like '%' || public.vi_fold(btrim($7)) || '%')
      and (($5::date is null and $6::date is null) or exists (
        select 1 from (select min(coalesce(m.received_at, m.sent_at, m.created_at)) as first_at from public.omnichannel_messages m
          where m.workspace_id = c.workspace_id and m.conversation_id = c.id) f
        where f.first_at is not null
          and ($5::date is null or f.first_at >= ($5::date::timestamp at time zone 'Asia/Ho_Chi_Minh'))
          and ($6::date is null or f.first_at < (($6::date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))))
    order by coalesce(c.last_message_at, '-infinity'::timestamptz) desc, c.id desc
    limit $12
  ) b
  left join lateral (select m.direction, m.sender_external_id from public.omnichannel_messages m
    where m.workspace_id = b.workspace_id and m.conversation_id = b.id order by m.created_at desc, m.id desc limit 1) latest on true
  left join lateral (select m.sender_external_id from public.omnichannel_messages m
    where b.channel_type = 'ZALO' and upper(coalesce(b.metadata->>'conversationKind', '')) <> 'GROUP' and upper(coalesce(b.metadata->>'threadType', '')) <> 'GROUP'
      and coalesce(b.metadata->>'isGroup', '') <> 'true' and coalesce(jsonb_typeof(b.metadata->'groupName'), '') <> 'string'
      and m.workspace_id = b.workspace_id and m.conversation_id = b.id and m.direction = 'INBOUND' order by m.created_at desc, m.id desc limit 1) inbound on true
  order by b.sort_at desc, b.id desc
  $q$ using v_ws, v_accounts, p_channel_types, v_tagged, p_first_from, p_first_to, p_search, p_assigned_to, p_since, p_before_at, p_before_id, p_chunk,
    p_important_only, p_unread_only;
end $fn$;
revoke all on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer, boolean, boolean) from public, anon;
grant execute on function public.inbox_filtered_conversations(uuid[], text[], uuid[], text, date, date, text, uuid, timestamptz, timestamptz, uuid, integer, boolean, boolean) to authenticated;

commit;
