


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."claim_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_send_lock_id is null then
    return false;
  end if;

  update public.email_send_requests
  set status = 'SENDING',
      attempt_count = attempt_count + 1,
      last_attempt_at = clock_timestamp(),
      safe_error_code = null,
      send_lock_id = p_send_lock_id,
      send_lock_at = clock_timestamp()
  where id = p_request_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and send_type = 'NEW'
    and status = 'PENDING'
    and send_lock_id is null
    and send_lock_at is null
    and rfc_message_id is not null
    and cardinality(to_addresses) = 1
    and cardinality(cc_addresses) = 0
    and cardinality(bcc_addresses) = 0
    and body_text is not null
    and body_html is null
    and send_after is null;

  return found;
end;
$$;


ALTER FUNCTION "public"."claim_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_reply_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") RETURNS TABLE("request_id" "uuid", "workspace_id" "uuid", "email_account_id" "uuid", "reply_to_email_message_id" "uuid", "send_lock_id" "uuid", "attempt_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_claimed_at timestamptz;
begin
  if p_request_id is null
    or p_workspace_id is null
    or p_email_account_id is null
    or p_send_lock_id is null then
    return;
  end if;

  v_claimed_at := clock_timestamp();

  return query
  update public.email_send_requests as request
  set status = 'SENDING',
      attempt_count = request.attempt_count + 1,
      last_attempt_at = v_claimed_at,
      send_lock_id = p_send_lock_id,
      send_lock_at = v_claimed_at
  where request.id = p_request_id
    and request.workspace_id = p_workspace_id
    and request.email_account_id = p_email_account_id
    and request.send_type = 'REPLY'
    and request.status = 'PENDING'
    and request.attempt_count = 0
    and request.last_attempt_at is null
    and request.safe_error_code is null
    and request.send_lock_id is null
    and request.send_lock_at is null
    and request.reply_to_email_message_id is not null
    and request.to_addresses is not null
    and cardinality(request.to_addresses) = 1
    and request.to_addresses[1] is not null
    and btrim(request.to_addresses[1]) <> ''
    and request.cc_addresses is not null
    and cardinality(request.cc_addresses) = 0
    and request.bcc_addresses is not null
    and cardinality(request.bcc_addresses) = 0
    and request.subject is not null
    and btrim(request.subject) <> ''
    and request.body_text is not null
    and btrim(request.body_text) <> ''
    and request.body_html is null
    and request.send_after is null
    and request.provider_message_id is null
    and request.provider_thread_id is null
    and request.rfc_message_id is null
    and request.sent_at is null
  returning
    request.id,
    request.workspace_id,
    request.email_account_id,
    request.reply_to_email_message_id,
    request.send_lock_id,
    request.attempt_count;
end;
$$;


ALTER FUNCTION "public"."claim_reply_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_reply_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") IS 'Server-only, first-attempt REPLY PENDING-to-SENDING claim. A successful claim does not authorize Gmail delivery; canonical reply evidence must be re-evaluated before send.';



CREATE OR REPLACE FUNCTION "public"."current_workspace_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.workspace_id
  from public.profiles as p
  where p.id = (select auth.uid())
$$;


ALTER FUNCTION "public"."current_workspace_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_send_lock_id is null then
    return false;
  end if;

  if p_safe_error_code is null or p_safe_error_code not in (
    'SEND_SCOPE_REQUIRED',
    'REAUTH_REQUIRED',
    'INVALID_RECIPIENT',
    'MIME_BUILD_FAILED',
    'GMAIL_PERMISSION_DENIED',
    'GMAIL_RATE_LIMITED',
    'GMAIL_SEND_REJECTED',
    'GMAIL_TEMPORARY_ERROR'
  ) then
    raise exception 'Invalid safe send failure code';
  end if;

  update public.email_send_requests
  set status = 'FAILED',
      sent_at = null,
      safe_error_code = p_safe_error_code,
      send_lock_id = null,
      send_lock_at = null
  where id = p_request_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'SENDING'
    and send_lock_id = p_send_lock_id;

  return found;
end;
$$;


ALTER FUNCTION "public"."finalize_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_send_lock_id is null then
    return false;
  end if;

  if p_provider_message_id is null or btrim(p_provider_message_id) = ''
    or p_provider_thread_id is null or btrim(p_provider_thread_id) = '' then
    raise exception 'Invalid Gmail send result';
  end if;

  update public.email_send_requests
  set status = 'SENT',
      provider_message_id = p_provider_message_id,
      provider_thread_id = p_provider_thread_id,
      sent_at = clock_timestamp(),
      safe_error_code = null,
      send_lock_id = null,
      send_lock_at = null
  where id = p_request_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'SENDING'
    and send_lock_id = p_send_lock_id
    and rfc_message_id is not null;

  return found;
end;
$$;


ALTER FUNCTION "public"."finalize_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_incremental_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_history_records" integer, "p_affected_message_count" integer, "p_synced_message_count" integer, "p_deleted_message_count" integer, "p_failed_message_count" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_start_history_id text;
  v_target_history_id text;
  v_finalized_at timestamptz := clock_timestamp();
begin
  if p_processed_history_records < 0
    or p_affected_message_count < 0
    or p_synced_message_count < 0
    or p_deleted_message_count < 0
    or p_failed_message_count <> 0 then
    raise exception 'Invalid incremental final sync counters';
  end if;

  select start_history_id, target_history_id
    into v_start_history_id, v_target_history_id
  from public.email_incremental_sync_states
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id
    and start_history_id is not null
    and target_history_id is not null
  for update;

  if not found then
    return false;
  end if;

  update public.email_accounts
  set provider_history_id = v_target_history_id,
      last_sync_at = v_finalized_at,
      last_sync_error = null
  where id = p_email_account_id
    and workspace_id = p_workspace_id
    and provider = 'GMAIL'
    and status = 'CONNECTED'
    and provider_history_id = v_start_history_id;

  if not found then
    raise exception 'Incremental sync cursor changed before finalization';
  end if;

  update public.email_incremental_sync_states
  set status = 'COMPLETED',
      next_page_token = null,
      processed_history_records = processed_history_records + p_processed_history_records,
      affected_message_count = affected_message_count + p_affected_message_count,
      synced_message_count = synced_message_count + p_synced_message_count,
      deleted_message_count = deleted_message_count + p_deleted_message_count,
      failed_message_count = failed_message_count + p_failed_message_count,
      completed_at = v_finalized_at,
      last_batch_at = v_finalized_at,
      safe_error_code = null,
      batch_lock_id = null,
      batch_lock_at = null
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id;

  if not found then
    raise exception 'Incremental sync state changed during finalization';
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."finalize_incremental_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_history_records" integer, "p_affected_message_count" integer, "p_synced_message_count" integer, "p_deleted_message_count" integer, "p_failed_message_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_initial_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_messages" integer, "p_synced_messages" integer, "p_skipped_messages" integer, "p_failed_messages" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_initial_history_id text;
  v_finalized_at timestamptz := clock_timestamp();
