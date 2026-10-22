-- 133: Suối Nguồn đợt 3 (Soda đếm Suối Nguồn theo Bộ phận, Owner, Thị trường, Kênh, Thẻ).
-- * profiles.department: Bộ phận of a member (Sale, Rec…), set on Vai trò và phân quyền.
-- * conversation_tags.group_name: nhóm thẻ (Thị trường, Vị trí, Loại liên hệ…), set on Nhãn & nhóm thẻ.
-- * inbox_conversation_facts: one row per conversation the member may see, with what Soda counts by.
begin;

alter table public.profiles add column if not exists department text;
alter table public.profiles drop constraint if exists profiles_department_shape;
alter table public.profiles add constraint profiles_department_shape check (department is null or (length(btrim(department)) between 1 and 60));

alter table public.conversation_tags add column if not exists group_name text;
alter table public.conversation_tags drop constraint if exists conversation_tags_group_shape;
alter table public.conversation_tags add constraint conversation_tags_group_shape check (group_name is null or (length(btrim(group_name)) between 1 and 60));

-- Same tab rules as the list (security invoker: row level security decides what the member sees). Newest 20,000.
create or replace function public.inbox_conversation_facts(p_account_ids uuid[], p_channel_types text[], p_since timestamptz)
returns table(id uuid, channel_account_id uuid, channel_type text, sort_at timestamptz, is_group boolean, is_other boolean, is_important boolean,
  mention_pending boolean, latest_direction text, unread_count integer, assigned_to uuid, tag_ids uuid[])
language sql stable security invoker set search_path = public as $$
  select f.id, c.channel_account_id, c.channel_type, f.sort_at, f.is_group, f.is_other, f.is_important, f.mention_pending, f.latest_direction,
    c.unread_count, f.assigned_to,
    coalesce((select array_agg(l.tag_id) from public.conversation_tag_links l where l.conversation_id = f.id), '{}'::uuid[])
  from public.inbox_filtered_conversations(p_account_ids, p_channel_types, null, 'all', null, null, null, null, p_since, null, null, 20001) f
  join public.omnichannel_conversations c on c.id = f.id;
$$;
revoke all on function public.inbox_conversation_facts(uuid[], text[], timestamptz) from public, anon;
grant execute on function public.inbox_conversation_facts(uuid[], text[], timestamptz) to authenticated;

commit;
