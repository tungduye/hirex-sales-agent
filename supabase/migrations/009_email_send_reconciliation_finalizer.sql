-- HireX Sales Agent - Phase 2B.3E transactional send reconciliation finalizer.
-- Foundation only: this RPC is not wired to any scheduler, API route, UI, Gmail
-- call, retry, or stale-lock recovery path.

begin;

create or replace function public.finalize_reconciled_email_send_request(
  p_request_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_email_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function public.finalize_reconciled_email_send_request(uuid, uuid, uuid, uuid) is
  'Server-only transactional SENDING-to-SENT reconciliation. Revalidates canonical Gmail evidence and never sends or retries email.';

revoke all on function public.finalize_reconciled_email_send_request(uuid, uuid, uuid, uuid) from public;
revoke all on function public.finalize_reconciled_email_send_request(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.finalize_reconciled_email_send_request(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.finalize_reconciled_email_send_request(uuid, uuid, uuid, uuid) to service_role;

commit;