begin
  if p_processed_messages < 0 or p_synced_messages < 0
    or p_skipped_messages < 0 or p_failed_messages < 0
    or p_synced_messages + p_skipped_messages + p_failed_messages <> p_processed_messages
    or p_failed_messages <> 0 then
    raise exception 'Invalid final sync counters';
  end if;

  select initial_history_id
    into v_initial_history_id
  from public.email_sync_states
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and sync_type = 'INITIAL'
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id
    and initial_history_id is not null
  for update;

  if not found then
    return false;
  end if;

  update public.email_accounts
  set provider_history_id = v_initial_history_id,
      last_sync_at = v_finalized_at,
      last_sync_error = null
  where id = p_email_account_id
    and workspace_id = p_workspace_id
    and provider = 'GMAIL';

  if not found then
    raise exception 'Email account not found for initial sync finalization';
  end if;

  update public.email_sync_states
  set status = 'COMPLETED',
      next_page_token = null,
      processed_messages = processed_messages + p_processed_messages,
      synced_messages = synced_messages + p_synced_messages,
      skipped_messages = skipped_messages + p_skipped_messages,
      failed_messages = failed_messages + p_failed_messages,
      last_batch_at = v_finalized_at,
      completed_at = v_finalized_at,
      safe_error_code = null,
      batch_lock_id = null,
      batch_lock_at = null
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and sync_type = 'INITIAL'
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id;

  if not found then
    raise exception 'Initial sync state changed during finalization';
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."finalize_initial_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_messages" integer, "p_synced_messages" integer, "p_skipped_messages" integer, "p_failed_messages" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_reconciled_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_email_message_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_request public.email_send_requests%rowtype;
  v_account_email text;
  v_preliminary_thread_id uuid;
  v_message public.email_messages%rowtype;
  v_thread public.email_threads%rowtype;
  v_correlation_count bigint;
  v_request_body text;
  v_message_body text;
begin
  if p_request_id is null
    or p_workspace_id is null
    or p_email_account_id is null
    or p_email_message_id is null then
    return false;
  end if;

  select request.*
  into v_request
  from public.email_send_requests as request
  where request.id = p_request_id
    and request.workspace_id = p_workspace_id
    and request.email_account_id = p_email_account_id
    and request.send_type = 'NEW'
    and request.status = 'SENDING'
    and request.send_lock_id is not null
    and request.send_lock_at is not null
    and request.to_addresses is not null
    and cardinality(request.to_addresses) = 1
    and request.to_addresses[1] is not null
    and regexp_replace(request.to_addresses[1], '[[:space:]]', '', 'g') <> ''
    and request.cc_addresses is not null
    and cardinality(request.cc_addresses) = 0
    and request.bcc_addresses is not null
    and cardinality(request.bcc_addresses) = 0
    and request.subject is not null
    and regexp_replace(request.subject, '[[:space:]]', '', 'g') <> ''
    and request.body_html is null
    and request.send_after is null
    and request.body_text is not null
    and regexp_replace(request.body_text, '[[:space:]]', '', 'g') <> ''
    and (
      request.provider_message_id is null
      or regexp_replace(request.provider_message_id, '[[:space:]]', '', 'g') <> ''
    )
    and (
      request.provider_thread_id is null
      or regexp_replace(request.provider_thread_id, '[[:space:]]', '', 'g') <> ''
    )
  for update;

  if not found then
    return false;
  end if;

  select account.email_address
  into v_account_email
  from public.email_accounts as account
  where account.id = p_email_account_id
    and account.workspace_id = p_workspace_id
    and account.provider = 'GMAIL'
    and account.status = 'CONNECTED'
  for share;

  if not found
    or v_account_email is null
    or regexp_replace(v_account_email, '[[:space:]]', '', 'g') = '' then
    return false;
  end if;

  -- Preliminary routing lookup only. None of this message evidence is trusted
  -- until it is re-read after the email_messages table lock below.
  select message.email_thread_id
  into v_preliminary_thread_id
  from public.email_messages as message
  where message.id = p_email_message_id
    and message.workspace_id = p_workspace_id
    and message.email_account_id = p_email_account_id
    and message.provider = 'GMAIL'
    and message.email_thread_id is not null;

  if not found then
    return false;
  end if;

  -- Mailbox persistence writes threads before messages. Locking the canonical
  -- thread first preserves that order and avoids waiting for a thread row while
  -- already holding the email_messages SHARE table lock.
  select thread.*
  into v_thread
  from public.email_threads as thread
  where thread.id = v_preliminary_thread_id
    and thread.workspace_id = p_workspace_id
    and thread.email_account_id = p_email_account_id
    and thread.provider = 'GMAIL'
    and thread.provider_thread_id is not null
    and regexp_replace(thread.provider_thread_id, '[[:space:]]', '', 'g') <> ''
  for share;

  if not found then
    return false;
  end if;

  -- This narrowly scoped SHARE table lock prevents a mailbox-sync
  -- INSERT/UPDATE/DELETE phantom from invalidating the exact-one correlation
  -- check before commit. It temporarily blocks all three mutation forms on
  -- email_messages. Reconciliation remains exceptional/manual, is not wired
  -- to a scheduler, and any production automation must review lock scope and
  -- performance before use.
  lock table public.email_messages in share mode;

  -- Re-read and lock all authoritative message evidence after the table lock.
  select message.*
  into v_message
  from public.email_messages as message
  where message.id = p_email_message_id
    and message.workspace_id = p_workspace_id
    and message.email_account_id = p_email_account_id
    and message.provider = 'GMAIL'
    and message.hirex_send_request_id = p_request_id
    and message.email_thread_id = v_thread.id
  for share;

  if not found then
    return false;
  end if;

  select count(*)
  into v_correlation_count
  from public.email_messages as message
  where message.workspace_id = p_workspace_id
    and message.email_account_id = p_email_account_id
    and message.hirex_send_request_id = p_request_id;

  if v_correlation_count <> 1 then
    return false;
  end if;

  if v_message.provider_message_id is null
    or regexp_replace(v_message.provider_message_id, '[[:space:]]', '', 'g') = ''
    or v_message.hirex_send_request_id is null
    or v_message.hirex_send_request_id <> v_request.id
    or v_message.email_thread_id is null
    or v_message.email_thread_id <> v_thread.id
    or v_message.labels is null
    or array_position(v_message.labels, null) is not null
    or not ('SENT' = any(v_message.labels))
    or 'SPAM' = any(v_message.labels)
    or 'TRASH' = any(v_message.labels) then
    return false;
  end if;

  if v_message.from_email is null
    or regexp_replace(v_message.from_email, '[[:space:]]', '', 'g') = ''
    or lower(btrim(v_message.from_email)) <> lower(btrim(v_account_email))
    or v_message.to_emails is null
    or cardinality(v_message.to_emails) <> 1
    or v_message.to_emails[1] is null
    or regexp_replace(v_message.to_emails[1], '[[:space:]]', '', 'g') = ''
    or lower(btrim(v_message.to_emails[1])) <> lower(btrim(v_request.to_addresses[1]))
    or v_message.subject is null
    or regexp_replace(v_message.subject, '^[[:space:]]+|[[:space:]]+$', '', 'g')
      <> regexp_replace(v_request.subject, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    or v_message.body_text is null then
    return false;
  end if;

  v_request_body := replace(replace(v_request.body_text, E'\r\n', E'\n'), E'\r', E'\n');
  v_message_body := replace(replace(v_message.body_text, E'\r\n', E'\n'), E'\r', E'\n');

  if not (
    v_request_body = v_message_body
    or v_request_body = v_message_body || E'\n'
    or v_message_body = v_request_body || E'\n'
  ) then
    return false;
  end if;

  if v_request.provider_message_id is not null
    and v_request.provider_message_id <> v_message.provider_message_id then
    return false;
  end if;

  if v_request.provider_thread_id is not null
    and v_request.provider_thread_id <> v_thread.provider_thread_id then
    return false;
  end if;

  update public.email_send_requests
  set status = 'SENT',
      provider_message_id = v_message.provider_message_id,
      provider_thread_id = v_thread.provider_thread_id,
      sent_at = coalesce(
        v_request.sent_at,
        v_message.sent_at,
        v_message.provider_internal_date,
        clock_timestamp()
      ),
      safe_error_code = null,
      send_lock_id = null,
      send_lock_at = null,
      updated_at = clock_timestamp()
  where id = p_request_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'SENDING'
    and send_lock_id = v_request.send_lock_id
    and send_lock_at = v_request.send_lock_at;

  if not found then
    return false;
  end if;

  insert into public.audit_logs (
    workspace_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_workspace_id,
    null,
    'EMAIL_SEND_RECONCILED',
    'email_send_request',
    p_request_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'email_message_id', p_email_message_id
    )
  );

  return true;
