begin;

alter table public.channel_campaign_events drop constraint channel_campaign_events_type_allowed;
alter table public.channel_campaign_events add constraint channel_campaign_events_type_allowed
  check(event_type in ('CREATED','SCHEDULED','STARTED','PAUSED','RESUMED','COMPLETED','CANCELLED',
    'STEP_CLAIMED','ACTION_CREATED','ACTION_DEFERRED','SENT','FAILED','DELIVERY_UNKNOWN','REPLIED','SUPPRESSED'));

-- A lookup and a campaign send use the same account-level budget. Reserving
-- before the bridge call prevents two campaign workers from using one Zalo UI
-- concurrently. The interval exceeds the bridge's 20-second send timeout.
create function public.reserve_zalo_account_operation(
  p_workspace_id uuid, p_channel_account_id uuid, p_operation text
)
returns table(granted boolean, next_allowed_at timestamptz, backoff_level integer, last_error_code text)
language plpgsql security definer set search_path = '' as $$
declare v_state public.zalo_lookup_account_pacing%rowtype; v_now timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' or p_workspace_id is null or p_channel_account_id is null
    or p_operation not in ('LOOKUP','SEND') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(select 1 from public.channel_accounts a where a.id=p_channel_account_id
    and a.workspace_id=p_workspace_id and a.channel_type='ZALO' and a.status='CONNECTED'
    and a.operator_enabled) then
    return query select false, v_now + interval '5 minutes', 0, 'ACCOUNT_UNAVAILABLE'::text;
    return;
  end if;
  insert into public.zalo_lookup_account_pacing(workspace_id,channel_account_id)
    values(p_workspace_id,p_channel_account_id) on conflict do nothing;
  select * into v_state from public.zalo_lookup_account_pacing p
    where p.workspace_id=p_workspace_id and p.channel_account_id=p_channel_account_id for update;
  if v_state.next_allowed_at > v_now then
    return query select false,v_state.next_allowed_at,v_state.backoff_level,v_state.last_error_code;
    return;
  end if;
  update public.zalo_lookup_account_pacing p
    set next_allowed_at=v_now + interval '30 seconds',last_lookup_at=v_now,updated_at=v_now
    where p.workspace_id=p_workspace_id and p.channel_account_id=p_channel_account_id;
  return query select true,v_now + interval '30 seconds',v_state.backoff_level,v_state.last_error_code;
end $$;

create or replace function public.reserve_zalo_phone_lookup(p_workspace_id uuid,p_channel_account_id uuid)
returns table(granted boolean,next_allowed_at timestamptz,backoff_level integer,last_error_code text)
language sql security definer set search_path = '' as $$
  select * from public.reserve_zalo_account_operation(p_workspace_id,p_channel_account_id,'LOOKUP')
$$;

-- Once a step owns a queued action, never switch its sender account on a
-- later claim. The idempotency uniqueness is per account, not global.
create or replace function public.claim_channel_campaign_recipient_step(p_workspace_id uuid,p_campaign_id uuid,p_claim_lock_id uuid)
returns table(recipient_step_id uuid,recipient_id uuid,step_id uuid,channel_account_id uuid,channel_type text,recipient_external_id text,text_template text,attachment_ids uuid[],idempotency_key text,claim_lock_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_candidate record; v_now timestamptz:=clock_timestamp();
begin
  if p_workspace_id is null or p_campaign_id is null or p_claim_lock_id is null then return; end if;
  perform 1 from public.channel_campaigns campaign where campaign.id=p_campaign_id and campaign.workspace_id=p_workspace_id and campaign.status='RUNNING' for update;
  if not found then return; end if;
  select rs.id recipient_step_id,r.id recipient_id,s.id step_id,sender.channel_account_id,account.channel_type,cc.channel_value recipient_external_id,s.text_template,s.attachment_ids,rs.idempotency_key into v_candidate
  from public.channel_campaign_recipient_steps rs
  join public.channel_campaign_recipients r on r.id=rs.recipient_id and r.workspace_id=rs.workspace_id and r.campaign_id=rs.campaign_id
  join public.channel_campaign_steps s on s.id=rs.step_id and s.workspace_id=rs.workspace_id and s.campaign_id=rs.campaign_id and s.position=r.current_step_position
  join public.contact_channels cc on cc.contact_id=r.contact_id and cc.workspace_id=r.workspace_id and cc.channel_type=any(s.allowed_channels)
  join public.channel_campaign_senders sender on sender.campaign_id=rs.campaign_id and sender.workspace_id=rs.workspace_id and sender.enabled
  join public.channel_accounts account on account.id=sender.channel_account_id and account.workspace_id=sender.workspace_id and account.status='CONNECTED' and account.channel_type=cc.channel_type and account.operator_enabled
  where rs.workspace_id=p_workspace_id and rs.campaign_id=p_campaign_id and rs.status='PENDING' and r.status='ACTIVE' and r.next_step_at<=v_now
    and (rs.channel_account_id is null or rs.channel_account_id=sender.channel_account_id)
    and account.channel_type in ('FACEBOOK','FACEBOOK_PROFILE','ZALO') and cc.marketing_consent_status='OPTED_IN'
    and (s.text_template is null or 'SEND_TEXT'=any(account.capabilities)) and (cardinality(s.attachment_ids)=0 or 'SEND_FILE'=any(account.capabilities))
    and (account.channel_type not in ('ZALO','FACEBOOK_PROFILE') or (account.provider_health_status='HEALTHY' and account.provider_health_checked_at is not null and account.provider_health_checked_at between v_now-interval '5 minutes' and v_now+interval '30 seconds'))
    and (account.channel_type<>'FACEBOOK' or exists(select 1 from public.omnichannel_conversations conversation where conversation.workspace_id=p_workspace_id and conversation.channel_account_id=account.id and conversation.provider_conversation_id=cc.channel_value and conversation.status in ('OPEN','PENDING') and conversation.last_message_at>=v_now-interval '23 hours'))
    and (account.channel_type<>'FACEBOOK_PROFILE' or exists(select 1 from public.omnichannel_conversations conversation where conversation.workspace_id=p_workspace_id and conversation.channel_account_id=account.id and conversation.provider_conversation_id=cc.channel_value and conversation.status in ('OPEN','PENDING')))
    and not exists(select 1 from public.channel_suppressions suppression where suppression.workspace_id=p_workspace_id and suppression.channel_type=account.channel_type and lower(btrim(suppression.normalized_recipient))=lower(btrim(cc.channel_value)))
  order by r.next_step_at,rs.created_at,sender.priority,rs.id,account.id for update of rs skip locked limit 1;
  if v_candidate.recipient_step_id is null then return; end if;
  update public.channel_campaign_recipient_steps rs set status='CLAIMED',channel_account_id=v_candidate.channel_account_id,channel_type=v_candidate.channel_type,recipient_external_id=v_candidate.recipient_external_id,claimed_at=v_now,claim_lock_id=p_claim_lock_id where rs.id=v_candidate.recipient_step_id and rs.workspace_id=p_workspace_id and rs.status='PENDING';
  if not found then return; end if;
  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,p_campaign_id,v_candidate.recipient_id,'STEP_CLAIMED',jsonb_build_object('recipientStepId',v_candidate.recipient_step_id));
  return query select v_candidate.recipient_step_id,v_candidate.recipient_id,v_candidate.step_id,v_candidate.channel_account_id,v_candidate.channel_type,v_candidate.recipient_external_id,v_candidate.text_template,v_candidate.attachment_ids,v_candidate.idempotency_key,p_claim_lock_id;
