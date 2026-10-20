-- 101: unread conversations per account for the Suối Nguồn account picker, counted in the database
-- (a plain select is capped at 1000 rows by the API). Row security applies (security invoker), so a
-- member only gets counts for accounts they may use.
begin;
create or replace function public.get_inbox_unread_by_account(p_account_ids uuid[])
returns table(channel_account_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select c.channel_account_id, count(*)
  from public.omnichannel_conversations c
  where c.channel_account_id = any(p_account_ids)
    and c.workspace_id = public.current_workspace_id()
    and c.unread_count > 0
    and coalesce(c.metadata->>'hidden', '') <> 'true'
    and coalesce(array_length(p_account_ids, 1), 0) <= 500
  group by c.channel_account_id;
$$;
revoke all on function public.get_inbox_unread_by_account(uuid[]) from public;
grant execute on function public.get_inbox_unread_by_account(uuid[]) to authenticated;
commit;
