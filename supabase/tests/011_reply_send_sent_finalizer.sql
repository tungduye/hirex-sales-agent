-- Remote-safe rollback-only validation for migration 011.
-- Sequential finalization validates exact-lock CAS/idempotency, not two-session concurrency.

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
  begin execute p_sql;
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
  '92000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'phase-2b4fa-fixture@example.test', '',
  clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
);

insert into public.workspaces (id, name)
values ('92000000-0000-4000-8000-000000000002', 'Phase 2B.4F-A rollback fixture');

insert into public.profiles (id, workspace_id, full_name) values (
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  'Phase 2B.4F-A Fixture'
);

insert into public.email_accounts (
  id, workspace_id, connected_by, provider, email_address, status
) values (
  '92000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  'GMAIL', 'sender@example.test', 'CONNECTED'
);

insert into public.email_send_requests (
  id, workspace_id, email_account_id, send_type, status,
  reply_to_email_message_id, to_addresses, cc_addresses, bcc_addresses,
  subject, body_text, body_html, send_after, idempotency_key, attempt_count,
  last_attempt_at, send_lock_id, send_lock_at
) values (
  '92000000-0000-4000-8000-000000000004',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000003',
  'REPLY', 'SENDING', '92000000-0000-4000-8000-000000000005',
  array['recipient@example.test'], '{}', '{}', 'Re: Fixture', E'Reply body\n',
  null, null, '92000000-0000-4000-8000-000000000006', 1,
  '2026-08-28T01:00:00Z', '92000000-0000-4000-8000-000000000007', '2026-08-28T01:00:00Z'
);

create or replace function pg_temp.reset_request()
returns void language sql as $$
  update public.email_send_requests
  set send_type = 'REPLY', status = 'SENDING', attempt_count = 1,
      last_attempt_at = '2026-08-28T01:00:00Z',
      send_lock_id = '92000000-0000-4000-8000-000000000007',
      send_lock_at = '2026-08-28T01:00:00Z', safe_error_code = null,
      reply_to_email_message_id = '92000000-0000-4000-8000-000000000005',
      to_addresses = array['recipient@example.test'], cc_addresses = '{}', bcc_addresses = '{}',
      subject = 'Re: Fixture', body_text = E'Reply body\n', body_html = null, send_after = null,
      provider_message_id = null, provider_thread_id = null, rfc_message_id = null, sent_at = null
  where id = '92000000-0000-4000-8000-000000000004'
$$;

select pg_temp.assert_true(public.finalize_reply_email_send_request_sent(
  '92000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000007',
  'gmail_message_1', 'gmail_thread_1'), '1 eligible REPLY finalized');
select pg_temp.assert_true((select status = 'SENT' from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '2 status SENT');
select pg_temp.assert_true((select provider_message_id = 'gmail_message_1' from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '3 provider message exact');
select pg_temp.assert_true((select provider_thread_id = 'gmail_thread_1' from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '4 provider thread exact');
select pg_temp.assert_true((select sent_at is not null from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '5 sent timestamp populated');
select pg_temp.assert_true((select rfc_message_id is null from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '6 RFC Message-ID remains NULL');
select pg_temp.assert_true((select send_lock_id is null from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '7 lock ID cleared');
select pg_temp.assert_true((select send_lock_at is null from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '8 lock timestamp cleared');
select pg_temp.assert_true((select attempt_count = 1 from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '9 attempt remains one');
select pg_temp.assert_true((select last_attempt_at = '2026-08-28T01:00:00Z'::timestamptz from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004'), '10 attempt timestamp unchanged');
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent(
  '92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','second_message','gmail_thread_1'), '11 second finalization');

select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000099','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '12 wrong workspace');
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000099','92000000-0000-4000-8000-000000000007','message','thread'), '13 wrong account');
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000099','message','thread'), '14 wrong lock');

select pg_temp.reset_request(); update public.email_send_requests set last_attempt_at = null where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '14a missing attempt timestamp');
select pg_temp.reset_request(); update public.email_send_requests set last_attempt_at = '2026-08-28T01:00:01Z' where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '14b claim timestamp mismatch');

select pg_temp.reset_request();
update public.email_send_requests set send_type = 'NEW', reply_to_email_message_id = null where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '15 NEW blocked');

select pg_temp.reset_request(); update public.email_send_requests set status = 'PENDING', send_lock_id = null, send_lock_at = null where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '16 PENDING blocked');
select pg_temp.reset_request(); update public.email_send_requests set status = 'SENT', provider_message_id = 'old', provider_thread_id = 'old', sent_at = clock_timestamp(), send_lock_id = null, send_lock_at = null where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '17 SENT blocked');
select pg_temp.reset_request(); update public.email_send_requests set status = 'FAILED', safe_error_code = 'GMAIL_SEND_REJECTED', send_lock_id = null, send_lock_at = null where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '18 FAILED blocked');

select pg_temp.reset_request(); update public.email_send_requests set attempt_count = 0 where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '19 attempt zero');
select pg_temp.reset_request(); update public.email_send_requests set attempt_count = 2 where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '20 attempt above one');

