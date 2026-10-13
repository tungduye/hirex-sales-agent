create or replace function public.finalize_channel_outbound_action_failed(
  p_workspace_id uuid,p_action_id uuid,p_execution_lock_id uuid,p_safe_error_code text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_safe_error_code not in (
    'INVALID_WEBHOOK','UNSUPPORTED_EVENT','ACCOUNT_UNAVAILABLE','PERMISSION_DENIED',
    'RATE_LIMITED','DELIVERY_REJECTED','ACCOUNT_BUSY','FACEBOOK_RESPONSE_WINDOW_EXPIRED',
    'CHANNEL_ELIGIBILITY_UNAVAILABLE'
  ) then return false; end if;
  update public.channel_outbound_actions set status='FAILED',safe_error_code=p_safe_error_code,
    execution_lock_id=null,execution_lock_at=null,retry_allowed=false
  where id=p_action_id and workspace_id=p_workspace_id and status='EXECUTING'
    and execution_lock_id=p_execution_lock_id and attempt_count=1;
  return found;
end $$;

revoke all on function public.finalize_channel_outbound_action_failed(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.finalize_channel_outbound_action_failed(uuid,uuid,uuid,text)
  to service_role;
