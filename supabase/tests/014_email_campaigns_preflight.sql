-- READ-ONLY preflight. Expected booleans are true before applying migration 014.
select
  to_regclass('public.workspaces') is not null as workspaces_exists,
  to_regclass('public.profiles') is not null as profiles_exists,
  to_regclass('public.contacts') is not null as contacts_exists,
  to_regclass('public.email_accounts') is not null as email_accounts_exists,
  to_regclass('public.email_send_requests') is not null as email_send_requests_exists,
  to_regprocedure('public.set_updated_at()') is not null as updated_at_function_exists,
  to_regprocedure('public.current_workspace_id()') is not null as current_workspace_function_exists,
  exists(select 1 from pg_catalog.pg_extension where extname='pgcrypto') as pgcrypto_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_accounts' and column_name='scopes') as account_scopes_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_send_requests' and column_name='id') as send_request_id_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_send_requests' and column_name='workspace_id') as send_request_workspace_id_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='email_send_requests' and column_name='idempotency_key') as send_idempotency_exists,
  not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_send_requests'::regclass and conname='email_send_requests_id_workspace_key') as send_requests_id_workspace_key_absent,
  to_regclass('public.email_campaigns') is null as campaigns_absent,
  to_regclass('public.email_campaign_senders') is null as senders_absent,
  to_regclass('public.email_campaign_recipients') is null as recipients_absent,
  to_regclass('public.email_campaign_sender_usage') is null as usage_absent,
  to_regclass('public.email_suppressions') is null as suppressions_absent,
  to_regclass('public.email_campaign_events') is null as events_absent,
  to_regclass('public.email_sender_limits') is null as global_limits_absent,
  to_regclass('public.email_sender_usage') is null as global_usage_absent,
  to_regprocedure('public.claim_email_campaign_recipients(uuid,uuid,uuid,integer)') is null as claim_rpc_absent,
  to_regprocedure('public.finalize_email_campaign_recipient(uuid,uuid,uuid,text,uuid,text)') is null as finalize_rpc_absent,
  to_regprocedure('public.complete_email_campaign_if_idle(uuid,uuid)') is null as completion_rpc_absent;
select
  to_regprocedure('public.require_draft_campaign_configuration()') is null as sender_guard_absent,
  to_regprocedure('public.protect_campaign_recipient_snapshot()') is null as recipient_guard_absent;
select to_regprocedure('public.preserve_email_suppression_precedence()') is null as suppression_guard_absent;

select
  exists(select 1 from pg_catalog.pg_constraint where conrelid='public.profiles'::regclass and contype in ('p','u') and pg_get_constraintdef(oid) ilike '%id%workspace_id%') as profiles_composite_unique,
  exists(select 1 from pg_catalog.pg_constraint where conrelid='public.contacts'::regclass and contype in ('p','u') and pg_get_constraintdef(oid) ilike '%id%workspace_id%') as contacts_composite_unique,
  exists(select 1 from pg_catalog.pg_constraint where conrelid='public.email_accounts'::regclass and contype in ('p','u') and pg_get_constraintdef(oid) ilike '%id%workspace_id%') as email_accounts_composite_unique,
  (select count(*)=7 from information_schema.columns where table_schema='public' and table_name='email_send_requests' and column_name in ('id','workspace_id','email_account_id','send_type','status','idempotency_key','to_addresses')) as send_finalizer_columns_exist;
