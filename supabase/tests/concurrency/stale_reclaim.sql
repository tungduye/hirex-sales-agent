begin;
update public.email_campaign_recipient_steps set claimed_at=clock_timestamp()-interval '16 minutes' where id='97000000-0000-4000-8000-000000000061' and status='SENDING' and send_request_id is null;
create temporary table before_reclaim as select id,idempotency_key,sender_email_account_id,(select coalesce(sum(reserved_count),0) from public.email_sender_usage where workspace_id=d.workspace_id and email_account_id=d.sender_email_account_id) reserved from public.email_campaign_recipient_steps d where id='97000000-0000-4000-8000-000000000061';
select * from public.claim_email_campaign_sequence_steps('97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000085',1);
select d.id=b.id and d.idempotency_key=b.idempotency_key and d.sender_email_account_id=b.sender_email_account_id and b.reserved=(select coalesce(sum(reserved_count),0) from public.email_sender_usage where workspace_id=d.workspace_id and email_account_id=d.sender_email_account_id) as stale_reclaim_safe from public.email_campaign_recipient_steps d join before_reclaim b on b.id=d.id;
commit;
