-- READ-ONLY preflight for migration 011. Safe to run before applying migration.

select to_regclass('public.email_send_requests') is not null
  as email_send_requests_exists;

select count(*) = 22 as all_reply_sent_finalizer_columns_exist
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
) as send_lock_shape_constraint_exists;

-- Surface every validated or unvalidated CHECK definition for manual review.
-- Constraint semantics are reviewed from pg_get_constraintdef, not inferred
-- from names alone.
select
  constraint_def.conname as constraint_name,
  pg_catalog.pg_get_constraintdef(constraint_def.oid, true) as constraint_definition,
  constraint_def.convalidated as validated
from pg_catalog.pg_constraint as constraint_def
join pg_catalog.pg_class as relation
  on relation.oid = constraint_def.conrelid
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'email_send_requests'
  and constraint_def.contype = 'c'
order by constraint_def.conname;

-- Named-presence indicators are navigation aids only. The complete definitions
-- above remain authoritative for reviewing the intended REPLY/SENT shape.
select
  bool_or(constraint_def.conname = 'email_send_requests_send_type_allowed')
    as send_type_allowed_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_status_allowed')
    as status_allowed_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_reply_target_shape')
    as reply_target_shape_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_status_shape')
    as status_shape_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_send_lock_shape')
    as send_lock_shape_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_provider_message_id_not_blank')
    as provider_message_id_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_provider_thread_id_not_blank')
    as provider_thread_id_check_exists,
  bool_or(constraint_def.conname = 'email_send_requests_rfc_message_id_not_blank')
    as rfc_message_id_check_exists
from pg_catalog.pg_constraint as constraint_def
join pg_catalog.pg_class as relation
  on relation.oid = constraint_def.conrelid
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'email_send_requests'
  and constraint_def.contype = 'c';

select to_regprocedure(
  'public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)'
) is not null as reply_claim_rpc_exists;

select to_regprocedure(
  'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)'
) is null as reply_sent_finalizer_does_not_exist;

select not exists (
  select 1 from auth.users where id = '92000000-0000-4000-8000-000000000001'
) and not exists (
  select 1 from public.workspaces where id = '92000000-0000-4000-8000-000000000002'
) and not exists (
  select 1 from public.profiles where id = '92000000-0000-4000-8000-000000000001'
) and not exists (
  select 1 from public.email_accounts where id = '92000000-0000-4000-8000-000000000003'
) and not exists (
  select 1 from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'
) as synthetic_fixture_ids_are_unused;