end;
$_$;


ALTER FUNCTION "public"."finalize_reconciled_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_email_message_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_reconciled_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_email_message_id" "uuid") IS 'Server-only transactional SENDING-to-SENT reconciliation. Revalidates canonical Gmail evidence and never sends or retries email.';



CREATE OR REPLACE FUNCTION "public"."finalize_reply_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_request_id is null
    or p_workspace_id is null
    or p_email_account_id is null
    or p_send_lock_id is null
    or p_safe_error_code is null
    or p_safe_error_code not in (
      'REPLY_TARGET_CHANGED',
      'REPLY_TARGET_NOT_REPLYABLE',
      'MIME_BUILD_FAILED',
      'REAUTH_REQUIRED',
      'GMAIL_PERMISSION_DENIED',
      'GMAIL_RATE_LIMITED',
      'GMAIL_SEND_REJECTED'
    ) then
    return false;
  end if;

  update public.email_send_requests as request
  set status = 'FAILED',
      safe_error_code = p_safe_error_code,
      send_lock_id = null,
      send_lock_at = null
  where request.id = p_request_id
    and request.workspace_id = p_workspace_id
    and request.email_account_id = p_email_account_id
    and request.send_type = 'REPLY'
    and request.status = 'SENDING'
    and request.attempt_count = 1
    and request.send_lock_id = p_send_lock_id
    and request.send_lock_id is not null
    and request.send_lock_at is not null
    and request.last_attempt_at is not null
    and request.send_lock_at = request.last_attempt_at
    and request.safe_error_code is null
    and request.reply_to_email_message_id is not null
    and request.to_addresses is not null
    and cardinality(request.to_addresses) = 1
    and request.to_addresses[1] is not null
    and btrim(request.to_addresses[1]) <> ''
    and request.cc_addresses is not null
    and cardinality(request.cc_addresses) = 0
    and request.bcc_addresses is not null
    and cardinality(request.bcc_addresses) = 0
    and request.subject is not null
    and btrim(request.subject) <> ''
    and request.body_text is not null
    and btrim(request.body_text) <> ''
    and request.body_html is null
    and request.send_after is null
    and request.provider_message_id is null
    and request.provider_thread_id is null
    and request.rfc_message_id is null
    and request.sent_at is null;

  return found;
end;
$$;


ALTER FUNCTION "public"."finalize_reply_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_reply_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") IS 'Server-only exact-lock REPLY SENDING-to-FAILED finalizer for reviewed deterministic failures known to occur before Gmail acceptance. Never use after an ambiguous or successful Gmail transport outcome.';



CREATE OR REPLACE FUNCTION "public"."finalize_reply_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_sent_at timestamptz;
begin
  if p_request_id is null
    or p_workspace_id is null
    or p_email_account_id is null
    or p_send_lock_id is null
    or p_provider_message_id is null
    or p_provider_thread_id is null
    or char_length(p_provider_message_id) not between 1 and 512
    or char_length(p_provider_thread_id) not between 1 and 512
    or p_provider_message_id !~ '^[A-Za-z0-9_-]+$'
    or p_provider_thread_id !~ '^[A-Za-z0-9_-]+$' then
    return false;
  end if;

  v_sent_at := clock_timestamp();

  update public.email_send_requests as request
  set status = 'SENT',
      provider_message_id = p_provider_message_id,
      provider_thread_id = p_provider_thread_id,
      sent_at = v_sent_at,
      safe_error_code = null,
      send_lock_id = null,
      send_lock_at = null
  where request.id = p_request_id
    and request.workspace_id = p_workspace_id
    and request.email_account_id = p_email_account_id
    and request.send_type = 'REPLY'
    and request.status = 'SENDING'
    and request.attempt_count = 1
    and request.send_lock_id = p_send_lock_id
    and request.send_lock_id is not null
    and request.send_lock_at is not null
    and request.last_attempt_at is not null
    and request.send_lock_at = request.last_attempt_at
    and request.safe_error_code is null
    and request.reply_to_email_message_id is not null
    and request.to_addresses is not null
    and cardinality(request.to_addresses) = 1
    and request.to_addresses[1] is not null
    and btrim(request.to_addresses[1]) <> ''
    and request.cc_addresses is not null
    and cardinality(request.cc_addresses) = 0
    and request.bcc_addresses is not null
    and cardinality(request.bcc_addresses) = 0
    and request.subject is not null
    and btrim(request.subject) <> ''
    and request.body_text is not null
    and btrim(request.body_text) <> ''
    and request.body_html is null
    and request.send_after is null
    and request.provider_message_id is null
    and request.provider_thread_id is null
    and request.rfc_message_id is null
    and request.sent_at is null;

  return found;
end;
$_$;


