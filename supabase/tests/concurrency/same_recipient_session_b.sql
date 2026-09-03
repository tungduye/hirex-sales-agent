\set ON_ERROR_STOP on
\echo 'SAME_RECIPIENT_B_BEGIN: SELECT may block until Session A commits.'
begin;
select * from public.claim_email_campaign_recipients(
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000100',
  '96000000-0000-4000-8000-000000000401',
  1
);
commit;
\echo 'SAME_RECIPIENT_B_DONE: expected claim row count is 0.'
