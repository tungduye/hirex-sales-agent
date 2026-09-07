select count(*)=1 as exactly_one_sending from public.email_campaign_recipient_steps where workspace_id='97000000-0000-4000-8000-000000000001' and status='SENDING';
select coalesce(max(reserved_count),0)<=1 as global_quota_not_double_reserved from public.email_sender_usage where workspace_id='97000000-0000-4000-8000-000000000001';