ALTER FUNCTION "public"."finalize_reply_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_reply_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") IS 'Server-only exact-lock REPLY SENDING-to-SENT finalizer. The outgoing RFC Message-ID remains NULL until canonical mailbox evidence is observed.';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_logs_action_not_blank" CHECK (("btrim"("action") <> ''::"text")),
    CONSTRAINT "audit_logs_entity_type_not_blank" CHECK (("btrim"("entity_type") <> ''::"text")),
    CONSTRAINT "audit_logs_metadata_object" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "website" "text",
    "industry" "text",
    "country" "text",
    "status" "text" DEFAULT 'PROSPECT'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "companies_name_not_blank" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "companies_status_allowed" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'PROSPECT'::"text", 'INACTIVE'::"text"]))),
    CONSTRAINT "companies_website_not_blank" CHECK ((("website" IS NULL) OR ("btrim"("website") <> ''::"text")))
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "channel_type" "text" NOT NULL,
    "channel_value" "text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contact_channels_metadata_object" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "contact_channels_type_allowed" CHECK (("channel_type" = ANY (ARRAY['EMAIL'::"text", 'PHONE'::"text", 'FACEBOOK'::"text", 'WHATSAPP'::"text", 'ZALO'::"text", 'VIBER'::"text", 'LINKEDIN'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "contact_channels_value_not_blank" CHECK (("btrim"("channel_value") <> ''::"text"))
);


ALTER TABLE "public"."contact_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "company_id" "uuid",
    "full_name" "text" NOT NULL,
    "job_title" "text",
    "email" "text",
    "phone" "text",
    "country" "text",
    "language" "text",
    "source" "text",
    "lead_status" "text" DEFAULT 'NEW'::"text" NOT NULL,
    "lead_score" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contacts_email_not_blank" CHECK ((("email" IS NULL) OR ("btrim"("email") <> ''::"text"))),
    CONSTRAINT "contacts_full_name_not_blank" CHECK (("btrim"("full_name") <> ''::"text")),
    CONSTRAINT "contacts_lead_score_range" CHECK ((("lead_score" >= 0) AND ("lead_score" <= 100))),
    CONSTRAINT "contacts_lead_status_allowed" CHECK (("lead_status" = ANY (ARRAY['NEW'::"text", 'CONTACTED'::"text", 'ENGAGED'::"text", 'QUALIFIED'::"text", 'OPPORTUNITY'::"text", 'WON'::"text", 'LOST'::"text", 'DO_NOT_CONTACT'::"text"]))),
    CONSTRAINT "contacts_phone_not_blank" CHECK ((("phone" IS NULL) OR ("btrim"("phone") <> ''::"text")))
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "connected_by" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "email_address" "text" NOT NULL,
    "display_name" "text",
    "provider_account_id" "text",
    "refresh_token_encrypted" "text",
    "access_token_encrypted" "text",
    "access_token_expires_at" timestamp with time zone,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'CONNECTED'::"text" NOT NULL,
    "last_sync_at" timestamp with time zone,
    "last_sync_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_history_id" "text",
    CONSTRAINT "email_accounts_access_token_ciphertext_not_blank" CHECK ((("access_token_encrypted" IS NULL) OR ("btrim"("access_token_encrypted") <> ''::"text"))),
    CONSTRAINT "email_accounts_display_name_not_blank" CHECK ((("display_name" IS NULL) OR ("btrim"("display_name") <> ''::"text"))),
    CONSTRAINT "email_accounts_email_not_blank" CHECK (("btrim"("email_address") <> ''::"text")),
    CONSTRAINT "email_accounts_provider_account_id_not_blank" CHECK ((("provider_account_id" IS NULL) OR ("btrim"("provider_account_id") <> ''::"text"))),
    CONSTRAINT "email_accounts_provider_allowed" CHECK (("provider" = 'GMAIL'::"text")),
    CONSTRAINT "email_accounts_provider_history_id_not_blank" CHECK ((("provider_history_id" IS NULL) OR ("btrim"("provider_history_id") <> ''::"text"))),
    CONSTRAINT "email_accounts_refresh_token_ciphertext_not_blank" CHECK ((("refresh_token_encrypted" IS NULL) OR ("btrim"("refresh_token_encrypted") <> ''::"text"))),
    CONSTRAINT "email_accounts_scopes_have_no_nulls" CHECK (("array_position"("scopes", NULL::"text") IS NULL)),
    CONSTRAINT "email_accounts_status_allowed" CHECK (("status" = ANY (ARRAY['CONNECTED'::"text", 'REAUTH_REQUIRED'::"text", 'DISCONNECTED'::"text", 'ERROR'::"text"])))
);


ALTER TABLE "public"."email_accounts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."email_accounts"."refresh_token_encrypted" IS 'Encrypted ciphertext only. Encryption and decryption occur in a trusted application-server boundary.';



COMMENT ON COLUMN "public"."email_accounts"."access_token_encrypted" IS 'Encrypted ciphertext only. Encryption and decryption occur in a trusted application-server boundary.';



COMMENT ON COLUMN "public"."email_accounts"."provider_history_id" IS 'Opaque Gmail history cursor. Keep as text; writable only by the future server-only sync boundary.';



CREATE TABLE IF NOT EXISTS "public"."email_incremental_sync_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email_account_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "start_history_id" "text" NOT NULL,
    "next_page_token" "text",
    "target_history_id" "text",
    "processed_history_records" integer DEFAULT 0 NOT NULL,
    "affected_message_count" integer DEFAULT 0 NOT NULL,
    "synced_message_count" integer DEFAULT 0 NOT NULL,
    "deleted_message_count" integer DEFAULT 0 NOT NULL,
    "failed_message_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_batch_at" timestamp with time zone,
    "safe_error_code" "text",
    "batch_lock_id" "uuid",
    "batch_lock_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_incremental_sync_states_batch_lock_shape" CHECK (((("batch_lock_id" IS NULL) AND ("batch_lock_at" IS NULL)) OR (("batch_lock_id" IS NOT NULL) AND ("batch_lock_at" IS NOT NULL)))),
    CONSTRAINT "email_incremental_sync_states_completed_shape" CHECK ((("status" <> 'COMPLETED'::"text") OR (("completed_at" IS NOT NULL) AND ("next_page_token" IS NULL) AND ("target_history_id" IS NOT NULL) AND ("batch_lock_id" IS NULL) AND ("batch_lock_at" IS NULL)))),
    CONSTRAINT "email_incremental_sync_states_counters_nonnegative" CHECK ((("processed_history_records" >= 0) AND ("affected_message_count" >= 0) AND ("synced_message_count" >= 0) AND ("deleted_message_count" >= 0) AND ("failed_message_count" >= 0))),
    CONSTRAINT "email_incremental_sync_states_next_page_token_not_blank" CHECK ((("next_page_token" IS NULL) OR ("btrim"("next_page_token") <> ''::"text"))),
    CONSTRAINT "email_incremental_sync_states_safe_error_code_not_blank" CHECK ((("safe_error_code" IS NULL) OR ("btrim"("safe_error_code") <> ''::"text"))),
    CONSTRAINT "email_incremental_sync_states_start_history_id_not_blank" CHECK (("btrim"("start_history_id") <> ''::"text")),
    CONSTRAINT "email_incremental_sync_states_status_allowed" CHECK (("status" = ANY (ARRAY['RUNNING'::"text", 'FAILED'::"text", 'COMPLETED'::"text"]))),
    CONSTRAINT "email_incremental_sync_states_target_history_id_not_blank" CHECK ((("target_history_id" IS NULL) OR ("btrim"("target_history_id") <> ''::"text")))
);


ALTER TABLE "public"."email_incremental_sync_states" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_incremental_sync_states" IS 'One reusable incremental History sync state per Gmail account. A later reviewed server-only boundary may reset a COMPLETED row for the next run; concurrent rows are prohibited.';



COMMENT ON COLUMN "public"."email_incremental_sync_states"."start_history_id" IS 'Opaque account provider_history_id captured when an incremental run starts. Keep as text.';



COMMENT ON COLUMN "public"."email_incremental_sync_states"."next_page_token" IS 'Opaque Gmail History page token. Server-only; never accept from or expose to a browser.';



COMMENT ON COLUMN "public"."email_incremental_sync_states"."target_history_id" IS 'Opaque Gmail History cursor to publish only after pagination completes. Keep as text.';



COMMENT ON COLUMN "public"."email_incremental_sync_states"."safe_error_code" IS 'Safe application category only. HISTORY_ID_EXPIRED signals that Gmail returned 404 and a reviewed full-resync flow is required.';



CREATE TABLE IF NOT EXISTS "public"."email_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email_account_id" "uuid" NOT NULL,
    "email_thread_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_message_id" "text" NOT NULL,
    "provider_history_id" "text",
    "rfc_message_id" "text",
    "in_reply_to" "text",
    "references_header" "text",
    "direction" "text" NOT NULL,
    "from_email" "text",
    "from_name" "text",
    "to_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cc_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "bcc_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subject" "text",
    "snippet" "text",
    "body_text" "text",
    "body_html" "text",
    "labels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_unread" boolean DEFAULT false NOT NULL,
    "is_starred" boolean DEFAULT false NOT NULL,
    "sent_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "provider_internal_date" timestamp with time zone,
    "contact_id" "uuid",
    "has_attachments" boolean DEFAULT false NOT NULL,
    "attachment_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hirex_send_request_id" "uuid",
    CONSTRAINT "email_messages_attachment_count_nonnegative" CHECK (("attachment_count" >= 0)),
    CONSTRAINT "email_messages_direction_allowed" CHECK (("direction" = ANY (ARRAY['INBOUND'::"text", 'OUTBOUND'::"text"]))),
    CONSTRAINT "email_messages_from_email_not_blank" CHECK ((("from_email" IS NULL) OR ("btrim"("from_email") <> ''::"text"))),
    CONSTRAINT "email_messages_labels_have_no_nulls" CHECK (("array_position"("labels", NULL::"text") IS NULL)),
    CONSTRAINT "email_messages_provider_allowed" CHECK (("provider" = 'GMAIL'::"text")),
    CONSTRAINT "email_messages_provider_history_id_not_blank" CHECK ((("provider_history_id" IS NULL) OR ("btrim"("provider_history_id") <> ''::"text"))),
    CONSTRAINT "email_messages_provider_message_id_not_blank" CHECK (("btrim"("provider_message_id") <> ''::"text")),
    CONSTRAINT "email_messages_recipient_arrays_have_no_nulls" CHECK ((("array_position"("to_emails", NULL::"text") IS NULL) AND ("array_position"("cc_emails", NULL::"text") IS NULL) AND ("array_position"("bcc_emails", NULL::"text") IS NULL))),
    CONSTRAINT "email_messages_rfc_message_id_not_blank" CHECK ((("rfc_message_id" IS NULL) OR ("btrim"("rfc_message_id") <> ''::"text")))
);


