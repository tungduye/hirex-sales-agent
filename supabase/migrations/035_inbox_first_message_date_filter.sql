-- Workspace/account-scoped first-message timestamps for the unified inbox date filter.
begin;

create or replace function public.get_conversation_first_message_times(p_conversation_ids uuid[])
returns table(conversation_id uuid, first_message_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.conversation_id,
    min(coalesce(m.received_at, m.sent_at, m.created_at)) as first_message_at
  from public.omnichannel_messages m
  where m.workspace_id = public.current_workspace_id()
    and m.conversation_id = any(coalesce(p_conversation_ids, '{}'::uuid[]))
  group by m.conversation_id;
$$;

revoke all on function public.get_conversation_first_message_times(uuid[]) from public;
grant execute on function public.get_conversation_first_message_times(uuid[]) to authenticated;

commit;
