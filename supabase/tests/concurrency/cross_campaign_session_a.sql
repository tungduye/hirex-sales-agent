\set ON_ERROR_STOP on
\echo 'CROSS_CAMPAIGN_A_BEGIN'
begin;
select * from public.claim_email_campaign_recipients(
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000101',
  '96000000-0000-4000-8000-000000000402',
  1
);
\echo 'CROSS_SESSION_A_HOLDS_TRANSACTION: run cross_campaign_session_b.sql in Terminal B now.'
\echo 'After Terminal B finishes or blocks, return here and type COMMIT; manually.'
-- Deliberately no COMMIT. This file must be loaded inside interactive psql.
