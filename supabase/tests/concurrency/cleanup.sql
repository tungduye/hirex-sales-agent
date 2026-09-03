\set ON_ERROR_STOP on
\echo 'CLEANUP_START'
begin;
update public.email_campaigns
set status='DRAFT',scheduled_at=null,started_at=null,paused_at=null,completed_at=null,cancelled_at=null
where workspace_id='96000000-0000-4000-8000-000000000002' and id in ('96000000-0000-4000-8000-000000000100','96000000-0000-4000-8000-000000000101','96000000-0000-4000-8000-000000000102');

delete from public.email_campaign_sender_usage
where workspace_id='96000000-0000-4000-8000-000000000002'
  and campaign_sender_id in ('96000000-0000-4000-8000-000000000110','96000000-0000-4000-8000-000000000111','96000000-0000-4000-8000-000000000112','96000000-0000-4000-8000-000000000113');
delete from public.email_campaign_events
where workspace_id='96000000-0000-4000-8000-000000000002'
  and campaign_id in ('96000000-0000-4000-8000-000000000100','96000000-0000-4000-8000-000000000101','96000000-0000-4000-8000-000000000102');
delete from public.email_campaign_recipients
where workspace_id='96000000-0000-4000-8000-000000000002'
  and id in ('96000000-0000-4000-8000-000000000200','96000000-0000-4000-8000-000000000201','96000000-0000-4000-8000-000000000202');
delete from public.email_campaign_senders
where workspace_id='96000000-0000-4000-8000-000000000002'
  and id in ('96000000-0000-4000-8000-000000000110','96000000-0000-4000-8000-000000000111','96000000-0000-4000-8000-000000000112','96000000-0000-4000-8000-000000000113');
delete from public.email_sender_usage
where workspace_id='96000000-0000-4000-8000-000000000002'
  and email_account_id in ('96000000-0000-4000-8000-000000000010','96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000012');
delete from public.email_sender_limits
where workspace_id='96000000-0000-4000-8000-000000000002'
  and email_account_id in ('96000000-0000-4000-8000-000000000010','96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000012');
delete from public.email_suppressions
where workspace_id='96000000-0000-4000-8000-000000000002'
  and normalized_email in ('same-race@example.test','cross-a@example.test','cross-b@example.test');
delete from public.email_campaigns where workspace_id='96000000-0000-4000-8000-000000000002' and id in ('96000000-0000-4000-8000-000000000100','96000000-0000-4000-8000-000000000101','96000000-0000-4000-8000-000000000102');
delete from public.email_accounts where workspace_id='96000000-0000-4000-8000-000000000002' and id in ('96000000-0000-4000-8000-000000000010','96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000012');
delete from public.profiles where workspace_id='96000000-0000-4000-8000-000000000002' and id='96000000-0000-4000-8000-000000000001';
delete from public.workspaces where id='96000000-0000-4000-8000-000000000002';
delete from auth.users where id='96000000-0000-4000-8000-000000000001';

do $$
begin
  if exists(select 1 from auth.users where id='96000000-0000-4000-8000-000000000001') then raise exception 'fixture user remains'; end if;
  if exists(select 1 from public.workspaces where id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture workspace remains'; end if;
  if exists(select 1 from public.email_accounts where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture accounts remain'; end if;
  if exists(select 1 from public.email_campaigns where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture campaigns remain'; end if;
  if exists(select 1 from public.email_campaign_recipients where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture recipients remain'; end if;
  if exists(select 1 from public.email_campaign_senders where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture senders remain'; end if;
  if exists(select 1 from public.email_campaign_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture campaign usage remains'; end if;
  if exists(select 1 from public.email_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture global usage remains'; end if;
  if exists(select 1 from public.email_sender_limits where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture limits remain'; end if;
  if exists(select 1 from public.email_campaign_events where workspace_id='96000000-0000-4000-8000-000000000002') then raise exception 'fixture events remain'; end if;
end $$;

commit;
select 'CLEANUP_PASS' as result;
