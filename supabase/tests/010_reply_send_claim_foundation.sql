-- Remote-safe rollback-only validation for migration 010.
-- Sequential claims validate CAS/idempotency; this is not a two-session concurrency test.

begin;

create or replace function pg_temp.assert_true(p_value boolean, p_case text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'FAILED: %', p_case; end if;
end;
$$;

create or replace function pg_temp.assert_false(p_value boolean, p_case text)
returns void language plpgsql as $$
begin
  if p_value is distinct from false then raise exception 'FAILED: %', p_case; end if;
end;
$$;

create or replace function pg_temp.assert_schema_rejects(p_sql text, p_case text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when not_null_violation or check_violation then return;
  end;
  raise exception 'FAILED: schema accepted malformed fixture: %', p_case;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '91000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'phase-2b4c-fixture@example.test', '',
  clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
);

insert into public.workspaces (id, name)
values ('91000000-0000-4000-8000-000000000002', 'Phase 2B.4C rollback fixture');

insert into public.profiles (id, workspace_id, full_name) values (
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  'Phase 2B.4C Fixture'
);

insert into public.email_accounts (
  id, workspace_id, connected_by, provider, email_address, status
) values (
  '91000000-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000001',
  'GMAIL', 'sender@example.test', 'CONNECTED'
);

insert into public.email_send_requests (
  id, workspace_id, email_account_id, send_type, status,
  reply_to_email_message_id, to_addresses, cc_addresses, bcc_addresses,
  subject, body_text, body_html, send_after, idempotency_key, attempt_count
) values (
  '91000000-0000-4000-8000-000000000004',
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003',
  'REPLY', 'PENDING', '91000000-0000-4000-8000-000000000006',
  array['recipient@example.test'], '{}', '{}', 'Re: Fixture', E'Reply body\n',
  null, null, '91000000-0000-4000-8000-000000000007', 0
);

create or replace function pg_temp.reset_request()
returns void language sql as $$
  update public.email_send_requests
  set send_type = 'REPLY', status = 'PENDING',
      reply_to_email_message_id = '91000000-0000-4000-8000-000000000006',
      to_addresses = array['recipient@example.test'], cc_addresses = '{}', bcc_addresses = '{}',
      subject = 'Re: Fixture', body_text = E'Reply body\n', body_html = null,
      send_after = null, attempt_count = 0, last_attempt_at = null,
      safe_error_code = null, provider_message_id = null, provider_thread_id = null,
      rfc_message_id = null, sent_at = null, send_lock_id = null, send_lock_at = null
  where id = '91000000-0000-4000-8000-000000000004'
$$;

select pg_temp.assert_true((
  select count(*) = 1 and bool_and(
    request_id = '91000000-0000-4000-8000-000000000004'
    and workspace_id = '91000000-0000-4000-8000-000000000002'
    and email_account_id = '91000000-0000-4000-8000-000000000003'
    and reply_to_email_message_id = '91000000-0000-4000-8000-000000000006'
    and send_lock_id = '91000000-0000-4000-8000-000000000008'
    and attempt_count = 1
  ) from public.claim_reply_email_send_request(
    '91000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000008'
  )
), '1 eligible claim and minimum return shape');

select pg_temp.assert_true((
  select status = 'SENDING' and attempt_count = 1
    and send_lock_id = '91000000-0000-4000-8000-000000000008'
    and send_lock_at is not null and last_attempt_at is not null
    and send_lock_at = last_attempt_at
  from public.email_send_requests where id = '91000000-0000-4000-8000-000000000004'
), '2 atomic state, attempt and lock mutation');

select pg_temp.assert_true((
  select count(*) = 0 from public.claim_reply_email_send_request(
    '91000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000009')
), '3 second claim blocked');

select pg_temp.reset_request();
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000099',
  '91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000008')), '4 wrong workspace');
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000099', '91000000-0000-4000-8000-000000000008')), '5 wrong account');

update public.email_send_requests set send_type = 'NEW', reply_to_email_message_id = null
where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000008')), '6 NEW blocked');

select pg_temp.reset_request();
update public.email_send_requests set status = 'SENDING', send_lock_id = '91000000-0000-4000-8000-000000000009', send_lock_at = clock_timestamp()
where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000008')), '7 already SENDING');

select pg_temp.reset_request();
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set reply_to_email_message_id = null where id = '91000000-0000-4000-8000-000000000004'$sql$, '8 missing reply target');
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set to_addresses = '{}' where id = '91000000-0000-4000-8000-000000000004'$sql$, '9 zero recipients');

