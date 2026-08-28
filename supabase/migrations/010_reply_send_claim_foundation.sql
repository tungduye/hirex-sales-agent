-- HireX Sales Agent - Phase 2B.4C transactional REPLY claim foundation.
-- This migration does not send Gmail, build MIME, finalize, retry, or reclaim locks.

begin;

create function public.claim_reply_email_send_request(
  p_request_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_send_lock_id uuid
)
returns table (
  request_id uuid,
  workspace_id uuid,
  email_account_id uuid,
  reply_to_email_message_id uuid,
  send_lock_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
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

comment on function public.claim_reply_email_send_request(uuid, uuid, uuid, uuid) is
  'Server-only, first-attempt REPLY PENDING-to-SENDING claim. A successful claim does not authorize Gmail delivery; canonical reply evidence must be re-evaluated before send.';

revoke all on function public.claim_reply_email_send_request(uuid, uuid, uuid, uuid) from public;
revoke all on function public.claim_reply_email_send_request(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.claim_reply_email_send_request(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.claim_reply_email_send_request(uuid, uuid, uuid, uuid) to service_role;

commit;
