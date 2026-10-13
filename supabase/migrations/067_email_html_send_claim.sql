-- Support rich-text NEW messages; preserve all lock and idempotency guards.
-- Does not reset, claim or retry any existing delivery.
begin;
create or replace function public.claim_email_send_request(
  p_request_id uuid, p_workspace_id uuid,
  p_email_account_id uuid, p_send_lock_id uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_send_lock_id is null then return false; end if;
  update public.email_send_requests
  set status = 'SENDING', attempt_count = attempt_count + 1,
      last_attempt_at = clock_timestamp(), safe_error_code = null,
      send_lock_id = p_send_lock_id, send_lock_at = clock_timestamp()
  where id = p_request_id and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and send_type = 'NEW' and status = 'PENDING'
    and send_lock_id is null and send_lock_at is null
    and rfc_message_id is not null
    and cardinality(to_addresses) = 1
    and cardinality(cc_addresses) = 0
    and cardinality(bcc_addresses) = 0
    and body_text is not null
    and (body_html is null or btrim(body_html) <> '')
    and send_after is null;
  return found;
end;
$$;
revoke all on function public.claim_email_send_request(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_send_request(uuid, uuid, uuid, uuid) to service_role;
commit;
