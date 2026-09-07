begin;
delete from public.email_sender_usage where workspace_id='97000000-0000-4000-8000-000000000002' and email_account_id='97000000-0000-4000-8000-000000000003';
select * from public.claim_email_campaign_sequence_steps('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000020','97000000-0000-4000-8000-000000000083',1);
select 'GLOBAL_A_LOCK_HELD_RUN_B_THEN_COMMIT_A' marker;
