-- Remote-safe rollback-only validation for migration 013.
-- This test never drops or alters production constraints.

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
  '93000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'phase-2b4fc1-fixture@example.test', '',
  clock_timestamp(), '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
);

insert into public.workspaces (id, name)
values ('93000000-0000-4000-8000-000000000002', 'Phase 2B.4F-C1 rollback fixture');

insert into public.profiles (id, workspace_id, full_name) values (
  '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  'Phase 2B.4F-C1 Fixture'
);

insert into public.email_accounts (
  id, workspace_id, connected_by, provider, email_address, status
) values (
  '93000000-0000-4000-8000-000000000003',
  '93000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000001',
  'GMAIL', 'sender@example.test', 'CONNECTED'
);

insert into public.email_send_requests (
  id, workspace_id, email_account_id, send_type, status,
  reply_to_email_message_id, to_addresses, cc_addresses, bcc_addresses,
  subject, body_text, body_html, send_after, idempotency_key, attempt_count,
  last_attempt_at, send_lock_id, send_lock_at
) values (
  '93000000-0000-4000-8000-000000000004',
  '93000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000003',
  'REPLY', 'SENDING', '93000000-0000-4000-8000-000000000005',
  array['recipient@example.test'], '{}', '{}', 'Re: Fixture', E'Reply body\n',
  null, null, '93000000-0000-4000-8000-000000000006', 1,
  '2026-08-28T01:00:00Z', '93000000-0000-4000-8000-000000000007', '2026-08-28T01:00:00Z'
);

create or replace function pg_temp.reset_request()
returns void language sql as $$
  update public.email_send_requests
  set send_type = 'REPLY', status = 'SENDING', attempt_count = 1,
      last_attempt_at = '2026-08-28T01:00:00Z',
      send_lock_id = '93000000-0000-4000-8000-000000000007',
      send_lock_at = '2026-08-28T01:00:00Z', safe_error_code = null,
      reply_to_email_message_id = '93000000-0000-4000-8000-000000000005',
      to_addresses = array['recipient@example.test'], cc_addresses = '{}', bcc_addresses = '{}',
      subject = 'Re: Fixture', body_text = E'Reply body\n', body_html = null, send_after = null,
      provider_message_id = null, provider_thread_id = null, rfc_message_id = null, sent_at = null
  where id = '93000000-0000-4000-8000-000000000004'
$$;

select pg_temp.assert_true(public.finalize_reply_email_send_request_failed(
  '93000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000007',
  'REPLY_TARGET_CHANGED'), '1 target changed finalized');