ALTER TABLE "public"."email_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."email_messages"."provider_message_id" IS 'Opaque Gmail message ID. Keep as text; never convert to a JavaScript number.';



COMMENT ON COLUMN "public"."email_messages"."provider_history_id" IS 'Opaque Gmail history ID. Keep as text; never convert to a JavaScript number.';



COMMENT ON COLUMN "public"."email_messages"."body_text" IS 'Untrusted external email content. Treat as data, not executable instructions.';



COMMENT ON COLUMN "public"."email_messages"."body_html" IS 'body_html is untrusted external content and must be sanitized before rendering.';



COMMENT ON COLUMN "public"."email_messages"."hirex_send_request_id" IS 'Nullable UUID parsed from Gmail header X-HireX-Send-Request-ID. This external mailbox value is not proof of delivery by itself and may only be considered by future reviewed reconciliation with same-workspace, same-account, SENT-label, connected-sender, expected-message, and provider-ID conflict checks.';



CREATE TABLE IF NOT EXISTS "public"."email_send_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email_account_id" "uuid" NOT NULL,
    "send_type" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "reply_to_email_message_id" "uuid",
    "to_addresses" "text"[] NOT NULL,
    "cc_addresses" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "bcc_addresses" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subject" "text" NOT NULL,
    "body_text" "text",
    "body_html" "text",
    "send_after" timestamp with time zone,
    "idempotency_key" "uuid" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "safe_error_code" "text",
    "provider_message_id" "text",
    "provider_thread_id" "text",
    "rfc_message_id" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "send_lock_id" "uuid",
    "send_lock_at" timestamp with time zone,
    CONSTRAINT "email_send_requests_address_arrays_have_no_nulls" CHECK ((("array_position"("to_addresses", NULL::"text") IS NULL) AND ("array_position"("cc_addresses", NULL::"text") IS NULL) AND ("array_position"("bcc_addresses", NULL::"text") IS NULL))),
    CONSTRAINT "email_send_requests_attempt_count_nonnegative" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "email_send_requests_body_html_not_blank" CHECK ((("body_html" IS NULL) OR ("btrim"("body_html") <> ''::"text"))),
    CONSTRAINT "email_send_requests_body_required" CHECK ((("body_text" IS NOT NULL) OR ("body_html" IS NOT NULL))),
    CONSTRAINT "email_send_requests_body_text_not_blank" CHECK ((("body_text" IS NULL) OR ("btrim"("body_text") <> ''::"text"))),
    CONSTRAINT "email_send_requests_provider_message_id_not_blank" CHECK ((("provider_message_id" IS NULL) OR ("btrim"("provider_message_id") <> ''::"text"))),
    CONSTRAINT "email_send_requests_provider_thread_id_not_blank" CHECK ((("provider_thread_id" IS NULL) OR ("btrim"("provider_thread_id") <> ''::"text"))),
    CONSTRAINT "email_send_requests_reply_target_shape" CHECK (((("send_type" = 'NEW'::"text") AND ("reply_to_email_message_id" IS NULL)) OR (("send_type" = 'REPLY'::"text") AND ("reply_to_email_message_id" IS NOT NULL)))),
    CONSTRAINT "email_send_requests_rfc_message_id_not_blank" CHECK ((("rfc_message_id" IS NULL) OR ("btrim"("rfc_message_id") <> ''::"text"))),
    CONSTRAINT "email_send_requests_safe_error_code_not_blank" CHECK ((("safe_error_code" IS NULL) OR ("btrim"("safe_error_code") <> ''::"text"))),
    CONSTRAINT "email_send_requests_send_lock_shape" CHECK (((("status" = 'SENDING'::"text") AND ("send_lock_id" IS NOT NULL) AND ("send_lock_at" IS NOT NULL)) OR (("status" <> 'SENDING'::"text") AND ("send_lock_id" IS NULL) AND ("send_lock_at" IS NULL)))),
    CONSTRAINT "email_send_requests_send_type_allowed" CHECK (("send_type" = ANY (ARRAY['NEW'::"text", 'REPLY'::"text"]))),
    CONSTRAINT "email_send_requests_status_allowed" CHECK (("status" = ANY (ARRAY['PENDING'::"text", 'SENDING'::"text", 'SENT'::"text", 'FAILED'::"text", 'CANCELLED'::"text"]))),
    CONSTRAINT "email_send_requests_status_shape" CHECK (((("status" = 'SENT'::"text") AND ("sent_at" IS NOT NULL) AND ("provider_message_id" IS NOT NULL) AND ("provider_thread_id" IS NOT NULL) AND ("safe_error_code" IS NULL)) OR (("status" = 'FAILED'::"text") AND ("sent_at" IS NULL) AND ("safe_error_code" IS NOT NULL)) OR (("status" = ANY (ARRAY['PENDING'::"text", 'SENDING'::"text", 'CANCELLED'::"text"])) AND ("sent_at" IS NULL)))),
    CONSTRAINT "email_send_requests_subject_not_blank" CHECK (("btrim"("subject") <> ''::"text")),
    CONSTRAINT "email_send_requests_to_address_required" CHECK (("cardinality"("to_addresses") > 0))
);


ALTER TABLE "public"."email_send_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_send_requests" IS 'Server-controlled send intent, retry, audit, and idempotency record. Rows are not an automatic-send queue in Phase 2B.1.';



COMMENT ON COLUMN "public"."email_send_requests"."reply_to_email_message_id" IS 'Local reply target identifier. Phase 2B.2 must resolve and verify its workspace/account server-side; no browser provider thread ID is authoritative.';



COMMENT ON COLUMN "public"."email_send_requests"."idempotency_key" IS 'Stable key for one logical send. Retries reuse this row and key rather than creating another request.';



COMMENT ON COLUMN "public"."email_send_requests"."safe_error_code" IS 'Controlled application category only; never store raw Gmail, OAuth, MIME, or database errors.';



COMMENT ON COLUMN "public"."email_send_requests"."send_lock_id" IS 'Server-only execution claim. Ambiguous delivery intentionally remains locked for later reconciliation.';



COMMENT ON COLUMN "public"."email_send_requests"."send_lock_at" IS 'Server-only claim timestamp. Phase 2B.3A has no stale-lock reclaim or automatic retry.';



