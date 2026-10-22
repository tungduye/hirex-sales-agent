-- 129: Faster Zalo Marketing and Gửi nhóm Zalo lists.
-- * channel_campaign_list_counts adds up per campaign in one pass (no per-row workspace check), still only in the caller's workspace.
-- * Gửi nhóm Zalo: target counts are added up in the database instead of downloading every target row
--   (the old download also stopped at the API's row limit, so big lists showed too few).
begin;

create or replace function public.channel_campaign_list_counts(p_campaign_ids uuid[])
returns table(campaign_id uuid, quantity bigint, sent bigint, replies bigint)
language sql stable security definer set search_path = '' as $$
  with w as (select public.current_workspace_id() as id),
  c as (
    select c.id from public.channel_campaigns c
    where c.workspace_id = (select id from w) and c.id = any(p_campaign_ids)
  ),
  r as (
    select r.campaign_id, count(*) as quantity, count(*) filter (where r.status = 'REPLIED') as replies
    from public.channel_campaign_recipients r
    where r.workspace_id = (select id from w) and r.campaign_id = any(p_campaign_ids)
    group by r.campaign_id
  ),
  s as (
    select st.campaign_id, count(*) as sent
    from public.channel_campaign_recipient_steps st
    where st.workspace_id = (select id from w) and st.campaign_id = any(p_campaign_ids) and st.status = 'SENT'
    group by st.campaign_id
  )
  select c.id, coalesce(r.quantity, 0), coalesce(s.sent, 0), coalesce(r.replies, 0)
  from c left join r on r.campaign_id = c.id left join s on s.campaign_id = c.id;
$$;
revoke all on function public.channel_campaign_list_counts(uuid[]) from public, anon;
grant execute on function public.channel_campaign_list_counts(uuid[]) to authenticated, service_role;

-- Gửi nhóm Zalo list (server, after checking the member): one row per broadcast.
create or replace function public.zalo_broadcast_target_counts(p_workspace_id uuid, p_broadcast_ids uuid[])
returns table(broadcast_id uuid, total bigint, sent bigint, failed bigint, waiting bigint, pinned bigint, pinned_messages bigint)
language sql stable security definer set search_path = '' as $$
  select t.broadcast_id, count(*), count(*) filter (where t.status = 'SENT'), count(*) filter (where t.status in ('FAILED', 'UNKNOWN')),
    count(*) filter (where t.status = 'PENDING'), count(*) filter (where t.pin_status = 'PINNED'), count(*) filter (where t.message_pin_status = 'PINNED')
  from public.zalo_broadcast_targets t
  where t.workspace_id = p_workspace_id and t.broadcast_id = any(p_broadcast_ids)
  group by t.broadcast_id;
$$;
revoke all on function public.zalo_broadcast_target_counts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.zalo_broadcast_target_counts(uuid, uuid[]) to service_role;

-- Broadcasts that used any of the member's nicks (who may see which broadcast).
create or replace function public.zalo_broadcast_ids_for_accounts(p_workspace_id uuid, p_account_ids uuid[])
returns table(broadcast_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct t.broadcast_id from public.zalo_broadcast_targets t
  where t.workspace_id = p_workspace_id and t.channel_account_id = any(p_account_ids);
$$;
revoke all on function public.zalo_broadcast_ids_for_accounts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.zalo_broadcast_ids_for_accounts(uuid, uuid[]) to service_role;

commit;
