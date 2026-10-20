-- 109: KPI counts closer to what people mean. "Hội thoại mới" counts chats that actually started in the
-- period (not chats first synced into HireX then) and splits 1-1 chats from groups; "chưa đọc" follows
-- Suối Nguồn's people count (no robots, no Khác folder, no hidden chats) with groups apart.
begin;
create or replace function public.assistant_kpi_counts(p_workspace_id uuid, p_profile_ids uuid[], p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with people as (
    select p.id, p.full_name from public.profiles p where p.workspace_id = p_workspace_id and p.id = any(p_profile_ids)
  ), accounts as (
    select a.id, a.primary_profile_id as owner, a.channel_type, a.display_name, a.legacy_email_account_id
    from public.channel_accounts a join people on people.id = a.primary_profile_id
    where a.workspace_id = p_workspace_id
  ), messages as (
    -- created_at narrows by index; the provider time decides (history synced late is left out).
    select m.channel_account_id,
      count(*) filter (where m.direction = 'INBOUND') as inbound,
      count(*) filter (where m.direction = 'OUTBOUND') as outbound,
      count(distinct m.conversation_id) filter (where m.direction = 'INBOUND') as conversations_in
    from public.omnichannel_messages m
    where m.workspace_id = p_workspace_id and m.channel_account_id in (select id from accounts)
      and m.created_at >= p_from - interval '2 days' and m.created_at < p_to + interval '2 days'
      and coalesce(m.received_at, m.sent_at, m.created_at) >= p_from and coalesce(m.received_at, m.sent_at, m.created_at) < p_to
    group by m.channel_account_id
  ), conversations as (
    select c.id, c.channel_account_id, c.created_at, c.unread_count, c.channel_type,
      coalesce(c.metadata->>'isGroup' = 'true' or c.metadata ? 'groupName' or upper(coalesce(c.metadata->>'threadType', '')) = 'GROUP'
        or upper(coalesce(c.metadata->>'conversationKind', '')) = 'GROUP', false) as is_group,
      (coalesce(c.metadata->>'folder', '') = 'OTHER' or coalesce(c.metadata->>'hidden', '') = 'true') as set_aside
    from public.omnichannel_conversations c
    where c.workspace_id = p_workspace_id and c.channel_account_id in (select id from accounts)
      and ((c.created_at >= p_from and c.created_at < p_to) or c.unread_count > 0)
  ), new_conversations as (
    -- New = the chat itself started in the period (no earlier message), not one first synced then.
    select c.channel_account_id, count(*) filter (where not c.is_group) as people, count(*) filter (where c.is_group) as groups
    from conversations c
    where c.created_at >= p_from and c.created_at < p_to and not c.set_aside
      and exists (select 1 from public.omnichannel_messages m where m.workspace_id = p_workspace_id and m.conversation_id = c.id
        and coalesce(m.received_at, m.sent_at) >= p_from and coalesce(m.received_at, m.sent_at) < p_to)
      and not exists (select 1 from public.omnichannel_messages m where m.workspace_id = p_workspace_id and m.conversation_id = c.id
        and coalesce(m.received_at, m.sent_at) < p_from)
    group by c.channel_account_id
  ), unread as (
    -- Like "Chưa đọc · người" in Suối Nguồn: robots (no-reply mail), the Khác folder and hidden chats left out.
    select c.channel_account_id, count(*) filter (where not c.is_group) as people, count(*) filter (where c.is_group) as groups
    from conversations c
    left join lateral (
      select m.sender_external_id as sender from public.omnichannel_messages m
      where c.channel_type = 'EMAIL' and m.workspace_id = p_workspace_id and m.conversation_id = c.id and m.direction = 'INBOUND'
      order by m.created_at desc, m.id desc limit 1
    ) s on true
    where c.unread_count > 0 and not c.set_aside and not coalesce(public.inbox_is_automated_sender(s.sender), false)
    group by c.channel_account_id
  ), account_rows as (
    select a.*, coalesce(m.inbound, 0) as inbound, coalesce(m.outbound, 0) as outbound, coalesce(m.conversations_in, 0) as conversations_in,
      coalesce(nc.people, 0) as new_conversations, coalesce(nc.groups, 0) as new_groups, coalesce(u.people, 0) as unread, coalesce(u.groups, 0) as unread_groups
    from accounts a left join messages m on m.channel_account_id = a.id left join new_conversations nc on nc.channel_account_id = a.id left join unread u on u.channel_account_id = a.id
  ), manual as (
    select o.approved_by as id, count(*) as n from public.channel_outbound_actions o
    where o.workspace_id = p_workspace_id and o.approved_by = any(p_profile_ids) and o.status = 'SENT' and o.dispatch_source = 'HUMAN_MANUAL'
      and coalesce(o.accepted_at, o.updated_at) >= p_from and coalesce(o.accepted_at, o.updated_at) < p_to
    group by o.approved_by
  ), rec as (
    select s.updated_by as id,
      count(*) filter (where s.created_at >= p_from and s.created_at < p_to) as new_candidates,
      count(*) filter (where s.outcome = 'CV_RECEIVED') as cv_received,
      count(*) as touched
    from public.candidate_flow_states s
    where s.workspace_id = p_workspace_id and s.updated_by = any(p_profile_ids) and s.updated_at >= p_from and s.updated_at < p_to
    group by s.updated_by
  ), email as (
    select a.owner as id,
      count(*) filter (where r.sent_at >= p_from and r.sent_at < p_to) as sent,
      count(*) filter (where r.replied_at >= p_from and r.replied_at < p_to) as replied
    from public.email_campaign_recipients r join accounts a on a.legacy_email_account_id = r.sender_email_account_id
    where r.workspace_id = p_workspace_id and ((r.sent_at >= p_from and r.sent_at < p_to) or (r.replied_at >= p_from and r.replied_at < p_to))
    group by a.owner
  ), content as (
    select i.created_by as id, count(*) as n from public.content_items i
    where i.workspace_id = p_workspace_id and i.created_by = any(p_profile_ids) and i.created_at >= p_from and i.created_at < p_to
    group by i.created_by
  ), tasks as (
    select t.assigned_to as id,
      count(*) filter (where t.status in ('OPEN', 'IN_PROGRESS')) as open,
      count(*) filter (where t.status in ('OPEN', 'IN_PROGRESS') and t.due_at < now()) as overdue,
      count(*) filter (where t.status = 'COMPLETED' and t.updated_at >= p_from and t.updated_at < p_to) as completed
    from public.channel_tasks t
    where t.workspace_id = p_workspace_id and t.assigned_to = any(p_profile_ids)
    group by t.assigned_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', people.id, 'name', people.full_name,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'channel', r.channel_type, 'name', r.display_name, 'inbound', r.inbound, 'outbound', r.outbound,
        'conversations_in', r.conversations_in, 'new_conversations', r.new_conversations, 'new_groups', r.new_groups, 'unread', r.unread, 'unread_groups', r.unread_groups) order by r.inbound desc) from account_rows r where r.owner = people.id), '[]'::jsonb),
    'manual_sent', coalesce(manual.n, 0),
    'rec_new', coalesce(rec.new_candidates, 0), 'rec_cv', coalesce(rec.cv_received, 0), 'rec_touched', coalesce(rec.touched, 0),
    'email_sent', coalesce(email.sent, 0), 'email_replied', coalesce(email.replied, 0),
    'content_created', coalesce(content.n, 0),
    'tasks_open', coalesce(tasks.open, 0), 'tasks_overdue', coalesce(tasks.overdue, 0), 'tasks_completed', coalesce(tasks.completed, 0)
  ) order by people.full_name), '[]'::jsonb)
  from people
  left join manual on manual.id = people.id left join rec on rec.id = people.id left join email on email.id = people.id
  left join content on content.id = people.id left join tasks on tasks.id = people.id
$$;
revoke all on function public.assistant_kpi_counts(uuid, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.assistant_kpi_counts(uuid, uuid[], timestamptz, timestamptz) to service_role;
commit;