CREATE TABLE IF NOT EXISTS "public"."email_sync_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email_account_id" "uuid" NOT NULL,
    "sync_type" "text" NOT NULL,
    "status" "text" DEFAULT 'NOT_STARTED'::"text" NOT NULL,
    "next_page_token" "text",
    "initial_history_id" "text",
    "batch_lock_id" "uuid",
    "batch_lock_at" timestamp with time zone,
    "processed_messages" integer DEFAULT 0 NOT NULL,
    "synced_messages" integer DEFAULT 0 NOT NULL,
    "skipped_messages" integer DEFAULT 0 NOT NULL,
    "failed_messages" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "last_batch_at" timestamp with time zone,
    "safe_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_sync_states_batch_lock_shape" CHECK (((("batch_lock_id" IS NULL) AND ("batch_lock_at" IS NULL)) OR (("batch_lock_id" IS NOT NULL) AND ("batch_lock_at" IS NOT NULL)))),
    CONSTRAINT "email_sync_states_completion_shape" CHECK ((("status" <> 'COMPLETED'::"text") OR (("completed_at" IS NOT NULL) AND ("next_page_token" IS NULL) AND ("initial_history_id" IS NOT NULL)))),
    CONSTRAINT "email_sync_states_counter_total_valid" CHECK (((("synced_messages" + "skipped_messages") + "failed_messages") <= "processed_messages")),
    CONSTRAINT "email_sync_states_counters_nonnegative" CHECK ((("processed_messages" >= 0) AND ("synced_messages" >= 0) AND ("skipped_messages" >= 0) AND ("failed_messages" >= 0))),
    CONSTRAINT "email_sync_states_initial_history_id_not_blank" CHECK ((("initial_history_id" IS NULL) OR ("btrim"("initial_history_id") <> ''::"text"))),
    CONSTRAINT "email_sync_states_next_page_token_not_blank" CHECK ((("next_page_token" IS NULL) OR ("btrim"("next_page_token") <> ''::"text"))),
    CONSTRAINT "email_sync_states_safe_error_code_not_blank" CHECK ((("safe_error_code" IS NULL) OR ("btrim"("safe_error_code") <> ''::"text"))),
    CONSTRAINT "email_sync_states_status_allowed" CHECK (("status" = ANY (ARRAY['NOT_STARTED'::"text", 'RUNNING'::"text", 'COMPLETED'::"text", 'FAILED'::"text"]))),
    CONSTRAINT "email_sync_states_sync_type_allowed" CHECK (("sync_type" = 'INITIAL'::"text"))
);


ALTER TABLE "public"."email_sync_states" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_sync_states" IS 'Authenticated application clients receive workspace-scoped progress metadata read access only. Checkpoint and counter mutations require the reviewed server-only Gmail sync boundary.';



COMMENT ON COLUMN "public"."email_sync_states"."next_page_token" IS 'Opaque Gmail messages.list page token. Server-only; never accept it from a browser.';



COMMENT ON COLUMN "public"."email_sync_states"."initial_history_id" IS 'History anchor from the newest message on the first page. Published to the account only after full initial sync completes.';



CREATE TABLE IF NOT EXISTS "public"."email_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email_account_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_thread_id" "text" NOT NULL,
    "subject" "text",
    "snippet" "text",
    "contact_id" "uuid",
    "first_message_at" timestamp with time zone,
    "last_message_at" timestamp with time zone,
    "message_count" integer DEFAULT 0 NOT NULL,
    "is_unread" boolean DEFAULT false NOT NULL,
    "is_starred" boolean DEFAULT false NOT NULL,
    "labels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "email_threads_labels_have_no_nulls" CHECK (("array_position"("labels", NULL::"text") IS NULL)),
    CONSTRAINT "email_threads_message_count_nonnegative" CHECK (("message_count" >= 0)),
    CONSTRAINT "email_threads_message_time_order" CHECK ((("first_message_at" IS NULL) OR ("last_message_at" IS NULL) OR ("first_message_at" <= "last_message_at"))),
    CONSTRAINT "email_threads_provider_allowed" CHECK (("provider" = 'GMAIL'::"text")),
    CONSTRAINT "email_threads_provider_thread_id_not_blank" CHECK (("btrim"("provider_thread_id") <> ''::"text"))
);


ALTER TABLE "public"."email_threads" OWNER TO "postgres";


COMMENT ON COLUMN "public"."email_threads"."provider_thread_id" IS 'Opaque Gmail thread ID. Keep as text; never convert to a JavaScript number.';



CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "company_id" "uuid",
    "content" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notes_content_not_blank" CHECK (("btrim"("content") <> ''::"text")),
    CONSTRAINT "notes_has_exactly_one_parent" CHECK (((("contact_id" IS NOT NULL) AND ("company_id" IS NULL)) OR (("contact_id" IS NULL) AND ("company_id" IS NOT NULL))))
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_full_name_not_blank" CHECK (("btrim"("full_name") <> ''::"text"))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspaces_name_not_blank" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_channels"
    ADD CONSTRAINT "contact_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_accounts"
    ADD CONSTRAINT "email_accounts_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."email_accounts"
    ADD CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_incremental_sync_states"
    ADD CONSTRAINT "email_incremental_sync_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_incremental_sync_states"
    ADD CONSTRAINT "email_incremental_sync_states_workspace_account_key" UNIQUE ("workspace_id", "email_account_id");



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_send_requests"
    ADD CONSTRAINT "email_send_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_send_requests"
    ADD CONSTRAINT "email_send_requests_workspace_account_idempotency_key" UNIQUE ("workspace_id", "email_account_id", "idempotency_key");



ALTER TABLE ONLY "public"."email_sync_states"
    ADD CONSTRAINT "email_sync_states_account_type_key" UNIQUE ("email_account_id", "workspace_id", "sync_type");



ALTER TABLE ONLY "public"."email_sync_states"
    ADD CONSTRAINT "email_sync_states_id_account_workspace_key" UNIQUE ("id", "email_account_id", "workspace_id");



ALTER TABLE ONLY "public"."email_sync_states"
    ADD CONSTRAINT "email_sync_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_id_account_workspace_key" UNIQUE ("id", "email_account_id", "workspace_id");



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_workspace_id_key" UNIQUE ("id", "workspace_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_workspace_actor_idx" ON "public"."audit_logs" USING "btree" ("workspace_id", "actor_id", "created_at" DESC) WHERE ("actor_id" IS NOT NULL);



