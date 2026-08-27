-- HireX Sales Agent - Phase 2B.3A one-message Gmail send execution locking.
-- This migration adds server-only claim/finalize primitives. It does not send
-- mail, retry ambiguous deliveries, or grant browser mutation access.

begin;

alter table public.email_send_requests
  add column send_lock_id uuid,
  add column send_lock_at timestamptz,
  add constraint email_send_requests_send_lock_shape check (
    (
      status = 'SENDING'
      and send_lock_id is not null
      and send_lock_at is not null
    )
    or (
      status <> 'SENDING'
      and send_lock_id is null
      and send_lock_at is null
    )
  );

comment on column public.email_send_requests.send_lock_id is
  'Server-only execution claim. Ambiguous delivery intentionally remains locked for later reconciliation.';
comment on column public.email_send_requests.send_lock_at is
  'Server-only claim timestamp. Phase 2B.3A has no stale-lock reclaim or automatic retry.';

create or replace function public.claim_email_send_request(
  p_request_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_send_lock_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.claim_email_send_request(uuid, uuid, uuid, uuid) from public;
revoke all on function public.claim_email_send_request(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.claim_email_send_request(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.claim_email_send_request(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.finalize_email_send_request_sent(
  p_request_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_send_lock_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.finalize_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function public.finalize_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) from anon;
revoke all on function public.finalize_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.finalize_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) to service_role;

create or replace function public.finalize_email_send_request_failed(
  p_request_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_send_lock_id uuid,
  p_safe_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.finalize_email_send_request_failed(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.finalize_email_send_request_failed(uuid, uuid, uuid, uuid, text) from anon;
revoke all on function public.finalize_email_send_request_failed(uuid, uuid, uuid, uuid, text) from authenticated;
grant execute on function public.finalize_email_send_request_failed(uuid, uuid, uuid, uuid, text) to service_role;

commit;
