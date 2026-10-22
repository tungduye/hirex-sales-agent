-- 135: Soda's Suối Nguồn counts are added up in the database and come back as one value. Returning one row per
-- conversation stopped at the API's 1,000-row limit, so big counts came out too small.
begin;

-- Conversations grouped by what Soda counts by: nick, assigned person, group or not, waiting (like the Chưa trả lời
-- tab), important, unread, and the set of tags. E-mail from robots / the old Khác folder is left out.
create or replace function public.inbox_conversation_summary(p_account_ids uuid[], p_channel_types text[], p_since timestamptz, p_tag_ids uuid[] default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('a', s.channel_account_id, 'o', s.assigned_to, 'g', s.is_group, 'w', s.waiting, 'i', s.is_important,
    'u', s.unread, 't', s.tag_ids, 'c', s.total)), '[]'::jsonb)
  from (
    select f.channel_account_id, f.assigned_to, f.is_group, f.is_important,
      (not f.is_group and f.latest_direction = 'INBOUND') or (f.is_group and f.mention_pending) as waiting,
      f.unread_count > 0 as unread, f.tag_ids, count(*) as total
    from public.inbox_conversation_facts(p_account_ids, p_channel_types, p_since, p_tag_ids) f
    where not f.is_other
    group by 1, 2, 3, 4, 5, 6, 7
  ) s;
$$;
revoke all on function public.inbox_conversation_summary(uuid[], text[], timestamptz, uuid[]) from public, anon;
grant execute on function public.inbox_conversation_summary(uuid[], text[], timestamptz, uuid[]) to authenticated;

commit;