select pg_temp.reset_request();
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set reply_to_email_message_id = null where id = '92000000-0000-4000-8000-000000000004'$sql$, '21 missing reply target');
update public.email_send_requests set safe_error_code = 'GMAIL_TEMPORARY_ERROR' where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '22 safe error blocked');
select pg_temp.reset_request(); update public.email_send_requests set provider_message_id = 'old' where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '23 existing provider message');
select pg_temp.reset_request(); update public.email_send_requests set provider_thread_id = 'old' where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '24 existing provider thread');
select pg_temp.reset_request(); update public.email_send_requests set rfc_message_id = '<old@example.test>' where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '25 existing RFC ID');
select pg_temp.reset_request();
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set sent_at = clock_timestamp() where id = '92000000-0000-4000-8000-000000000004'$sql$, '26 existing sent timestamp');

update public.email_send_requests set send_after = clock_timestamp() where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '27 scheduled blocked');
select pg_temp.reset_request(); update public.email_send_requests set body_html = '<p>html</p>' where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '28 HTML blocked');

select pg_temp.reset_request(); select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set to_addresses = '{}' where id = '92000000-0000-4000-8000-000000000004'$sql$, '29 zero recipients');
update public.email_send_requests set to_addresses = array['   '] where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '29a blank recipient');
select pg_temp.reset_request();
update public.email_send_requests set to_addresses = array['one@example.test','two@example.test'] where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '30 multiple recipients');
select pg_temp.reset_request(); update public.email_send_requests set cc_addresses = array['cc@example.test'] where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '31 CC blocked');
select pg_temp.reset_request(); update public.email_send_requests set bcc_addresses = array['bcc@example.test'] where id = '92000000-0000-4000-8000-000000000004';
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','thread'), '32 BCC blocked');
select pg_temp.reset_request();
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set subject = '  ' where id = '92000000-0000-4000-8000-000000000004'$sql$, '33 blank subject');
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set body_text = '  ' where id = '92000000-0000-4000-8000-000000000004'$sql$, '34 blank body');

select pg_temp.reset_request();
select pg_temp.assert_true(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','a','b'), '34a one-character provider IDs accepted');
select pg_temp.reset_request();
select pg_temp.assert_true(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007',repeat('a', 512),repeat('b', 512)), '34b 512-character provider IDs accepted');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007',repeat('a', 513),'thread'), '34c 513-character provider message rejected');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message',repeat('b', 513)), '34d 513-character provider thread rejected');
select pg_temp.reset_request();
select pg_temp.assert_true(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message_id-1','thread_id-1'), '34e underscore and hyphen accepted');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message id','thread'), '34f space rejected');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message/id','thread'), '34g slash rejected');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message:id','thread'), '34h colon rejected');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007',E'message\r','thread'), '34i carriage return rejected');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007',E'message\n','thread'), '34j line feed rejected');
select pg_temp.reset_request();
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message' || chr(127),'thread'), '34k DEL rejected');

select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','   ','thread'), '35 blank provider message input');
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007','message','   '), '36 blank provider thread input');
select pg_temp.assert_false(public.finalize_reply_email_send_request_sent('92000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000007',E'message\nheader','thread'), '37 control provider ID');

select pg_temp.assert_false(exists (
  select 1 from pg_catalog.pg_proc as procedure
  cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) as privilege
  where procedure.oid = 'public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)'::regprocedure
    and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
), '38 PUBLIC denied');
select pg_temp.assert_false(has_function_privilege('anon','public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)','EXECUTE'), '39 anon denied');
select pg_temp.assert_false(has_function_privilege('authenticated','public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)','EXECUTE'), '40 authenticated denied');
select pg_temp.assert_true(has_function_privilege('service_role','public.finalize_reply_email_send_request_sent(uuid,uuid,uuid,uuid,text,text)','EXECUTE'), '41 service role allowed');

rollback;

select not exists (select 1 from auth.users where id = '92000000-0000-4000-8000-000000000001') as fixture_user_removed,
not exists (select 1 from public.workspaces where id = '92000000-0000-4000-8000-000000000002') as fixture_workspace_removed,
not exists (select 1 from public.profiles where id = '92000000-0000-4000-8000-000000000001') as fixture_profile_removed,
not exists (select 1 from public.email_accounts where id = '92000000-0000-4000-8000-000000000003') as fixture_account_removed,
not exists (select 1 from public.email_send_requests where id = '92000000-0000-4000-8000-000000000004') as fixture_send_request_removed;
