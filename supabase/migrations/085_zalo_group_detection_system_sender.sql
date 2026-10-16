-- 085: Zalo's own notices ("… đã đồng ý kết bạn") arrive as inbound messages from sender "system".
-- They are not another person writing, so they must not turn a one-to-one chat into a "group".
begin;
create or replace function public.get_inbox_zalo_group_ids(p_conversation_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select c.id
  from public.omnichannel_conversations c
  where c.id = any(p_conversation_ids)
    and c.workspace_id = public.current_workspace_id()
    and c.channel_type = 'ZALO'
    and exists (
      select 1
      from public.omnichannel_messages m
      where m.workspace_id = c.workspace_id
        and m.conversation_id = c.id
        and m.direction = 'INBOUND'
        and m.sender_external_id is distinct from c.provider_conversation_id
        and m.sender_external_id is distinct from 'system'
    );
$$;
revoke all on function public.get_inbox_zalo_group_ids(uuid[]) from public;
grant execute on function public.get_inbox_zalo_group_ids(uuid[]) to authenticated;
commit;
