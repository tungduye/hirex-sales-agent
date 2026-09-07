-- READ-ONLY preflight. Run before migration 017.
select
  to_regprocedure('public.apply_email_campaign_signal(uuid,uuid,text,text,uuid,text)') is not null as signal_rpc_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_campaign_recipients' and column_name='engagement_status') as engagement_status_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_campaign_recipients' and column_name='replied_at') as replied_at_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_campaign_recipients' and column_name='reply_email_message_id') as reply_email_message_id_exists;
