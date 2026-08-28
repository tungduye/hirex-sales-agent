-- READ-ONLY preflight for migration 010. Safe to run before applying migration.

select to_regclass('public.email_send_requests') is not null
  as email_send_requests_exists;

select count(*) = 22 as all_reply_claim_columns_exist
from information_schema.columns
where table_schema = 'public'
  and table_name = 'email_send_requests'
  and column_name in (
    'id',
    'workspace_id',
    'email_account_id',
    'send_type',
    'status',
    'attempt_count',
    'last_attempt_at',
    'safe_error_code',
    'send_lock_id',
    'send_lock_at',
    'reply_to_email_message_id',
    'to_addresses',
    'cc_addresses',
    'bcc_addresses',
    'subject',
    'body_text',
    'body_html',
    'send_after',
    'provider_message_id',
    'provider_thread_id',
    'rfc_message_id',
    'sent_at'
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
) as send_lock_shape_constraint_exists;

select to_regprocedure(
  'public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)'
) is null as reply_claim_rpc_does_not_exist;

select not exists (
  select 1 from auth.users where id = '91000000-0000-4000-8000-000000000001'
) and not exists (
  select 1 from public.workspaces where id = '91000000-0000-4000-8000-000000000002'
) and not exists (
  select 1 from public.email_accounts where id = '91000000-0000-4000-8000-000000000003'
) and not exists (
  select 1 from public.email_send_requests
  where id in (
    '91000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000005'
  )
) as synthetic_fixture_ids_are_unused;
