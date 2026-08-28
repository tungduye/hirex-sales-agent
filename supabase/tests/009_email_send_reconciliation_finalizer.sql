-- Remote-safe rollback-only validation for migration 009.
-- This script creates fixture rows only and does not alter production schema.
-- It tests sequential CAS/idempotency, not true two-session concurrency.

begin;

create or replace function pg_temp.assert_true(p_value boolean, p_case text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'FAILED: %', p_case;
  end if;
end;
$$;

create or replace function pg_temp.assert_false(p_value boolean, p_case text)
returns void language plpgsql as $$
begin
  if p_value is distinct from false then
    raise exception 'FAILED: %', p_case;
  end if;
end;
$$;

create or replace function pg_temp.assert_schema_rejects(p_sql text, p_case text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when not_null_violation or check_violation then
      return;
  end;
  raise exception 'FAILED: schema accepted malformed fixture: %', p_case;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'phase-2b3e-fixture@example.test', '',
  clock_timestamp(), '{}'::jsonb, '{}'::jsonb,
  clock_timestamp(), clock_timestamp()
);

insert into public.workspaces (id, name)
values ('90000000-0000-0000-0000-000000000002', 'Phase 2B.3E rollback fixture');

insert into public.profiles (id, workspace_id, full_name)
values (
  '90000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002',
  'Phase 2B.3E Fixture'
);

insert into public.email_accounts (
  id, workspace_id, connected_by, provider, email_address, status
) values (
  '90000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000001',
  'GMAIL', 'sender@example.test', 'CONNECTED'
);

insert into public.email_threads (
  id, workspace_id, email_account_id, provider, provider_thread_id
) values (
  '90000000-0000-0000-0000-000000000004',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003',
  'GMAIL', 'fixture-thread'
);

insert into public.email_send_requests (
  id, workspace_id, email_account_id, send_type, status,
  to_addresses, cc_addresses, bcc_addresses, subject, body_text,
  body_html, send_after, idempotency_key, attempt_count,
  rfc_message_id, send_lock_id, send_lock_at
) values (
  '90000000-0000-0000-0000-000000000005',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003',
  'NEW', 'SENDING', array['recipient@example.test'], '{}', '{}',
  'Fixture subject', E'Fixture body\r\n', null, null,
  '90000000-0000-0000-0000-000000000006', 1,
  '<fixture@example.test>',
  '90000000-0000-0000-0000-000000000007', clock_timestamp()
);

insert into public.email_messages (
  id, workspace_id, email_account_id, email_thread_id, provider,
  provider_message_id, direction, from_email, to_emails, subject,
  body_text, labels, sent_at, provider_internal_date,
  hirex_send_request_id
) values (
  '90000000-0000-0000-0000-000000000008',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000004',
  'GMAIL', 'fixture-message', 'OUTBOUND', 'Sender@Example.Test',
  array['RECIPIENT@example.test'], 'Fixture subject', E'Fixture body\n',
  array['SENT'], clock_timestamp(), clock_timestamp(),
  '90000000-0000-0000-0000-000000000005'
);

create or replace function pg_temp.reset_request(
  p_provider_message_id text default null,
  p_provider_thread_id text default null
)
returns void language sql as $$
  update public.email_send_requests
  set status = 'SENDING', sent_at = null, safe_error_code = null,
      provider_message_id = p_provider_message_id,
      provider_thread_id = p_provider_thread_id,
      send_lock_id = '90000000-0000-0000-0000-000000000007',
      send_lock_at = clock_timestamp()
  where id = '90000000-0000-0000-0000-000000000005'
$$;

select pg_temp.assert_true(
  public.finalize_reconciled_email_send_request(
    '90000000-0000-0000-0000-000000000005',
    '90000000-0000-0000-0000-000000000002',
    '90000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000008'
  ), '1 exact canonical evidence'
);
select pg_temp.assert_true(
  (
    select count(*) = 1
      and bool_and(
        actor_id is null
        and entity_type = 'email_send_request'
        and entity_id = '90000000-0000-0000-0000-000000000005'
        and metadata = jsonb_build_object(
          'request_id', '90000000-0000-0000-0000-000000000005'::uuid,
          'email_message_id', '90000000-0000-0000-0000-000000000008'::uuid
        )
      )
    from public.audit_logs
    where workspace_id = '90000000-0000-0000-0000-000000000002'
      and action = 'EMAIL_SEND_RECONCILED'
  ), '1 audit row and minimal metadata'
);

select pg_temp.assert_false(
  public.finalize_reconciled_email_send_request(
    '90000000-0000-0000-0000-000000000005',
    '90000000-0000-0000-0000-000000000002',
    '90000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000008'
  ), '2 second finalization'
);
select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.audit_logs
    where workspace_id = '90000000-0000-0000-0000-000000000002'
      and action = 'EMAIL_SEND_RECONCILED'
  ), '2 second finalization creates no audit row'
);

update public.email_send_requests
set status = 'CANCELLED', sent_at = null, provider_message_id = null,
    provider_thread_id = null, send_lock_id = null, send_lock_at = null
where id = '90000000-0000-0000-0000-000000000005';
select pg_temp.assert_false(
  public.finalize_reconciled_email_send_request(
    '90000000-0000-0000-0000-000000000005',
    '90000000-0000-0000-0000-000000000002',
    '90000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000008'
  ), '3 non-SENDING'
);