end $$;

-- Only a pre-send slot denial or a bridge response explicitly saying BLOCKED
-- may reach this RPC. A timed-out/unknown provider result must never be reset.
create function public.defer_zalo_campaign_action_account_busy(
  p_workspace_id uuid,p_action_id uuid,p_execution_lock_id uuid,p_provider_rejected boolean
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_action public.channel_outbound_actions%rowtype;
  v_step public.channel_campaign_recipient_steps%rowtype;
  v_state public.zalo_lookup_account_pacing%rowtype;
  v_now timestamptz := clock_timestamp(); v_level integer; v_retry_at timestamptz;
begin
  if auth.role() <> 'service_role' or p_workspace_id is null or p_action_id is null
    or p_execution_lock_id is null or p_provider_rejected is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_action from public.channel_outbound_actions
    where id=p_action_id and workspace_id=p_workspace_id and channel_type='ZALO'
      and dispatch_source='CAMPAIGN' and status='EXECUTING' and attempt_count=1
      and execution_lock_id=p_execution_lock_id and provider_message_id is null and accepted_at is null
    for update;
  if not found then return false; end if;
  select * into v_step from public.channel_campaign_recipient_steps
    where workspace_id=p_workspace_id and outbound_action_id=p_action_id
      and channel_account_id=v_action.channel_account_id
      and recipient_external_id=v_action.recipient_external_id
      and idempotency_key=v_action.idempotency_key
      and status='ACTION_CREATED' for update;
  if not found then return false; end if;
  if not exists(select 1 from public.channel_campaign_recipients r
    where r.id=v_step.recipient_id and r.workspace_id=p_workspace_id and r.status='ACTIVE') then
    return false;
  end if;
  select * into v_state from public.zalo_lookup_account_pacing p
    where p.workspace_id=p_workspace_id and p.channel_account_id=v_action.channel_account_id for update;
  if not found then return false; end if;
  if p_provider_rejected then
    v_level := least(v_state.backoff_level+1,6);
    update public.zalo_lookup_account_pacing p
      set next_allowed_at=greatest(p.next_allowed_at,v_now+make_interval(secs=>least(60*(2^(v_level-1))::integer,7200))),
        backoff_level=v_level,last_error_code='ACCOUNT_BUSY',updated_at=v_now
      where p.workspace_id=p_workspace_id and p.channel_account_id=v_action.channel_account_id
      returning p.next_allowed_at into v_retry_at;
  else
    v_retry_at := v_state.next_allowed_at;
  end if;
  v_retry_at := greatest(v_retry_at,v_now+interval '30 seconds');
  update public.channel_outbound_actions
    set status='QUEUED',attempt_count=0,execution_lock_id=null,execution_lock_at=null,safe_error_code=null
    where id=p_action_id and workspace_id=p_workspace_id;
  update public.channel_campaign_recipient_steps
    set status='PENDING',outbound_action_id=null,claim_lock_id=null,claimed_at=null,
      completed_at=null,safe_error_code=null
    where id=v_step.id and workspace_id=p_workspace_id;
  update public.channel_campaign_recipients
    set next_step_at=greatest(coalesce(next_step_at,v_retry_at),v_retry_at)
    where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE';
  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata)
    values(p_workspace_id,v_step.campaign_id,v_step.recipient_id,'ACTION_DEFERRED',
      jsonb_build_object('reason','ACCOUNT_BUSY','retryAt',v_retry_at,'outboundActionId',p_action_id));
  return true;
end $$;

revoke all on function public.reserve_zalo_account_operation(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.defer_zalo_campaign_action_account_busy(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_zalo_account_operation(uuid,uuid,text) to service_role;
grant execute on function public.defer_zalo_campaign_action_account_busy(uuid,uuid,uuid,boolean) to service_role;

commit;
