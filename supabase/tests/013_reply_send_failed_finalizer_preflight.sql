-- READ-ONLY preflight for migration 013. Run before applying the migration.

select to_regclass('public.email_send_requests') is not null
  as email_send_requests_exists;

select count(*) = 22 as all_reply_failed_finalizer_columns_exist
from information_schema.columns
where table_schema = 'public'
  and table_name = 'email_send_requests'
  and column_name in (
    'id', 'workspace_id', 'email_account_id', 'send_type', 'status',
    'attempt_count', 'last_attempt_at', 'safe_error_code', 'send_lock_id',
    'send_lock_at', 'reply_to_email_message_id', 'to_addresses', 'cc_addresses',
    'bcc_addresses', 'subject', 'body_text', 'body_html', 'send_after',
    'provider_message_id', 'provider_thread_id', 'rfc_message_id', 'sent_at'
  );

select exists (
  select 1
  from pg_catalog.pg_constraint as constraint_def
  join pg_catalog.pg_class as relation on relation.oid = constraint_def.conrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'email_send_requests'
    and constraint_def.conname = 'email_send_requests_send_lock_shape'
    and constraint_def.contype = 'c'
    and constraint_def.convalidated
) as validated_send_lock_shape_exists;

select
  to_regprocedure('public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)') is not null
    as reply_claim_rpc_exists,
  to_regprocedure('public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)') is not null
    as reply_sent_finalizer_exists,
  to_regprocedure('public.finalize_reply_email_send_request_failed(uuid,uuid,uuid,uuid,text)') is null
    as proposed_reply_failed_finalizer_absent;

select exists (
  select 1
  from pg_catalog.pg_constraint as constraint_def
  join pg_catalog.pg_class as relation on relation.oid = constraint_def.conrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'email_send_requests'
    and constraint_def.contype = 'c'
    and constraint_def.convalidated
    and pg_catalog.pg_get_constraintdef(constraint_def.oid) ilike '%safe_error_code%'
) as validated_safe_error_code_checks_exist,
not exists (
  select 1
  from pg_catalog.pg_constraint as constraint_def
  join pg_catalog.pg_class as relation on relation.oid = constraint_def.conrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'email_send_requests'
    and constraint_def.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_def.oid) ilike '%safe_error_code%'
    and (
      pg_catalog.pg_get_constraintdef(constraint_def.oid) ~* 'safe_error_code[^)]*\mIN\M[[:space:]]*\('
      or pg_catalog.pg_get_constraintdef(constraint_def.oid) ~* 'safe_error_code[^)]*= ANY[[:space:]]*\('
    )
) as no_safe_error_code_value_allowlist_check;

select
  constraint_def.conname as constraint_name,
  pg_catalog.pg_get_constraintdef(constraint_def.oid) as constraint_definition,
  constraint_def.convalidated as validated
from pg_catalog.pg_constraint as constraint_def
join pg_catalog.pg_class as relation on relation.oid = constraint_def.conrelid
join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'email_send_requests'
  and constraint_def.contype = 'c'
order by constraint_def.conname;

select
  not exists (select 1 from auth.users where id = '93000000-0000-4000-8000-000000000001') as fixture_user_unused,
  not exists (select 1 from public.workspaces where id = '93000000-0000-4000-8000-000000000002') as fixture_workspace_unused,
  not exists (select 1 from public.profiles where id = '93000000-0000-4000-8000-000000000001') as fixture_profile_unused,
  not exists (select 1 from public.email_accounts where id = '93000000-0000-4000-8000-000000000003') as fixture_account_unused,
  not exists (select 1 from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004') as fixture_request_unused;
