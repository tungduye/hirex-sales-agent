begin;
delete from public.email_sender_usage where workspace_id='97000000-0000-4000-8000-000000000002' and email_account_id='97000000-0000-4000-8000-000000000003';
select * from public.claim_email_campaign_sequence_steps('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000050','97000000-0000-4000-8000-000000000087',1);
select 'CLAIM_TRANSACTION_OPEN_RUN_REPLY_SESSION_B' marker;