update public.email_send_requests set to_addresses = array['   '] where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000008')), '9a blank recipient');

select pg_temp.reset_request();
update public.email_send_requests set to_addresses = array['one@example.test', 'two@example.test'] where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000008')), '10 multiple recipients');

select pg_temp.reset_request(); update public.email_send_requests set cc_addresses = array['cc@example.test'] where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '11 cc blocked');
select pg_temp.reset_request(); update public.email_send_requests set bcc_addresses = array['bcc@example.test'] where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '12 bcc blocked');
select pg_temp.reset_request(); update public.email_send_requests set body_html = '<p>html</p>' where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '13 HTML blocked');

select pg_temp.reset_request();
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set subject = '  ' where id = '91000000-0000-4000-8000-000000000004'$sql$, '14 blank subject');
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set subject = null where id = '91000000-0000-4000-8000-000000000004'$sql$, '15 null subject');
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set body_text = '  ' where id = '91000000-0000-4000-8000-000000000004'$sql$, '16 blank body');
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set body_text = null, body_html = null where id = '91000000-0000-4000-8000-000000000004'$sql$, '17 null body');

select pg_temp.reset_request(); update public.email_send_requests set send_after = clock_timestamp() where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '18 scheduled blocked');
select pg_temp.reset_request(); update public.email_send_requests set provider_message_id = 'message' where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '19 provider message blocked');
select pg_temp.reset_request(); update public.email_send_requests set provider_thread_id = 'thread' where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '20 provider thread blocked');
select pg_temp.reset_request(); update public.email_send_requests set rfc_message_id = '<old@example.test>' where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '21 RFC result blocked');

select pg_temp.reset_request();
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set sent_at = clock_timestamp() where id = '91000000-0000-4000-8000-000000000004'$sql$, '22 sent timestamp on PENDING');

update public.email_send_requests set attempt_count = 1 where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '23 prior attempt blocked');
select pg_temp.reset_request(); update public.email_send_requests set last_attempt_at = clock_timestamp() where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '24 prior attempt timestamp blocked');
select pg_temp.reset_request(); update public.email_send_requests set safe_error_code = 'GMAIL_TEMPORARY_ERROR' where id = '91000000-0000-4000-8000-000000000004';
select pg_temp.assert_true((select count(*) = 0 from public.claim_reply_email_send_request('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008')), '25 prior safe error blocked');

select pg_temp.reset_request();
insert into public.email_send_requests (
  id, workspace_id, email_account_id, send_type, status, reply_to_email_message_id,
  to_addresses, subject, body_text, idempotency_key
) values (
  '91000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003', 'REPLY', 'PENDING',
  '91000000-0000-4000-8000-000000000006', array['other@example.test'],
  'Re: Other', 'Other body', '91000000-0000-4000-8000-000000000010'
);
select pg_temp.assert_true((select count(*) = 1 from public.claim_reply_email_send_request(
  '91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000011')), '26 exact other request claimed');
select pg_temp.assert_true((select status = 'PENDING' and send_lock_id is null
  from public.email_send_requests where id = '91000000-0000-4000-8000-000000000004'), '27 other lock cannot affect first request');

select pg_temp.assert_false(exists (
  select 1 from pg_catalog.pg_proc as procedure
  cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) as privilege
  where procedure.oid = 'public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)'::regprocedure
    and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
), '28 PUBLIC cannot execute');
select pg_temp.assert_false(has_function_privilege('anon', 'public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)', 'EXECUTE'), '29 anon cannot execute');
select pg_temp.assert_false(has_function_privilege('authenticated', 'public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)', 'EXECUTE'), '30 authenticated cannot execute');
select pg_temp.assert_true(has_function_privilege('service_role', 'public.claim_reply_email_send_request(uuid,uuid,uuid,uuid)', 'EXECUTE'), '31 service_role can execute');

-- All fixture rows, helper functions, and mutations above are transaction-local.
rollback;

select not exists (
  select 1 from auth.users where id = '91000000-0000-4000-8000-000000000001'
) as fixture_user_removed,
not exists (
  select 1 from public.workspaces where id = '91000000-0000-4000-8000-000000000002'
) as fixture_workspace_removed,
not exists (
  select 1 from public.profiles where id = '91000000-0000-4000-8000-000000000001'
) as fixture_profile_removed,
not exists (
  select 1 from public.email_accounts where id = '91000000-0000-4000-8000-000000000003'
) as fixture_account_removed,
not exists (
  select 1 from public.email_send_requests
  where id in (
    '91000000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000005'
  )
) as fixture_send_requests_removed;
