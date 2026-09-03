\set ON_ERROR_STOP on
\echo 'CROSS_CAMPAIGN_B_BEGIN: shared account is capped/locked; fallback may be selected.'
begin;
select * from public.claim_email_campaign_recipients(
  '96000000-0000-4000-8000-000000000002',
  '96000000-0000-4000-8000-000000000102',
  '96000000-0000-4000-8000-000000000403',
  1
);
commit;
\echo 'CROSS_CAMPAIGN_B_DONE'
