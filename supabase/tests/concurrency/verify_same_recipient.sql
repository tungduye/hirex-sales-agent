\set ON_ERROR_STOP on
do $$
begin
  if (select count(*) from public.email_campaign_recipients where workspace_id='96000000-0000-4000-8000-000000000002' and campaign_id='96000000-0000-4000-8000-000000000100' and status='SENDING') <> 1 then raise exception 'same-recipient: expected exactly one SENDING recipient'; end if;
  if (select count(*) from public.email_campaign_events where workspace_id='96000000-0000-4000-8000-000000000002' and campaign_id='96000000-0000-4000-8000-000000000100' and event_type='RECIPIENT_CLAIMED') <> 1 then raise exception 'same-recipient: expected exactly one effective claim event'; end if;
  if (select coalesce(sum(reserved_count),0) from public.email_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and email_account_id='96000000-0000-4000-8000-000000000010' and bucket_kind='UTC_DAY') <> 1 then raise exception 'same-recipient: global UTC_DAY reservation is not 1'; end if;
  if (select coalesce(sum(reserved_count),0) from public.email_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and email_account_id='96000000-0000-4000-8000-000000000010' and bucket_kind='UTC_MINUTE') <> 1 then raise exception 'same-recipient: global UTC_MINUTE reservation is not 1'; end if;
  if (select coalesce(sum(sent_count),0) from public.email_campaign_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and campaign_sender_id='96000000-0000-4000-8000-000000000110' and bucket_kind='UTC_DAY') <> 1 then raise exception 'same-recipient: campaign UTC_DAY reservation is not 1'; end if;
  if (select coalesce(sum(sent_count),0) from public.email_campaign_sender_usage where workspace_id='96000000-0000-4000-8000-000000000002' and campaign_sender_id='96000000-0000-4000-8000-000000000110' and bucket_kind='UTC_MINUTE') <> 1 then raise exception 'same-recipient: campaign UTC_MINUTE reservation is not 1'; end if;
end $$;
select 'VERIFY_SAME_RECIPIENT_PASS' as result;
