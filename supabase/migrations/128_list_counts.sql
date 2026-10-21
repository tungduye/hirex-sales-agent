-- 128: Faster screens. Counts the list pages used to compute by downloading every recipient / step / send row
-- (Chiến dịch email, Zalo / Facebook cá nhân, Phân tích đa kênh) are now added up in the database.
begin;

-- Email campaigns list (server, after checking the member): one row per campaign.
create or replace function public.email_campaign_list_counts(p_workspace_id uuid)
returns table(campaign_id uuid, recipients bigint, pending bigint, failed bigint, suppressed bigint, delivery_unknown bigint, sent_status bigint,
  replied bigint, hard_bounced bigint, steps_sent bigint, followups_sent bigint, last_sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with r as (
    select campaign_id, count(*) as recipients, count(*) filter (where status = 'PENDING') as pending, count(*) filter (where status = 'FAILED') as failed,
      count(*) filter (where status = 'SUPPRESSED') as suppressed, count(*) filter (where status = 'DELIVERY_UNKNOWN') as delivery_unknown,
      count(*) filter (where status = 'SENT') as sent_status, count(*) filter (where engagement_status = 'REPLIED') as replied,
      count(*) filter (where engagement_status = 'HARD_BOUNCED') as hard_bounced
    from public.email_campaign_recipients where workspace_id = p_workspace_id group by campaign_id
  ), s as (
    select campaign_id, count(*) as steps_sent, count(*) filter (where step_order > 0) as followups_sent, max(sent_at) as last_sent_at
    from public.email_campaign_recipient_steps where workspace_id = p_workspace_id and status = 'SENT' group by campaign_id
  )
  select coalesce(r.campaign_id, s.campaign_id), coalesce(r.recipients, 0), coalesce(r.pending, 0), coalesce(r.failed, 0), coalesce(r.suppressed, 0),
    coalesce(r.delivery_unknown, 0), coalesce(r.sent_status, 0), coalesce(r.replied, 0), coalesce(r.hard_bounced, 0),
    coalesce(s.steps_sent, 0), coalesce(s.followups_sent, 0), s.last_sent_at
  from r full join s on s.campaign_id = r.campaign_id;
$$;
revoke all on function public.email_campaign_list_counts(uuid) from public, anon, authenticated;
grant execute on function public.email_campaign_list_counts(uuid) to service_role;

-- Zalo / Facebook cá nhân campaigns list (member's session): recipients, sent messages and replies per campaign.
create or replace function public.channel_campaign_list_counts(p_campaign_ids uuid[])
returns table(campaign_id uuid, quantity bigint, sent bigint, replies bigint)
language sql stable security invoker set search_path = public as $$
  select c.id,
    (select count(*) from public.channel_campaign_recipients r where r.workspace_id = c.workspace_id and r.campaign_id = c.id),
    (select count(*) from public.channel_campaign_recipient_steps st where st.workspace_id = c.workspace_id and st.campaign_id = c.id and st.status = 'SENT'),
    (select count(*) from public.channel_campaign_recipients r where r.workspace_id = c.workspace_id and r.campaign_id = c.id and r.status = 'REPLIED')
  from public.channel_campaigns c
  where c.workspace_id = public.current_workspace_id() and c.id = any(p_campaign_ids);
$$;
revoke all on function public.channel_campaign_list_counts(uuid[]) from public, anon;
grant execute on function public.channel_campaign_list_counts(uuid[]) to authenticated;

-- Phân tích đa kênh (member's session): sends per channel and status; actions with each provider receipt.
create or replace function public.channel_delivery_summary()
returns table(kind text, key text, status text, total bigint)
language sql stable security invoker set search_path = public as $$
  select 'ACTION', a.channel_type, a.status, count(*) from public.channel_outbound_actions a where a.workspace_id = public.current_workspace_id() group by 2, 3
  union all
  select 'EVENT', e.event_type, null, count(distinct e.outbound_action_id) from public.channel_delivery_events e
  where e.workspace_id = public.current_workspace_id() and e.outbound_action_id is not null group by 2
  union all
  select 'EVENT_ACTIONS', null, null, count(distinct e.outbound_action_id) from public.channel_delivery_events e
  where e.workspace_id = public.current_workspace_id() and e.outbound_action_id is not null;
$$;
revoke all on function public.channel_delivery_summary() from public, anon;
grant execute on function public.channel_delivery_summary() to authenticated;

commit;
