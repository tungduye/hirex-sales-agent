-- 087: one row per Zalo group in the inbox.
-- When several of our nicks are in the same group, the inbox shows the group once and opens the copy
-- of the nick that last wrote in it. This returns, for each given conversation the member can see,
-- when we last sent a message there. Row security applies (security invoker), so only conversations
-- of accounts the member may use are answered.
begin;
create or replace function public.get_inbox_last_outbound_at(p_conversation_ids uuid[])
returns table(conversation_id uuid, last_outbound_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, (
    select coalesce(m.sent_at, m.created_at)
    from public.omnichannel_messages m
    where m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'OUTBOUND'
    order by m.created_at desc
    limit 1)
  from public.omnichannel_conversations c
  where c.id = any(p_conversation_ids)
    and c.workspace_id = public.current_workspace_id()
    and coalesce(array_length(p_conversation_ids, 1), 0) <= 200;
$$;
revoke all on function public.get_inbox_last_outbound_at(uuid[]) from public;
grant execute on function public.get_inbox_last_outbound_at(uuid[]) to authenticated;
commit;
