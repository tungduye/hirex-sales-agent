\set ON_ERROR_STOP on
do $$
declare
  v_shared_claims integer;
  v_fallback_claims integer;
  v_total_claims integer;
begin
  select count(*) filter(where sender_email_account_id='96000000-0000-4000-8000-000000000011'),
         count(*) filter(where sender_email_account_id='96000000-0000-4000-8000-000000000012'),
         count(*) filter(where status='SENDING')
  into v_shared_claims,v_fallback_claims,v_total_claims
  from public.email_campaign_recipients
  where workspace_id='96000000-0000-4000-8000-000000000002' and campaign_id in ('96000000-0000-4000-8000-000000000101','96000000-0000-4000-8000-000000000102');

  if v_shared_claims <> 1 then raise exception 'cross-campaign: exactly one campaign must win shared account'; end if;
  if v_total_claims not between 1 and 2 then raise exception 'cross-campaign: unexpected total claim count'; end if;
  if v_fallback_claims not between 0 and 1 then raise exception 'cross-campaign: fallback account used more than once'; end if;
  if (select coalesce(sum(reserved_count),0) from public.email_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and email_account_id='96000000-0000-4000-8000-000000000011' and bucket_kind='UTC_DAY') <> 1 then raise exception 'cross-campaign: shared UTC_DAY reservation is not 1'; end if;
  if (select coalesce(sum(reserved_count),0) from public.email_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and email_account_id='96000000-0000-4000-8000-000000000011' and bucket_kind='UTC_MINUTE') <> 1 then raise exception 'cross-campaign: shared UTC_MINUTE reservation is not 1'; end if;
  if exists(select 1 from public.email_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and email_account_id in ('96000000-0000-4000-8000-000000000011','96000000-0000-4000-8000-000000000012') and reserved_count>1) then raise exception 'cross-campaign: global account cap exceeded'; end if;
  if v_total_claims=2 and v_fallback_claims<>1 then raise exception 'cross-campaign: second claim did not use enabled fallback'; end if;
end $$;
select 'VERIFY_CROSS_CAMPAIGN_PASS' as result;
