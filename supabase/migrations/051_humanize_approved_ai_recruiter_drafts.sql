begin;

create or replace function public.refresh_ai_recruiter_draft_policy(p_action_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_action public.channel_outbound_actions%rowtype;
  v_policy_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_action_id is null
    or not public.has_workspace_permission('inbox.reply') then return false; end if;

  select * into v_action from public.channel_outbound_actions
  where id=p_action_id and workspace_id=v_workspace_id and status='PROPOSED'
    and approved_by is null and approved_at is null
    and proposed_by='AI_ASSIST' and dispatch_source='AI_AUTOMATION'
    and idempotency_key like 'ai-recruiter-draft:%' for update;
  if not found or not public.can_access_channel_account(v_action.channel_account_id) then return false; end if;

  if exists(
    select 1 from public.channel_suppressions suppression
    where suppression.workspace_id=v_workspace_id and suppression.channel_type=v_action.channel_type
      and lower(btrim(suppression.normalized_recipient))=lower(btrim(v_action.recipient_external_id))
  ) or not exists(
    select 1 from public.channel_accounts account
    where account.id=v_action.channel_account_id and account.workspace_id=v_workspace_id
      and account.channel_type=v_action.channel_type and account.status='CONNECTED'
  ) or not exists(
    select 1 from public.omnichannel_conversations conversation
    where conversation.id=v_action.conversation_id and conversation.workspace_id=v_workspace_id
      and conversation.channel_account_id=v_action.channel_account_id
      and conversation.channel_type=v_action.channel_type and conversation.status in ('OPEN','PENDING')
  ) then return false; end if;

  insert into public.channel_policy_decisions(
    workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,
    allowed,reason_codes,expires_at
  ) values(
    v_workspace_id,v_action.conversation_id,v_action.channel_account_id,v_action.channel_type,
    lower(btrim(v_action.recipient_external_id)),true,array['AI_RECRUITER_HUMAN_REVIEW']::text[],
    clock_timestamp()+interval '10 minutes'
  ) returning id into v_policy_id;

  update public.channel_outbound_actions
  set policy_decision_id=v_policy_id,dispatch_source='HUMAN_MANUAL'
  where id=p_action_id and workspace_id=v_workspace_id and status='PROPOSED'
    and proposed_by='AI_ASSIST' and dispatch_source='AI_AUTOMATION';
  return found;
end $$;

commit;
