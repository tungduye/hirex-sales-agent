select engagement_status='REPLIED' as recipient_never_reactivates from public.email_campaign_recipients where id='97000000-0000-4000-8000-000000000055';
select count(*)=0 as no_future_pending_after_reply from public.email_campaign_recipient_steps where recipient_id='97000000-0000-4000-8000-000000000055' and status='PENDING';
select count(*)<=1 as at_most_one_inflight_claim from public.email_campaign_recipient_steps where recipient_id='97000000-0000-4000-8000-000000000055' and status='SENDING';
