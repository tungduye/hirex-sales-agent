-- HireX Phase 6: Zalo bridge operator state and trusted provider-health cache.
begin;

alter table public.channel_accounts
  add column operator_enabled boolean not null default true,
  add column provider_health_status text not null default 'UNKNOWN',
  add column provider_health_checked_at timestamptz,
  add column provider_health_reason_code text,
  add column provider_health_latency_ms integer,
  add constraint channel_accounts_provider_health_allowed
    check(provider_health_status in ('HEALTHY','DEGRADED','DISCONNECTED','AUTH_REQUIRED','UNKNOWN')),
  add constraint channel_accounts_provider_health_initial_shape check(
    provider_health_checked_at is not null
    or (provider_health_status='UNKNOWN' and provider_health_reason_code is null and provider_health_latency_ms is null)
  ),
  add constraint channel_accounts_provider_health_reason_safe check(
    provider_health_reason_code is null or (btrim(provider_health_reason_code)<>'' and length(provider_health_reason_code)<=100 and provider_health_reason_code !~ '[[:cntrl:]]')
  ),
  add constraint channel_accounts_provider_health_latency_valid check(provider_health_latency_ms is null or provider_health_latency_ms between 0 and 60000);

create index channel_accounts_dispatch_health_idx
  on public.channel_accounts(workspace_id,channel_type,operator_enabled,provider_health_status,provider_health_checked_at);

create function public.set_channel_account_operator_enabled(p_channel_account_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace_id uuid:=public.current_workspace_id(); v_actor_id uuid:=auth.uid();
begin
  if v_workspace_id is null or v_actor_id is null or p_channel_account_id is null or p_enabled is null then return false; end if;
  update public.channel_accounts set operator_enabled=p_enabled
  where id=p_channel_account_id and workspace_id=v_workspace_id and channel_type in ('FACEBOOK','ZALO') and status<>'DISCONNECTED';
  if not found then return false; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_workspace_id,v_actor_id,'CHANNEL_ACCOUNT_OPERATOR_STATE_SET','CHANNEL_ACCOUNT',p_channel_account_id,jsonb_build_object('enabled',p_enabled));
  return true;
end $$;

create function public.record_channel_account_provider_health(
  p_workspace_id uuid,p_channel_account_id uuid,p_status text,p_checked_at timestamptz,p_safe_reason_code text,p_latency_ms integer
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_workspace_id is null or p_channel_account_id is null or p_checked_at is null
    or p_status not in ('HEALTHY','DEGRADED','DISCONNECTED','AUTH_REQUIRED','UNKNOWN')
    or (p_safe_reason_code is not null and (btrim(p_safe_reason_code)='' or length(p_safe_reason_code)>100 or p_safe_reason_code ~ '[[:cntrl:]]'))
    or (p_latency_ms is not null and (p_latency_ms<0 or p_latency_ms>60000)) then return false; end if;
  update public.channel_accounts set provider_health_status=p_status,provider_health_checked_at=p_checked_at,
    provider_health_reason_code=p_safe_reason_code,provider_health_latency_ms=p_latency_ms
  where id=p_channel_account_id and workspace_id=p_workspace_id and channel_type='ZALO' and provider='ZALO_BRIDGE';
  return found;
end $$;

-- The existing campaign claim remains authoritative under its campaign/step lock;
-- add the operator and fresh-health predicates without changing its return contract.
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
    and account.channel_type in ('FACEBOOK','ZALO') and cc.marketing_consent_status='OPTED_IN'
    and (s.text_template is null or 'SEND_TEXT'=any(account.capabilities)) and (cardinality(s.attachment_ids)=0 or 'SEND_FILE'=any(account.capabilities))
    and (account.channel_type<>'ZALO' or (account.provider_health_status='HEALTHY' and account.provider_health_checked_at is not null and account.provider_health_checked_at between v_now-interval '5 minutes' and v_now+interval '30 seconds'))
    and (account.channel_type<>'FACEBOOK' or exists(select 1 from public.omnichannel_conversations conversation where conversation.workspace_id=p_workspace_id and conversation.channel_account_id=account.id and conversation.provider_conversation_id=cc.channel_value and conversation.status in ('OPEN','PENDING') and conversation.last_message_at>=v_now-interval '23 hours'))
    and not exists(select 1 from public.channel_suppressions suppression where suppression.workspace_id=p_workspace_id and suppression.channel_type=account.channel_type and lower(btrim(suppression.normalized_recipient))=lower(btrim(cc.channel_value)))
  order by r.next_step_at,rs.created_at,sender.priority,rs.id,account.id for update of rs skip locked limit 1;
  if v_candidate.recipient_step_id is null then return; end if;
  update public.channel_campaign_recipient_steps rs set status='CLAIMED',channel_account_id=v_candidate.channel_account_id,channel_type=v_candidate.channel_type,recipient_external_id=v_candidate.recipient_external_id,claimed_at=v_now,claim_lock_id=p_claim_lock_id where rs.id=v_candidate.recipient_step_id and rs.workspace_id=p_workspace_id and rs.status='PENDING';
  if not found then return; end if;
  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata) values(p_workspace_id,p_campaign_id,v_candidate.recipient_id,'STEP_CLAIMED',jsonb_build_object('recipientStepId',v_candidate.recipient_step_id));
  return query select v_candidate.recipient_step_id,v_candidate.recipient_id,v_candidate.step_id,v_candidate.channel_account_id,v_candidate.channel_type,v_candidate.recipient_external_id,v_candidate.text_template,v_candidate.attachment_ids,v_candidate.idempotency_key,p_claim_lock_id;
end $$;

revoke all on function public.set_channel_account_operator_enabled(uuid,boolean) from public,anon;
grant execute on function public.set_channel_account_operator_enabled(uuid,boolean) to authenticated;
revoke all on function public.record_channel_account_provider_health(uuid,uuid,text,timestamptz,text,integer) from public,anon,authenticated;
grant execute on function public.record_channel_account_provider_health(uuid,uuid,text,timestamptz,text,integer) to service_role;

commit;
