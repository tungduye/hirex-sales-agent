-- 090: a Zalo nick whose send ended "delivery unknown" stays locked in the adapter until reconciled.
-- scripts/reconcile-zalo-send-locks.mjs (service role) now settles these by itself:
--   * the message is found in Deplao's own sent history -> confirm_zalo_delivery_unknown_sent (SENT);
--   * not found after the waiting time -> auto_acknowledge_zalo_delivery_unknown (no retry, nick freed).
-- Nicks that are still locked are published in zalo_account_send_locks so the channel page can warn.
begin;

-- An automatic acknowledgement has no person behind it (reconciled_by stays null).
alter table public.channel_outbound_actions drop constraint channel_outbound_actions_reconciliation_shape;
alter table public.channel_outbound_actions add constraint channel_outbound_actions_reconciliation_shape check (
  (reconciliation_status in ('NONE','NEEDS_REVIEW') and reconciled_at is null and reconciled_by is null)
  or
  (reconciliation_status = 'ACKNOWLEDGED_NO_RETRY' and status = 'DELIVERY_UNKNOWN'
    and reconciled_at is not null and retry_allowed = false)
);

create table if not exists public.zalo_account_send_locks (
  channel_account_id uuid primary key references public.channel_accounts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reason text not null check (reason in ('DELIVERY_UNKNOWN','SENDING')),
  locked_since timestamptz not null,
  action_id uuid references public.channel_outbound_actions(id) on delete set null,
  conversation_id uuid references public.omnichannel_conversations(id) on delete set null,
  auto_release_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.zalo_account_send_locks enable row level security;
create policy zalo_account_send_locks_read on public.zalo_account_send_locks for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.can_access_channel_account(channel_account_id));
grant select on public.zalo_account_send_locks to authenticated;
grant select, insert, update, delete on public.zalo_account_send_locks to service_role;

create or replace function public.confirm_zalo_delivery_unknown_sent(
  p_workspace_id uuid, p_action_id uuid, p_provider_message_id text, p_provider_conversation_id text, p_accepted_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_step public.channel_campaign_recipient_steps%rowtype; v_position integer;
  v_next public.channel_campaign_steps%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' or p_provider_conversation_id is null
    or btrim(p_provider_conversation_id) = '' or p_accepted_at is null then return false; end if;
  update public.channel_outbound_actions set status = 'SENT', provider_message_id = p_provider_message_id,
    provider_conversation_id = p_provider_conversation_id, accepted_at = p_accepted_at, safe_error_code = null,
    reconciliation_status = 'NONE', reconciled_at = null, reconciled_by = null, retry_allowed = false,
    execution_lock_id = null, execution_lock_at = null
  where id = p_action_id and workspace_id = p_workspace_id and channel_type = 'ZALO' and status = 'DELIVERY_UNKNOWN'
  returning approved_by into v_actor;
  if not found then
    return exists (select 1 from public.channel_outbound_actions where id = p_action_id and workspace_id = p_workspace_id
      and status = 'SENT' and provider_message_id = p_provider_message_id);
  end if;
  insert into public.audit_logs(workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_workspace_id, v_actor, 'CHANNEL_MESSAGE_SENT', 'CHANNEL_OUTBOUND_ACTION', p_action_id,
    jsonb_build_object('reconciledFrom', 'DELIVERY_UNKNOWN'));
  -- A campaign step that stopped on the unknown result carries on as if the send had been confirmed at once.
  update public.channel_campaign_recipient_steps set status = 'SENT', safe_error_code = null, completed_at = coalesce(completed_at, v_now)
  where workspace_id = p_workspace_id and outbound_action_id = p_action_id and status = 'DELIVERY_UNKNOWN'
  returning * into v_step;
  if found then
    insert into public.channel_campaign_events(workspace_id, campaign_id, recipient_id, event_type, metadata)
    values (p_workspace_id, v_step.campaign_id, v_step.recipient_id, 'SENT', jsonb_build_object('outboundActionId', p_action_id, 'reconciled', true));
    select position into v_position from public.channel_campaign_steps where id = v_step.step_id and workspace_id = p_workspace_id;
    select * into v_next from public.channel_campaign_steps where workspace_id = p_workspace_id and campaign_id = v_step.campaign_id
      and position > v_position order by position limit 1;
    if found then
      update public.channel_campaign_recipients set status = 'ACTIVE', stop_reason = null, current_step_position = v_next.position,
        next_step_at = v_now + make_interval(mins => v_next.delay_minutes)
      where id = v_step.recipient_id and workspace_id = p_workspace_id and status = 'DELIVERY_UNKNOWN' and stop_reason = 'DELIVERY_UNKNOWN';
    else
      update public.channel_campaign_recipients set status = 'COMPLETED', stop_reason = 'SEQUENCE_COMPLETED', next_step_at = null
      where id = v_step.recipient_id and workspace_id = p_workspace_id and status = 'DELIVERY_UNKNOWN' and stop_reason = 'DELIVERY_UNKNOWN';
    end if;
  end if;
  return true;
end $$;

create or replace function public.auto_acknowledge_zalo_delivery_unknown(p_workspace_id uuid, p_action_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.channel_outbound_actions set reconciliation_status = 'ACKNOWLEDGED_NO_RETRY', reconciled_at = clock_timestamp(),
    reconciled_by = null, retry_allowed = false
  where id = p_action_id and workspace_id = p_workspace_id and channel_type = 'ZALO' and status = 'DELIVERY_UNKNOWN'
    and reconciliation_status in ('NONE','NEEDS_REVIEW');
  if found then return true; end if;
  return exists (select 1 from public.channel_outbound_actions where id = p_action_id and workspace_id = p_workspace_id
    and status = 'DELIVERY_UNKNOWN' and reconciliation_status = 'ACKNOWLEDGED_NO_RETRY');
end $$;

revoke all on function public.confirm_zalo_delivery_unknown_sent(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.auto_acknowledge_zalo_delivery_unknown(uuid,uuid) from public, anon, authenticated;
grant execute on function public.confirm_zalo_delivery_unknown_sent(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.auto_acknowledge_zalo_delivery_unknown(uuid,uuid) to service_role;
commit;