CREATE INDEX "audit_logs_workspace_created_at_idx" ON "public"."audit_logs" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "audit_logs_workspace_entity_idx" ON "public"."audit_logs" USING "btree" ("workspace_id", "entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "companies_workspace_country_idx" ON "public"."companies" USING "btree" ("workspace_id", "country") WHERE ("country" IS NOT NULL);



CREATE INDEX "companies_workspace_created_at_idx" ON "public"."companies" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "companies_workspace_industry_idx" ON "public"."companies" USING "btree" ("workspace_id", "industry") WHERE ("industry" IS NOT NULL);



CREATE INDEX "companies_workspace_name_idx" ON "public"."companies" USING "btree" ("workspace_id", "lower"("name"));



CREATE INDEX "companies_workspace_status_idx" ON "public"."companies" USING "btree" ("workspace_id", "status");



CREATE INDEX "companies_workspace_website_idx" ON "public"."companies" USING "btree" ("workspace_id", "lower"("website")) WHERE ("website" IS NOT NULL);



CREATE UNIQUE INDEX "contact_channels_identity_unique_idx" ON "public"."contact_channels" USING "btree" ("workspace_id", "contact_id", "channel_type", "lower"("btrim"("channel_value")));



CREATE UNIQUE INDEX "contact_channels_one_primary_per_type_idx" ON "public"."contact_channels" USING "btree" ("workspace_id", "contact_id", "channel_type") WHERE "is_primary";



CREATE INDEX "contact_channels_workspace_contact_idx" ON "public"."contact_channels" USING "btree" ("workspace_id", "contact_id");



CREATE INDEX "contact_channels_workspace_type_idx" ON "public"."contact_channels" USING "btree" ("workspace_id", "channel_type");



CREATE INDEX "contact_channels_workspace_value_idx" ON "public"."contact_channels" USING "btree" ("workspace_id", "lower"("btrim"("channel_value")));



CREATE INDEX "contacts_workspace_company_id_idx" ON "public"."contacts" USING "btree" ("workspace_id", "company_id") WHERE ("company_id" IS NOT NULL);



CREATE INDEX "contacts_workspace_country_idx" ON "public"."contacts" USING "btree" ("workspace_id", "country") WHERE ("country" IS NOT NULL);



CREATE INDEX "contacts_workspace_created_at_idx" ON "public"."contacts" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "contacts_workspace_email_idx" ON "public"."contacts" USING "btree" ("workspace_id", "lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "contacts_workspace_lead_score_idx" ON "public"."contacts" USING "btree" ("workspace_id", "lead_score" DESC);



CREATE INDEX "contacts_workspace_lead_status_idx" ON "public"."contacts" USING "btree" ("workspace_id", "lead_status");



CREATE INDEX "contacts_workspace_name_idx" ON "public"."contacts" USING "btree" ("workspace_id", "lower"("full_name"));



CREATE INDEX "contacts_workspace_phone_idx" ON "public"."contacts" USING "btree" ("workspace_id", "phone") WHERE ("phone" IS NOT NULL);



CREATE INDEX "contacts_workspace_source_idx" ON "public"."contacts" USING "btree" ("workspace_id", "source") WHERE ("source" IS NOT NULL);



CREATE INDEX "email_accounts_workspace_connected_by_idx" ON "public"."email_accounts" USING "btree" ("workspace_id", "connected_by");



CREATE INDEX "email_accounts_workspace_last_sync_idx" ON "public"."email_accounts" USING "btree" ("workspace_id", "last_sync_at" DESC) WHERE ("last_sync_at" IS NOT NULL);



CREATE UNIQUE INDEX "email_accounts_workspace_provider_account_unique_idx" ON "public"."email_accounts" USING "btree" ("workspace_id", "provider", "provider_account_id") WHERE ("provider_account_id" IS NOT NULL);



CREATE UNIQUE INDEX "email_accounts_workspace_provider_email_unique_idx" ON "public"."email_accounts" USING "btree" ("workspace_id", "provider", "lower"("btrim"("email_address")));



CREATE INDEX "email_accounts_workspace_status_idx" ON "public"."email_accounts" USING "btree" ("workspace_id", "status");



CREATE INDEX "email_incremental_sync_states_workspace_status_idx" ON "public"."email_incremental_sync_states" USING "btree" ("workspace_id", "status");



CREATE INDEX "email_incremental_sync_states_workspace_updated_idx" ON "public"."email_incremental_sync_states" USING "btree" ("workspace_id", "updated_at" DESC);



CREATE UNIQUE INDEX "email_messages_provider_identity_unique_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "email_account_id", "provider", "provider_message_id");



CREATE INDEX "email_messages_workspace_account_hirex_send_request_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "email_account_id", "hirex_send_request_id") WHERE ("hirex_send_request_id" IS NOT NULL);



CREATE INDEX "email_messages_workspace_account_internal_date_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "email_account_id", "provider_internal_date" DESC);



CREATE INDEX "email_messages_workspace_account_unread_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "email_account_id", "provider_internal_date" DESC) WHERE "is_unread";



CREATE INDEX "email_messages_workspace_contact_internal_date_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "contact_id", "provider_internal_date" DESC) WHERE ("contact_id" IS NOT NULL);



CREATE INDEX "email_messages_workspace_from_email_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "lower"("btrim"("from_email"))) WHERE ("from_email" IS NOT NULL);



CREATE INDEX "email_messages_workspace_rfc_message_id_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "rfc_message_id") WHERE ("rfc_message_id" IS NOT NULL);



CREATE INDEX "email_messages_workspace_thread_internal_date_idx" ON "public"."email_messages" USING "btree" ("workspace_id", "email_thread_id", "provider_internal_date");



CREATE INDEX "email_send_requests_workspace_account_created_idx" ON "public"."email_send_requests" USING "btree" ("workspace_id", "email_account_id", "created_at" DESC);



CREATE INDEX "email_send_requests_workspace_reply_target_idx" ON "public"."email_send_requests" USING "btree" ("workspace_id", "email_account_id", "reply_to_email_message_id") WHERE ("reply_to_email_message_id" IS NOT NULL);



CREATE INDEX "email_send_requests_workspace_status_send_after_idx" ON "public"."email_send_requests" USING "btree" ("workspace_id", "status", "send_after", "created_at") WHERE ("status" = ANY (ARRAY['PENDING'::"text", 'FAILED'::"text"]));



CREATE INDEX "email_sync_states_workspace_status_idx" ON "public"."email_sync_states" USING "btree" ("workspace_id", "status");



CREATE INDEX "email_sync_states_workspace_updated_idx" ON "public"."email_sync_states" USING "btree" ("workspace_id", "updated_at" DESC);



CREATE UNIQUE INDEX "email_threads_provider_identity_unique_idx" ON "public"."email_threads" USING "btree" ("workspace_id", "email_account_id", "provider", "provider_thread_id");



CREATE INDEX "email_threads_workspace_account_last_message_idx" ON "public"."email_threads" USING "btree" ("workspace_id", "email_account_id", "last_message_at" DESC);



CREATE INDEX "email_threads_workspace_account_unread_idx" ON "public"."email_threads" USING "btree" ("workspace_id", "email_account_id", "last_message_at" DESC) WHERE "is_unread";



CREATE INDEX "email_threads_workspace_contact_last_message_idx" ON "public"."email_threads" USING "btree" ("workspace_id", "contact_id", "last_message_at" DESC) WHERE ("contact_id" IS NOT NULL);



CREATE INDEX "notes_workspace_company_created_at_idx" ON "public"."notes" USING "btree" ("workspace_id", "company_id", "created_at" DESC) WHERE ("company_id" IS NOT NULL);



CREATE INDEX "notes_workspace_contact_created_at_idx" ON "public"."notes" USING "btree" ("workspace_id", "contact_id", "created_at" DESC) WHERE ("contact_id" IS NOT NULL);



CREATE INDEX "notes_workspace_created_by_idx" ON "public"."notes" USING "btree" ("workspace_id", "created_by");



CREATE INDEX "profiles_workspace_id_idx" ON "public"."profiles" USING "btree" ("workspace_id");



CREATE OR REPLACE TRIGGER "companies_set_updated_at" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "contact_channels_set_updated_at" BEFORE UPDATE ON "public"."contact_channels" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "contacts_set_updated_at" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_accounts_set_updated_at" BEFORE UPDATE ON "public"."email_accounts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_incremental_sync_states_set_updated_at" BEFORE UPDATE ON "public"."email_incremental_sync_states" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_messages_set_updated_at" BEFORE UPDATE ON "public"."email_messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_send_requests_set_updated_at" BEFORE UPDATE ON "public"."email_send_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_sync_states_set_updated_at" BEFORE UPDATE ON "public"."email_sync_states" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "email_threads_set_updated_at" BEFORE UPDATE ON "public"."email_threads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "notes_set_updated_at" BEFORE UPDATE ON "public"."notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workspaces_set_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_same_workspace_fk" FOREIGN KEY ("actor_id", "workspace_id") REFERENCES "public"."profiles"("id", "workspace_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contact_channels"
    ADD CONSTRAINT "contact_channels_contact_same_workspace_fk" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "public"."contacts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_channels"
    ADD CONSTRAINT "contact_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_company_same_workspace_fk" FOREIGN KEY ("company_id", "workspace_id") REFERENCES "public"."companies"("id", "workspace_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_accounts"
    ADD CONSTRAINT "email_accounts_connected_by_same_workspace_fk" FOREIGN KEY ("connected_by", "workspace_id") REFERENCES "public"."profiles"("id", "workspace_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_accounts"
    ADD CONSTRAINT "email_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_incremental_sync_states"
    ADD CONSTRAINT "email_incremental_sync_states_account_same_workspace_fk" FOREIGN KEY ("email_account_id", "workspace_id") REFERENCES "public"."email_accounts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_incremental_sync_states"
    ADD CONSTRAINT "email_incremental_sync_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_account_same_workspace_fk" FOREIGN KEY ("email_account_id", "workspace_id") REFERENCES "public"."email_accounts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_contact_same_workspace_fk" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "public"."contacts"("id", "workspace_id") ON DELETE SET NULL ("contact_id");



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_thread_account_workspace_fk" FOREIGN KEY ("email_thread_id", "email_account_id", "workspace_id") REFERENCES "public"."email_threads"("id", "email_account_id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_send_requests"
    ADD CONSTRAINT "email_send_requests_account_same_workspace_fk" FOREIGN KEY ("email_account_id", "workspace_id") REFERENCES "public"."email_accounts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_send_requests"
    ADD CONSTRAINT "email_send_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_sync_states"
    ADD CONSTRAINT "email_sync_states_account_same_workspace_fk" FOREIGN KEY ("email_account_id", "workspace_id") REFERENCES "public"."email_accounts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_sync_states"
    ADD CONSTRAINT "email_sync_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_account_same_workspace_fk" FOREIGN KEY ("email_account_id", "workspace_id") REFERENCES "public"."email_accounts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_contact_same_workspace_fk" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "public"."contacts"("id", "workspace_id") ON DELETE SET NULL ("contact_id");



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_company_same_workspace_fk" FOREIGN KEY ("company_id", "workspace_id") REFERENCES "public"."companies"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_contact_same_workspace_fk" FOREIGN KEY ("contact_id", "workspace_id") REFERENCES "public"."contacts"("id", "workspace_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_creator_same_workspace_fk" FOREIGN KEY ("created_by", "workspace_id") REFERENCES "public"."profiles"("id", "workspace_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_self" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("actor_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "audit_logs_select_workspace" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_delete_workspace" ON "public"."companies" FOR DELETE TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "companies_insert_workspace" ON "public"."companies" FOR INSERT TO "authenticated" WITH CHECK (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "companies_select_workspace" ON "public"."companies" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "companies_update_workspace" ON "public"."companies" FOR UPDATE TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id"))) WITH CHECK (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."contact_channels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_channels_delete_workspace" ON "public"."contact_channels" FOR DELETE TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "contact_channels_insert_workspace" ON "public"."contact_channels" FOR INSERT TO "authenticated" WITH CHECK (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "contact_channels_select_workspace" ON "public"."contact_channels" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "contact_channels_update_workspace" ON "public"."contact_channels" FOR UPDATE TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id"))) WITH CHECK (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_delete_workspace" ON "public"."contacts" FOR DELETE TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "contacts_insert_workspace" ON "public"."contacts" FOR INSERT TO "authenticated" WITH CHECK (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "contacts_select_workspace" ON "public"."contacts" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "contacts_update_workspace" ON "public"."contacts" FOR UPDATE TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id"))) WITH CHECK (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."email_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_accounts_delete_workspace" ON "public"."email_accounts" FOR DELETE TO "authenticated" USING ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("connected_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "email_accounts_insert_workspace" ON "public"."email_accounts" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("connected_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "email_accounts_select_workspace" ON "public"."email_accounts" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "email_accounts_update_workspace" ON "public"."email_accounts" FOR UPDATE TO "authenticated" USING ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("connected_by" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("connected_by" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."email_incremental_sync_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_incremental_sync_states_select_workspace" ON "public"."email_incremental_sync_states" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."email_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_messages_select_workspace" ON "public"."email_messages" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."email_send_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_send_requests_select_workspace" ON "public"."email_send_requests" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."email_sync_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_sync_states_select_workspace" ON "public"."email_sync_states" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."email_threads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_threads_select_workspace" ON "public"."email_threads" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notes_delete_own" ON "public"."notes" FOR DELETE TO "authenticated" USING ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "notes_insert_workspace" ON "public"."notes" FOR INSERT TO "authenticated" WITH CHECK ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "notes_select_workspace" ON "public"."notes" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "notes_update_own" ON "public"."notes" FOR UPDATE TO "authenticated" USING ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_workspace" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) AND ("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")))) WITH CHECK ((("id" = ( SELECT "auth"."uid"() AS "uid")) AND ("workspace_id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id"))));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspaces_select_own" ON "public"."workspaces" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



CREATE POLICY "workspaces_update_own" ON "public"."workspaces" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id"))) WITH CHECK (("id" = ( SELECT "public"."current_workspace_id"() AS "current_workspace_id")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_reply_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_reply_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_workspace_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_workspace_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_workspace_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_workspace_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_incremental_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_history_records" integer, "p_affected_message_count" integer, "p_synced_message_count" integer, "p_deleted_message_count" integer, "p_failed_message_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_incremental_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_history_records" integer, "p_affected_message_count" integer, "p_synced_message_count" integer, "p_deleted_message_count" integer, "p_failed_message_count" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_initial_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_messages" integer, "p_synced_messages" integer, "p_skipped_messages" integer, "p_failed_messages" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_initial_email_sync"("p_state_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_batch_lock_id" "uuid", "p_processed_messages" integer, "p_synced_messages" integer, "p_skipped_messages" integer, "p_failed_messages" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_reconciled_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_email_message_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_reconciled_email_send_request"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_email_message_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_reply_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_reply_email_send_request_failed"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_safe_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_reply_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_reply_email_send_request_sent"("p_request_id" "uuid", "p_workspace_id" "uuid", "p_email_account_id" "uuid", "p_send_lock_id" "uuid", "p_provider_message_id" "text", "p_provider_thread_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."contact_channels" TO "anon";
GRANT ALL ON TABLE "public"."contact_channels" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_channels" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."email_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."email_accounts" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("workspace_id") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("connected_by") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("provider") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("email_address") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("provider_account_id") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("access_token_expires_at") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("scopes") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("last_sync_at") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("last_sync_error") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."email_accounts" TO "authenticated";



GRANT ALL ON TABLE "public"."email_incremental_sync_states" TO "service_role";



GRANT SELECT("email_account_id") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("processed_history_records") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("affected_message_count") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("synced_message_count") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("deleted_message_count") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("failed_message_count") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("started_at") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("completed_at") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("last_batch_at") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT SELECT("safe_error_code") ON TABLE "public"."email_incremental_sync_states" TO "authenticated";



GRANT ALL ON TABLE "public"."email_messages" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("workspace_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("email_account_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("email_thread_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("provider") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("provider_message_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("provider_history_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("rfc_message_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("in_reply_to") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("references_header") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("direction") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("from_email") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("from_name") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("to_emails") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("cc_emails") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("bcc_emails") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("subject") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("snippet") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("body_text") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("body_html") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("labels") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("is_unread") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("is_starred") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("sent_at") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("received_at") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("provider_internal_date") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("contact_id") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("has_attachments") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("attachment_count") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."email_messages" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."email_messages" TO "authenticated";



GRANT ALL ON TABLE "public"."email_send_requests" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("email_account_id") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("send_type") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("reply_to_email_message_id") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("to_addresses") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("cc_addresses") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("bcc_addresses") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("subject") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("body_text") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("body_html") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("send_after") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("attempt_count") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("safe_error_code") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("sent_at") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."email_send_requests" TO "authenticated";



GRANT ALL ON TABLE "public"."email_sync_states" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("workspace_id") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("email_account_id") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("sync_type") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("processed_messages") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("synced_messages") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("skipped_messages") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("failed_messages") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("started_at") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("completed_at") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("last_batch_at") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("safe_error_code") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."email_sync_states" TO "authenticated";



GRANT ALL ON TABLE "public"."email_threads" TO "service_role";
GRANT SELECT ON TABLE "public"."email_threads" TO "authenticated";



GRANT ALL ON TABLE "public"."notes" TO "anon";
GRANT ALL ON TABLE "public"."notes" TO "authenticated";
GRANT ALL ON TABLE "public"."notes" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