-- Production schema prevents malformed lock shapes before the RPC runs. The
-- RPC independently checks both lock fields. Validate the named, validated
-- CHECK and both implication branches without taking an ALTER TABLE lock.
select pg_temp.assert_true(
  (
    select count(*) = 1
      and bool_and(constraint_row.contype = 'c')
      and bool_and(constraint_row.convalidated)
      and bool_and(
        constraint_row.definition ~
          'status = ''sending''::text.*send_lock_id is not null.*send_lock_at is not null'
      )
      and bool_and(
        constraint_row.definition ~
          'status <> ''sending''::text.*send_lock_id is null.*send_lock_at is null'
      )
    from (
      select
        constraint_def.contype,
        constraint_def.convalidated,
        regexp_replace(
          lower(pg_get_constraintdef(constraint_def.oid)),
          '[[:space:]]+',
          ' ',
          'g'
        ) as definition
      from pg_catalog.pg_constraint as constraint_def
      join pg_catalog.pg_class as relation
        on relation.oid = constraint_def.conrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = 'email_send_requests'
        and constraint_def.conname = 'email_send_requests_send_lock_shape'
    ) as constraint_row
  ), '4 production send-lock shape constraint'
);

select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005',
  '90000000-0000-0000-0000-000000000099',
  '90000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000008'), '5 wrong workspace');
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000099',
  '90000000-0000-0000-0000-000000000008'), '6 wrong account');

update public.email_messages set labels = '{}' where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '7 no SENT label');

update public.email_messages set labels = array['SENT', 'SPAM'] where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '8 SPAM');
update public.email_messages set labels = array['SENT', 'TRASH'] where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '8 TRASH');

update public.email_messages set labels = array['SENT'], from_email = 'other@example.test'
where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '9 sender mismatch');

update public.email_messages set from_email = 'sender@example.test', to_emails = array['other@example.test']
where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '10 recipient mismatch');

update public.email_messages set to_emails = array['recipient@example.test'], subject = 'Other subject'
where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '11 subject mismatch');

update public.email_messages set subject = 'Fixture subject', body_text = 'Other body'
where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '12 body mismatch');

update public.email_messages set body_text = E'Fixture body\n'
where id = '90000000-0000-0000-0000-000000000008';
update public.email_send_requests set to_addresses = array['   ']
where id = '90000000-0000-0000-0000-000000000005';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '12a blank request recipient');
update public.email_send_requests set to_addresses = array['recipient@example.test']
where id = '90000000-0000-0000-0000-000000000005';

update public.email_messages set to_emails = array['   ']
where id = '90000000-0000-0000-0000-000000000008';
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '12b blank canonical recipient');
update public.email_messages set to_emails = array['recipient@example.test']
where id = '90000000-0000-0000-0000-000000000008';

-- These malformed shapes cannot be stored under the existing mailbox/send
-- schema. Validate that the schema rejects them; migration 009 still contains
-- explicit fail-closed guards in case runtime schema assumptions ever drift.
select pg_temp.assert_schema_rejects(
  $sql$update public.email_messages set labels = null where id = '90000000-0000-0000-0000-000000000008'$sql$,
  'labels NULL');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_messages set to_emails = null where id = '90000000-0000-0000-0000-000000000008'$sql$,
  'to_emails NULL');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_messages set to_emails = array[null]::text[] where id = '90000000-0000-0000-0000-000000000008'$sql$,
  'canonical recipient NULL element');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_send_requests set to_addresses = array[null]::text[] where id = '90000000-0000-0000-0000-000000000005'$sql$,
  'request recipient NULL element');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_send_requests set subject = '   ' where id = '90000000-0000-0000-0000-000000000005'$sql$,
  'blank request subject');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_messages set provider_message_id = null where id = '90000000-0000-0000-0000-000000000008'$sql$,
  'canonical provider message ID NULL');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_messages set provider_message_id = '   ' where id = '90000000-0000-0000-0000-000000000008'$sql$,
  'canonical provider message ID blank');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_threads set provider_thread_id = null where id = '90000000-0000-0000-0000-000000000004'$sql$,
  'canonical provider thread ID NULL');
select pg_temp.assert_schema_rejects(
  $sql$update public.email_threads set provider_thread_id = '   ' where id = '90000000-0000-0000-0000-000000000004'$sql$,
  'canonical provider thread ID blank');

select pg_temp.reset_request('conflicting-message', null);
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '13 provider message conflict');

select pg_temp.reset_request(null, 'conflicting-thread');
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '14 provider thread conflict');

select pg_temp.reset_request();
insert into public.email_messages (
  id, workspace_id, email_account_id, email_thread_id, provider,
  provider_message_id, direction, from_email, to_emails, subject,
  body_text, labels, hirex_send_request_id
) values (
  '90000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000004',
  'GMAIL', 'duplicate-fixture-message', 'OUTBOUND', 'sender@example.test',
  array['recipient@example.test'], 'Fixture subject', E'Fixture body\n', array['SENT'],
  '90000000-0000-0000-0000-000000000005'
);
select pg_temp.assert_false(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '15 duplicate correlation messages');
delete from public.email_messages where id = '90000000-0000-0000-0000-000000000009';

select pg_temp.assert_true(public.finalize_reconciled_email_send_request(
  '90000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000008'), '16 NULL provider IDs with exact evidence');

select pg_temp.assert_false(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) as privilege
    where procedure.oid =
      'public.finalize_reconciled_email_send_request(uuid,uuid,uuid,uuid)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ), '17 PUBLIC cannot execute RPC'
);
select pg_temp.assert_false(
  has_function_privilege(
    'anon',
    'public.finalize_reconciled_email_send_request(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ), '18 anon cannot execute RPC'
);
select pg_temp.assert_false(
  has_function_privilege(
    'authenticated',
    'public.finalize_reconciled_email_send_request(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ), '19 authenticated cannot execute RPC'
);
select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.finalize_reconciled_email_send_request(uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ), '20 service_role can execute RPC'
);

rollback;
