begin;

alter table public.channel_campaign_steps
  add column content_variants text[] not null default '{}'::text[];

create function public.channel_campaign_content_variants_valid(p_variants text[])
returns boolean language sql immutable set search_path='' as $$
  select coalesce(bool_and(btrim(value) <> '' and length(value) <= 100000), true)
  from unnest(p_variants) as variants(value)
$$;

alter table public.channel_campaign_steps
  add constraint channel_campaign_steps_content_variants_valid check (
    cardinality(content_variants) <= 10
    and array_position(content_variants, null) is null
    and public.channel_campaign_content_variants_valid(content_variants)
  );

-- Pick a stable content variant by recipient-step ID. Retries reuse the same
-- idempotency key and therefore keep the same message text.
create or replace function public.materialize_channel_campaign_action(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_recipient_step_id uuid,
  p_claim_lock_id uuid
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_step public.channel_campaign_recipient_steps%rowtype;
  v_campaign public.channel_campaigns%rowtype;
  v_template text;
  v_variants text[];
  v_attachments uuid[];
  v_policy_id uuid;
  v_action_id uuid;
  v_variant_index integer;
begin
  select * into v_campaign from public.channel_campaigns
    where id=p_campaign_id and workspace_id=p_workspace_id and status='RUNNING' for update;
  if not found then return null; end if;

  select * into v_step from public.channel_campaign_recipient_steps
    where id=p_recipient_step_id and workspace_id=p_workspace_id and campaign_id=p_campaign_id
      and status='CLAIMED' and claim_lock_id=p_claim_lock_id for update;
  if not found or v_step.channel_account_id is null or v_step.channel_type is null or v_step.recipient_external_id is null then return null; end if;

  if exists(
    select 1 from public.channel_suppressions
    where workspace_id=p_workspace_id and channel_type=v_step.channel_type
      and lower(btrim(normalized_recipient))=lower(btrim(v_step.recipient_external_id))
  ) then
    update public.channel_campaign_recipient_steps
      set status='STOPPED',safe_error_code='RECIPIENT_SUPPRESSED',claim_lock_id=null,completed_at=clock_timestamp()
      where id=v_step.id;
    update public.channel_campaign_recipients
      set status='SUPPRESSED',stop_reason='SUPPRESSED',next_step_at=null
      where id=v_step.recipient_id and workspace_id=p_workspace_id and status='ACTIVE';
    return null;
  end if;

  select text_template,content_variants,attachment_ids
    into v_template,v_variants,v_attachments
    from public.channel_campaign_steps where id=v_step.step_id and workspace_id=p_workspace_id;
  if coalesce(cardinality(v_variants),0)>0 then
    v_variant_index := 1 + ((hashtextextended(v_step.id::text,0) & 9223372036854775807) % cardinality(v_variants))::integer;
    v_template := v_variants[v_variant_index];
  end if;

  insert into public.channel_policy_decisions(
    workspace_id,channel_account_id,channel_type,normalized_recipient,allowed,expires_at
  ) values(
    p_workspace_id,v_step.channel_account_id,v_step.channel_type,
    lower(btrim(v_step.recipient_external_id)),true,clock_timestamp()+interval '10 minutes'
  ) returning id into v_policy_id;

  insert into public.channel_outbound_actions(
    workspace_id,channel_account_id,channel_type,recipient_external_id,status,text_content,
    attachment_ids,idempotency_key,policy_decision_id,proposed_by,approved_by,approved_at,dispatch_source
  ) values(
    p_workspace_id,v_step.channel_account_id,v_step.channel_type,v_step.recipient_external_id,'QUEUED',v_template,
    v_attachments,v_step.idempotency_key,v_policy_id,'HUMAN',v_campaign.created_by,clock_timestamp(),'CAMPAIGN'
  )
  on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;

  if v_action_id is null then
    select id into v_action_id from public.channel_outbound_actions
      where workspace_id=p_workspace_id and channel_account_id=v_step.channel_account_id
        and idempotency_key=v_step.idempotency_key and dispatch_source='CAMPAIGN';
  end if;
  if v_action_id is null then return null; end if;

  update public.channel_campaign_recipient_steps
    set status='ACTION_CREATED',outbound_action_id=v_action_id,claim_lock_id=null
    where id=v_step.id and workspace_id=p_workspace_id and status='CLAIMED' and claim_lock_id=p_claim_lock_id;
  if not found then return null; end if;

  insert into public.channel_campaign_events(workspace_id,campaign_id,recipient_id,event_type,metadata)
    values(p_workspace_id,p_campaign_id,v_step.recipient_id,'ACTION_CREATED',jsonb_build_object('outboundActionId',v_action_id));
  return v_action_id;
end $$;

revoke all on function public.materialize_channel_campaign_action(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.materialize_channel_campaign_action(uuid,uuid,uuid,uuid) to service_role;

commit;
