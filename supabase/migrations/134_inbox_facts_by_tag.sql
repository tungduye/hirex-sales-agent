-- 134: Soda's Suối Nguồn counts by tag (thẻ, thị trường, tình trạng thẻ) read only the conversations carrying those
-- tags, over all time, instead of walking every conversation (which timed out).
begin;

drop function if exists public.inbox_conversation_facts(uuid[], text[], timestamptz);
create function public.inbox_conversation_facts(p_account_ids uuid[], p_channel_types text[], p_since timestamptz, p_tag_ids uuid[] default null)
returns table(id uuid, channel_account_id uuid, channel_type text, sort_at timestamptz, is_group boolean, is_other boolean, is_important boolean,
  mention_pending boolean, latest_direction text, unread_count integer, assigned_to uuid, tag_ids uuid[])
language sql stable security invoker set search_path = public as $$
  select f.id, c.channel_account_id, c.channel_type, f.sort_at, f.is_group, f.is_other, f.is_important, f.mention_pending, f.latest_direction,
    c.unread_count, f.assigned_to,
    coalesce((select array_agg(l.tag_id) from public.conversation_tag_links l where l.conversation_id = f.id), '{}'::uuid[])
  from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, 'any', null, null, null, null, p_since, null, null, 20001) f
  join public.omnichannel_conversations c on c.id = f.id;
$$;
revoke all on function public.inbox_conversation_facts(uuid[], text[], timestamptz, uuid[]) from public, anon;
grant execute on function public.inbox_conversation_facts(uuid[], text[], timestamptz, uuid[]) to authenticated;

commit;
