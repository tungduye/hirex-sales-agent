-- HireX Sales Agent - Phase 2B.4F-A provider-ID regex compatibility hotfix.
-- Replaces only the REPLY SENT finalizer; lifecycle and privileges are unchanged.

begin;

create or replace function public.finalize_reply_email_send_request_sent(
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
$$;

comment on function public.finalize_reply_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) is
  'Server-only exact-lock REPLY SENDING-to-SENT finalizer. The outgoing RFC Message-ID remains NULL until canonical mailbox evidence is observed.';

revoke all on function public.finalize_reply_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function public.finalize_reply_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) from anon;
revoke all on function public.finalize_reply_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.finalize_reply_email_send_request_sent(uuid, uuid, uuid, uuid, text, text) to service_role;

commit;
