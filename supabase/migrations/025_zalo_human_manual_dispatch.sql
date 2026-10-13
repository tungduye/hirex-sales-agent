-- Phase 6: trusted source boundary for immediate human replies from Unified Inbox.
alter table public.channel_outbound_actions
  add column dispatch_source text not null default 'SYSTEM',
  add constraint channel_outbound_actions_dispatch_source_allowed
    check (dispatch_source in ('HUMAN_MANUAL','AI_AUTOMATION','CAMPAIGN','SYSTEM'));

create or replace function public.propose_channel_message(
  p_conversation_id uuid,
  p_text_content text,
  p_idempotency_key text,
  p_proposed_by text default 'HUMAN'
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_conversation public.omnichannel_conversations%rowtype;
  v_recipient text;
  v_allowed boolean;
  v_policy_id uuid;
  v_action_id uuid;
  v_dispatch_source text;
begin
  if v_workspace_id is null or v_actor_id is null or p_text_content is null or btrim(p_text_content)='' or length(p_text_content)>100000
    or p_idempotency_key is null or btrim(p_idempotency_key)='' or length(p_idempotency_key)>256
    or p_proposed_by not in ('HUMAN','AI_ASSIST') then return null; end if;
  v_dispatch_source := case when p_proposed_by='HUMAN' then 'HUMAN_MANUAL' else 'AI_AUTOMATION' end;
  select * into v_conversation from public.omnichannel_conversations
    where id=p_conversation_id and workspace_id=v_workspace_id and status in ('OPEN','PENDING','RESOLVED') for update;
  if not found then return null; end if;
  select sender_external_id into v_recipient from public.omnichannel_messages
    where workspace_id=v_workspace_id and conversation_id=v_conversation.id and direction='INBOUND'
    order by received_at desc nulls last,created_at desc limit 1;
  if v_recipient is null or btrim(v_recipient)='' then return null; end if;
  v_allowed := exists(select 1 from public.channel_accounts where id=v_conversation.channel_account_id
      and workspace_id=v_workspace_id and status='CONNECTED' and channel_type=v_conversation.channel_type)
    and not exists(select 1 from public.channel_suppressions where workspace_id=v_workspace_id
      and channel_type=v_conversation.channel_type and lower(btrim(normalized_recipient))=lower(btrim(v_recipient)));
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
  values(v_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,lower(btrim(v_recipient)),v_allowed,
    case when v_allowed then '{}'::text[] else array['ACCOUNT_OR_SUPPRESSION_BLOCK']::text[] end,clock_timestamp()+interval '10 minutes')
  returning id into v_policy_id;
  if not v_allowed then return null; end if;
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,text_content,
    idempotency_key,policy_decision_id,proposed_by,dispatch_source)
  values(v_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,v_recipient,p_text_content,
    p_idempotency_key,v_policy_id,p_proposed_by,v_dispatch_source)
  on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then
    select id into v_action_id from public.channel_outbound_actions where workspace_id=v_workspace_id
      and channel_account_id=v_conversation.channel_account_id and idempotency_key=p_idempotency_key
      and conversation_id=v_conversation.id and text_content=p_text_content and status='PROPOSED'
      and dispatch_source=v_dispatch_source;
  end if;
  if v_action_id is not null then
    insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_workspace_id,v_actor_id,'CHANNEL_MESSAGE_PROPOSED','CHANNEL_OUTBOUND_ACTION',v_action_id,
      jsonb_build_object('proposedBy',p_proposed_by,'dispatchSource',v_dispatch_source));
  end if;
  return v_action_id;
end $$;

comment on column public.channel_outbound_actions.dispatch_source is
  'Trusted server-assigned execution source. Zalo transport permits HUMAN_MANUAL only in this phase.';