select pg_temp.assert_true((select status = 'FAILED' from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '2 status FAILED');
select pg_temp.assert_true((select safe_error_code = 'REPLY_TARGET_CHANGED' from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '3 exact safe error stored');
select pg_temp.assert_true((select send_lock_id is null from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '4 lock ID cleared');
select pg_temp.assert_true((select send_lock_at is null from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '5 lock timestamp cleared');
select pg_temp.assert_true((select attempt_count = 1 from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '6 attempt remains one');
select pg_temp.assert_true((select last_attempt_at = '2026-08-28T01:00:00Z'::timestamptz from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '7 attempt timestamp unchanged');
select pg_temp.assert_true((select provider_message_id is null and provider_thread_id is null from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '8 provider IDs remain NULL');
select pg_temp.assert_true((select rfc_message_id is null from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '9 RFC Message-ID remains NULL');
select pg_temp.assert_true((select sent_at is null from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004'), '10 sent timestamp remains NULL');

select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_NOT_REPLYABLE'), '11 target not replyable accepted');
select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','MIME_BUILD_FAILED'), '12 MIME failure accepted');
select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REAUTH_REQUIRED'), '13 reauth accepted');
select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','GMAIL_PERMISSION_DENIED'), '14 permission denied accepted');
select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','GMAIL_RATE_LIMITED'), '15 rate limited accepted');
select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','GMAIL_SEND_REJECTED'), '16 send rejected accepted');

select pg_temp.reset_request(); select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','GMAIL_TEMPORARY_ERROR'), '17 temporary error rejected');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','SEND_SCOPE_REQUIRED'), '18 send scope rejected');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','INVALID_RECIPIENT'), '19 invalid recipient code rejected');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007',''), '20 blank code rejected');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','UNKNOWN_ERROR'), '21 unknown code rejected');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007',' REPLY_TARGET_CHANGED'), '22 whitespace-modified code rejected');

select pg_temp.reset_request(); select pg_temp.assert_true(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '23 ownership setup finalized');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '24 second finalization false');
select pg_temp.reset_request(); select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000099','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '25 wrong workspace');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000099','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '26 wrong account');
select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000099','REPLY_TARGET_CHANGED'), '27 wrong lock');
select pg_temp.reset_request(); update public.email_send_requests set send_type = 'NEW', reply_to_email_message_id = null where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '28 NEW blocked');
select pg_temp.reset_request(); update public.email_send_requests set status = 'PENDING', send_lock_id = null, send_lock_at = null where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '29 PENDING blocked');
select pg_temp.reset_request(); update public.email_send_requests set status = 'SENT', provider_message_id = 'old', provider_thread_id = 'old', sent_at = clock_timestamp(), send_lock_id = null, send_lock_at = null where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '30 SENT blocked');
select pg_temp.reset_request(); update public.email_send_requests set status = 'FAILED', safe_error_code = 'MIME_BUILD_FAILED', send_lock_id = null, send_lock_at = null where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '31 FAILED blocked');
select pg_temp.reset_request(); update public.email_send_requests set attempt_count = 0 where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '32 attempt zero blocked');
select pg_temp.reset_request(); update public.email_send_requests set attempt_count = 2 where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '33 attempt above one blocked');
select pg_temp.reset_request(); update public.email_send_requests set last_attempt_at = '2026-08-28T01:00:01Z' where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '34 claim timestamp mismatch');
select pg_temp.reset_request(); select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set reply_to_email_message_id = null where id = '93000000-0000-4000-8000-000000000004'$sql$, '35 schema rejects missing reply target');
update public.email_send_requests set safe_error_code = 'OLD_ERROR' where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '36 existing safe error blocked');
select pg_temp.reset_request(); update public.email_send_requests set provider_message_id = 'old' where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '37 existing provider message blocked');
select pg_temp.reset_request(); update public.email_send_requests set provider_thread_id = 'old' where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '38 existing provider thread blocked');
select pg_temp.reset_request(); update public.email_send_requests set rfc_message_id = '<old@example.test>' where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '39 existing RFC ID blocked');
select pg_temp.reset_request(); select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set sent_at = clock_timestamp() where id = '93000000-0000-4000-8000-000000000004'$sql$, '40 schema rejects sent timestamp on SENDING');
update public.email_send_requests set send_after = clock_timestamp() where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '41 scheduled blocked');
select pg_temp.reset_request(); update public.email_send_requests set body_html = '<p>html</p>' where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '42 HTML blocked');
select pg_temp.reset_request(); select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set to_addresses = '{}' where id = '93000000-0000-4000-8000-000000000004'$sql$, '43 schema rejects zero recipients');
update public.email_send_requests set to_addresses = array['   '] where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '44 blank recipient blocked');
select pg_temp.reset_request(); update public.email_send_requests set to_addresses = array['one@example.test','two@example.test'] where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '45 multiple recipients blocked');
select pg_temp.reset_request(); update public.email_send_requests set cc_addresses = array['cc@example.test'] where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '46 CC blocked');
select pg_temp.reset_request(); update public.email_send_requests set bcc_addresses = array['bcc@example.test'] where id = '93000000-0000-4000-8000-000000000004'; select pg_temp.assert_false(public.finalize_reply_email_send_request_failed('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000007','REPLY_TARGET_CHANGED'), '47 BCC blocked');
select pg_temp.reset_request(); select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set subject = '  ' where id = '93000000-0000-4000-8000-000000000004'$sql$, '48 schema rejects blank subject');
select pg_temp.assert_schema_rejects($sql$update public.email_send_requests set body_text = '  ' where id = '93000000-0000-4000-8000-000000000004'$sql$, '49 schema rejects blank body');

select pg_temp.assert_false(exists (
  select 1 from pg_catalog.pg_proc as procedure
  cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) as privilege
  where procedure.oid = 'public.finalize_reply_email_send_request_failed(uuid,uuid,uuid,uuid,text)'::regprocedure
    and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
), '50 PUBLIC denied');
select pg_temp.assert_false(has_function_privilege('anon','public.finalize_reply_email_send_request_failed(uuid,uuid,uuid,uuid,text)','EXECUTE'), '51 anon denied');
select pg_temp.assert_false(has_function_privilege('authenticated','public.finalize_reply_email_send_request_failed(uuid,uuid,uuid,uuid,text)','EXECUTE'), '52 authenticated denied');
select pg_temp.assert_true(has_function_privilege('service_role','public.finalize_reply_email_send_request_failed(uuid,uuid,uuid,uuid,text)','EXECUTE'), '53 service role allowed');

rollback;

select
  not exists (select 1 from auth.users where id = '93000000-0000-4000-8000-000000000001') as fixture_user_removed,
  not exists (select 1 from public.workspaces where id = '93000000-0000-4000-8000-000000000002') as fixture_workspace_removed,
  not exists (select 1 from public.profiles where id = '93000000-0000-4000-8000-000000000001') as fixture_profile_removed,
  not exists (select 1 from public.email_accounts where id = '93000000-0000-4000-8000-000000000003') as fixture_account_removed,
  not exists (select 1 from public.email_send_requests where id = '93000000-0000-4000-8000-000000000004') as fixture_request_removed;
