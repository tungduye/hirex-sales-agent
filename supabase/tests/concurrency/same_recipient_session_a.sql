\set ON_ERROR_STOP on
\echo 'SAME_RECIPIENT_A_BEGIN'
begin;
select * from public.claim_email_campaign_recipients(
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000100',
  '96000000-0000-4000-8000-000000000400',
  1
);
\echo 'SESSION_A_HOLDS_TRANSACTION: run same_recipient_session_b.sql in Terminal B now.'
\echo 'After Terminal B is visibly blocked, return here and type COMMIT; manually.'
-- Deliberately no COMMIT. This file must be loaded inside interactive psql.
