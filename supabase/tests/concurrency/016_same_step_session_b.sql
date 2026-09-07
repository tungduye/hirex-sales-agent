begin;
select * from public.claim_email_campaign_sequence_steps('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000009',1);
commit;
-- Expected after Session A commits: zero rows.
