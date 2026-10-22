-- 139: Tổng quan (HireX HQ) and Suối Nguồn count "Chưa trả lời" the same way.
-- * inbox_view_counts (Suối Nguồn tab badges) counted only the newest 3,000 conversations of the last 30 days, so a
--   large account set showed too few. It now counts the newest 20,000 (the window Soda and Tổng quan already use).
-- * inbox_waiting_by_account: the same rule split per account, so Tổng quan can give each member the number Suối Nguồn
--   shows with the "Người phụ trách" filter (main user of the nick), and the total equals the Suối Nguồn badge.
begin;

create or replace function public.inbox_view_counts(
  p_account_ids uuid[], p_channel_types text[], p_tag_ids uuid[], p_tag_mode text, p_first_from date, p_first_to date, p_search text, p_user_id uuid)
returns table(view text, total bigint, capped boolean)
language sql stable security invoker set search_path = public as $$
  with f as materialized (
    select * from public.inbox_filtered_conversations(p_account_ids, p_channel_types, p_tag_ids, p_tag_mode, p_first_from, p_first_to,
      p_search, null, now() - interval '30 days', null, null, 20001)
  ), n as (select count(*) > 20000 as capped from f),
  o as (select public.inbox_owned_account_ids(p_user_id) as owned)
  select v.view, count(f.id), (select capped from n)
  from (values ('all'), ('waiting'), ('mine'), ('groups'), ('other'), ('important')) as v(view)
  left join (select * from f limit 20000) f
    on public.inbox_view_matches(v.view, f.is_group, f.is_other, f.is_important, f.mention_pending, f.latest_direction, f.assigned_to, f.channel_account_id,
      p_user_id, (select owned from o), coalesce(btrim(p_search), '') <> '')
  group by v.view
$$;

create or replace function public.inbox_waiting_by_account(p_account_ids uuid[], p_user_id uuid)
returns table(channel_account_id uuid, waiting bigint, tagged bigint, important bigint, capped boolean)
language sql stable security invoker set search_path = public as $$
  with f as materialized (
    select * from public.inbox_filtered_conversations(p_account_ids, null, null, null, null, null, null, null, now() - interval '30 days', null, null, 20001)
  ), n as (select count(*) > 20000 as capped from f)
  select f.channel_account_id,
    count(*) filter (where public.inbox_view_matches('waiting', f.is_group, f.is_other, f.is_important, f.mention_pending, f.latest_direction, f.assigned_to,
      f.channel_account_id, p_user_id, null, false)),
    count(*) filter (where f.is_group and coalesce(f.mention_pending, false)),
    count(*) filter (where f.is_important),
    (select capped from n)
  from (select * from f limit 20000) f
  group by f.channel_account_id
$$;
revoke all on function public.inbox_waiting_by_account(uuid[], uuid) from public, anon;
grant execute on function public.inbox_waiting_by_account(uuid[], uuid) to authenticated;

commit;
