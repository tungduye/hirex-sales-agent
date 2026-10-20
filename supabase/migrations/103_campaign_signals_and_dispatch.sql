-- 103: Email campaigns
-- 1) Replies: look for them from each sent thread (inbound mail in that Gmail thread, from the recipient,
--    after we sent), instead of only the newest 50-100 inbound mails of the whole workspace, which let
--    replies slip past whenever many other mails arrived.
-- 2) Bounces: the same idea for delivery-failure reports.
-- 3) Dispatch: pick the running sequence campaigns that are due AND have a connected sender, oldest wait
--    first. Before, the 25 oldest running campaigns were taken even when their mailbox needed
--    reconnecting, so newer campaigns never got a turn.
begin;

create or replace function public.find_email_campaign_reply_candidates(p_limit integer default 500, p_campaign_id uuid default null)
returns table(workspace_id uuid, recipient_id uuid, email_message_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.id) s.workspace_id, r.id, m.id
  from public.email_campaign_recipient_steps s
  join public.email_campaign_recipients r on r.id = s.recipient_id and r.workspace_id = s.workspace_id
  join public.email_threads t on t.workspace_id = s.workspace_id and t.email_account_id = s.sender_email_account_id and t.provider_thread_id = s.provider_thread_id
  join public.email_messages m on m.workspace_id = t.workspace_id and m.email_thread_id = t.id and m.email_account_id = t.email_account_id
  where s.status = 'SENT' and s.provider_thread_id is not null and s.sent_at is not null
    and (p_campaign_id is null or s.campaign_id = p_campaign_id)
    and r.engagement_status in ('ACTIVE', 'COMPLETED')
    and m.direction = 'INBOUND'
    and lower(btrim(m.from_email)) = r.normalized_email
    and (m.auto_submitted is null or lower(btrim(m.auto_submitted)) = 'no')
    and m.received_at > s.sent_at
  order by r.id, m.received_at
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

create or replace function public.find_email_campaign_bounce_candidates(p_limit integer default 500, p_days integer default 60)
returns table(workspace_id uuid, recipient_id uuid, normalized_email text, email_message_id uuid, dsn_report_type text, dsn_status text, dsn_action text,
  dsn_final_recipient text, dsn_original_recipient text, failed_recipients text[], dsn_diagnostic_code text)
language sql stable security definer set search_path = '' as $$
  select distinct on (m.id, r.id) m.workspace_id, r.id, r.normalized_email, m.id, m.dsn_report_type, m.dsn_status, m.dsn_action,
    m.dsn_final_recipient, m.dsn_original_recipient, m.failed_recipients, m.dsn_diagnostic_code
  from public.email_messages m
  cross join lateral (
    select distinct lower(btrim(regexp_replace(x, '^[^;]+;\s*', ''))) as email
    from unnest(array_remove(array[m.dsn_final_recipient, m.dsn_original_recipient], null) || m.failed_recipients) as x
  ) e
  join public.email_campaign_recipient_steps s on s.workspace_id = m.workspace_id and s.sender_email_account_id = m.email_account_id
    and s.status = 'SENT' and s.sent_at < m.received_at
  join public.email_campaign_recipients r on r.id = s.recipient_id and r.workspace_id = s.workspace_id
    and r.normalized_email = e.email and r.engagement_status = 'ACTIVE'
  where m.direction = 'INBOUND'
    and (m.dsn_report_type is not null or cardinality(m.failed_recipients) > 0)
    and m.received_at > now() - make_interval(days => least(greatest(coalesce(p_days, 60), 1), 365))
  order by m.id, r.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

create or replace function public.list_due_email_sequence_campaigns(p_limit integer default 25)
returns table(id uuid, workspace_id uuid)
language sql stable security definer set search_path = '' as $$
  select c.id, c.workspace_id
  from public.email_campaigns c
  where c.status = 'RUNNING' and c.sequence_enabled
    and (c.pacing_next_at is null or c.pacing_next_at <= clock_timestamp())
    and exists (
      select 1 from public.email_campaign_senders s
      join public.email_accounts a on a.id = s.email_account_id and a.workspace_id = s.workspace_id
      where s.workspace_id = c.workspace_id and s.campaign_id = c.id and s.enabled
        and a.status = 'CONNECTED' and a.provider = 'GMAIL' and a.scopes @> array['https://www.googleapis.com/auth/gmail.send']::text[])
  order by coalesce(c.pacing_next_at, c.started_at, c.created_at), c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

revoke all on function public.find_email_campaign_reply_candidates(integer, uuid) from public, anon, authenticated;
revoke all on function public.find_email_campaign_bounce_candidates(integer, integer) from public, anon, authenticated;
revoke all on function public.list_due_email_sequence_campaigns(integer) from public, anon, authenticated;
grant execute on function public.find_email_campaign_reply_candidates(integer, uuid) to service_role;
grant execute on function public.find_email_campaign_bounce_candidates(integer, integer) to service_role;
grant execute on function public.list_due_email_sequence_campaigns(integer) to service_role;

create index if not exists email_campaign_recipient_steps_sender_sent_idx
  on public.email_campaign_recipient_steps(workspace_id, sender_email_account_id, sent_at) where status = 'SENT';

commit;
