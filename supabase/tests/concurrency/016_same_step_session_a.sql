begin;
select * from public.claim_email_campaign_sequence_steps('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000008',1);
select 'SESSION_A_LOCK_HELD' as marker;
-- Operator: run Session B now, then execute COMMIT here.
