alter table public.channel_outbound_actions
  add column reconciliation_status text not null default 'NONE',
  add column reconciled_at timestamptz,
  add column reconciled_by uuid,
  add column retry_allowed boolean not null default false,
  add constraint channel_outbound_actions_reconciliation_status_allowed
    check (reconciliation_status in ('NONE','NEEDS_REVIEW','ACKNOWLEDGED_NO_RETRY')),
  add constraint channel_outbound_actions_reconciled_by_workspace_fk
    foreign key (reconciled_by, workspace_id) references public.profiles(id, workspace_id) on delete restrict,
  add constraint channel_outbound_actions_reconciliation_shape check (
    (reconciliation_status in ('NONE','NEEDS_REVIEW') and reconciled_at is null and reconciled_by is null)
    or
    (reconciliation_status = 'ACKNOWLEDGED_NO_RETRY' and status = 'DELIVERY_UNKNOWN'
      and reconciled_at is not null and reconciled_by is not null and retry_allowed = false)
  );

update public.channel_outbound_actions
set reconciliation_status = 'NEEDS_REVIEW', retry_allowed = false
where status = 'DELIVERY_UNKNOWN';

create or replace function public.acknowledge_channel_delivery_unknown_no_retry(
  p_workspace_id uuid, p_action_id uuid, p_reconciled_by uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_reconciled_by and workspace_id = p_workspace_id
  ) then return false; end if;

  update public.channel_outbound_actions
  set reconciliation_status = 'ACKNOWLEDGED_NO_RETRY', reconciled_at = clock_timestamp(),
      reconciled_by = p_reconciled_by, retry_allowed = false
  where id = p_action_id and workspace_id = p_workspace_id and status = 'DELIVERY_UNKNOWN'
    and reconciliation_status in ('NONE','NEEDS_REVIEW');
  if found then return true; end if;

  return exists (
    select 1 from public.channel_outbound_actions
    where id = p_action_id and workspace_id = p_workspace_id and status = 'DELIVERY_UNKNOWN'
      and reconciliation_status = 'ACKNOWLEDGED_NO_RETRY' and retry_allowed = false
  );
end $$;

create or replace function public.finalize_channel_outbound_action_failed(
  p_workspace_id uuid,p_action_id uuid,p_execution_lock_id uuid,p_safe_error_code text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_safe_error_code not in ('INVALID_WEBHOOK','UNSUPPORTED_EVENT','ACCOUNT_UNAVAILABLE','PERMISSION_DENIED','RATE_LIMITED','DELIVERY_REJECTED','ACCOUNT_BUSY') then return false; end if;
  update public.channel_outbound_actions set status='FAILED',safe_error_code=p_safe_error_code,
    execution_lock_id=null,execution_lock_at=null,retry_allowed=false
  where id=p_action_id and workspace_id=p_workspace_id and status='EXECUTING'
    and execution_lock_id=p_execution_lock_id and attempt_count=1;
  return found;
end $$;

revoke all on function public.acknowledge_channel_delivery_unknown_no_retry(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.acknowledge_channel_delivery_unknown_no_retry(uuid,uuid,uuid) to service_role;
grant select(reconciliation_status,reconciled_at,reconciled_by,retry_allowed)
  on public.channel_outbound_actions to authenticated;

comment on column public.channel_outbound_actions.reconciliation_status is
  'Operator reconciliation of an unknown delivery fact; acknowledgement never changes delivery status or permits retry.';
