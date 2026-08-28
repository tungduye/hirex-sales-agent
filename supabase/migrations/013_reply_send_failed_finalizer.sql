-- HireX Sales Agent - Phase 2B.4F-C1 deterministic REPLY failure finalizer.
-- This RPC is only for failures known to occur before Gmail acceptance.

begin;

create function public.finalize_reply_email_send_request_failed(
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

comment on function public.finalize_reply_email_send_request_failed(uuid, uuid, uuid, uuid, text) is
  'Server-only exact-lock REPLY SENDING-to-FAILED finalizer for reviewed deterministic failures known to occur before Gmail acceptance. Never use after an ambiguous or successful Gmail transport outcome.';

revoke all on function public.finalize_reply_email_send_request_failed(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.finalize_reply_email_send_request_failed(uuid, uuid, uuid, uuid, text) from anon;
revoke all on function public.finalize_reply_email_send_request_failed(uuid, uuid, uuid, uuid, text) from authenticated;
grant execute on function public.finalize_reply_email_send_request_failed(uuid, uuid, uuid, uuid, text) to service_role;

commit;
