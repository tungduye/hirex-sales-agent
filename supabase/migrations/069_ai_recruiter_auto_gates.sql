-- 069: tighten the AI Recruiter AUTO path (ARCHITECTURE.md §4.2 gaps 1-3).
--
-- 1. The database gate now requires BOTH the bot and the conversation to be AUTO,
--    matching the application gate (052 accepted either one).
-- 2. AUTO sends carry no human approver. approved_by stays NULL and the action is
--    identified by proposed_by='AI_ASSIST' + dispatch_source='AI_AUTOMATION'.
--    Human approvals (approve_channel_outbound_action, campaigns) still require an approver.
-- 3. Every change to a bot's enabled/mode or a conversation's AUTO override is written
--    to audit_logs. The acting admin is passed in a single-use field that the trigger
--    consumes: ai_recruiter_bots.mode_change_actor / metadata.aiRecruiterModeChangedBy.
--    Changes made without it (scripts, SQL console) are still logged with actor NULL.
--
-- Deploy together with the application change that accepts approved_by = NULL for
-- AI_AUTOMATION actions (execute-outbound-action.ts, execute-channel-outbound-action.ts).
-- An older application rejects those actions, so apply this while the web app is stopped
-- (scripts/deploy-recruiter-tone.ps1 -MigrateDatabase).

begin;

-- 2. Allow an approver-less approval only for AI automation actions.
alter table public.channel_outbound_actions
  drop constraint if exists channel_outbound_actions_approval_shape;
alter table public.channel_outbound_actions
  add constraint channel_outbound_actions_approval_shape check (
    (status = 'PROPOSED' and approved_by is null and approved_at is null)
    or (status <> 'PROPOSED' and approved_at is not null and (
      approved_by is not null
      or (proposed_by = 'AI_ASSIST' and dispatch_source = 'AI_AUTOMATION')
    ))
  );

-- 1 + 2. AUTO proposal: both switches required, no human approver.
create or replace function public.propose_ai_recruiter_message_service(p_workspace_id uuid,p_run_id uuid,p_text_content text,p_part integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_run public.ai_recruiter_runs%rowtype; v_bot public.ai_recruiter_bots%rowtype; v_conversation public.omnichannel_conversations%rowtype;
  v_policy_id uuid; v_action_id uuid; v_recipient text; v_reason text[]:=array[]::text[];
begin
  if p_workspace_id is null or p_run_id is null or p_part<1 or p_part>10 or p_text_content is null or btrim(p_text_content)='' or length(p_text_content)>10000 then return null;end if;
  select * into v_run from public.ai_recruiter_runs where id=p_run_id and workspace_id=p_workspace_id for update;
  if not found or v_run.mode<>'AUTO' or v_run.status not in ('RUNNING','DRAFT_READY','QUEUED') or v_run.proposed_text_parts[p_part] is distinct from p_text_content then return null;end if;
  select * into v_bot from public.ai_recruiter_bots where id=v_run.bot_id and workspace_id=p_workspace_id and enabled;if not found then return null;end if;
  select * into v_conversation from public.omnichannel_conversations where id=v_run.conversation_id and workspace_id=p_workspace_id and status in ('OPEN','PENDING') and takeover_mode='BOT_ALLOWED';if not found then return null;end if;
  -- Both switches, as in enqueue-ai-recruiter.ts. Previously: bot OR conversation.
  if v_bot.mode<>'AUTO' or upper(coalesce(v_conversation.metadata->>'aiRecruiterModeOverride',''))<>'AUTO' then return null;end if;
  if not exists(select 1 from public.ai_recruiter_channel_bindings where workspace_id=p_workspace_id and bot_id=v_bot.id and channel_account_id=v_conversation.channel_account_id and enabled) then return null;end if;
  select sender_external_id into v_recipient from public.omnichannel_messages where workspace_id=p_workspace_id and conversation_id=v_conversation.id and direction='INBOUND' order by received_at desc nulls last,created_at desc limit 1;
  if v_recipient is null or btrim(v_recipient)='' then return null;end if;
  if exists(select 1 from public.channel_suppressions where workspace_id=p_workspace_id and channel_type=v_conversation.channel_type and normalized_recipient=lower(btrim(v_recipient))) then return null;end if;
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,lower(btrim(v_recipient)),true,v_reason,clock_timestamp()+interval '10 minutes') returning id into v_policy_id;
  -- approved_by is NULL: no human approved this message.
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,attachment_ids,approved_by,approved_at,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,v_recipient,'APPROVED',p_text_content,'{}',null,clock_timestamp(),'ai-recruiter:'||p_run_id::text||':part:'||p_part::text,v_policy_id,'AI_ASSIST','AI_AUTOMATION')
    on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id=p_workspace_id and channel_account_id=v_conversation.channel_account_id and idempotency_key='ai-recruiter:'||p_run_id::text||':part:'||p_part::text;end if;
  return v_action_id;
end $$;

revoke all on function public.propose_ai_recruiter_message_service(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.propose_ai_recruiter_message_service(uuid,uuid,text,integer) to service_role;

-- 3. Audit trail for AUTO switches.

-- Returns p_actor only when it is a profile of the workspace, so a bad value can
-- never block the change (audit_logs.actor_id has a workspace-scoped FK).
create or replace function public.ai_recruiter_audit_actor(p_workspace_id uuid,p_actor text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid;
begin
  if p_actor is null or p_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
  v_actor:=p_actor::uuid;
  if exists(select 1 from public.profiles where id=v_actor and workspace_id=p_workspace_id) then return v_actor;end if;
  return null;
end $$;
revoke all on function public.ai_recruiter_audit_actor(uuid,text) from public,anon,authenticated;

alter table public.ai_recruiter_bots add column if not exists mode_change_actor uuid;
comment on column public.ai_recruiter_bots.mode_change_actor is
  'Single-use: the admin changing enabled/mode. Consumed and cleared by ai_recruiter_bots_audit_mode; always NULL at rest.';

create or replace function public.ai_recruiter_bots_audit_mode()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid;
begin
  v_actor:=public.ai_recruiter_audit_actor(new.workspace_id,new.mode_change_actor::text);
  if tg_op='INSERT' then
    if new.mode='AUTO' or new.enabled then
      insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
      values(new.workspace_id,coalesce(v_actor,public.ai_recruiter_audit_actor(new.workspace_id,new.created_by::text)),'AI_RECRUITER_BOT_MODE_CHANGED','AI_RECRUITER_BOT',new.id,
        jsonb_build_object('from',null,'to',jsonb_build_object('enabled',new.enabled,'mode',new.mode),'botType',new.bot_type));
    end if;
  elsif (old.enabled,old.mode) is distinct from (new.enabled,new.mode) then
    insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values(new.workspace_id,v_actor,'AI_RECRUITER_BOT_MODE_CHANGED','AI_RECRUITER_BOT',new.id,
      jsonb_build_object('from',jsonb_build_object('enabled',old.enabled,'mode',old.mode),'to',jsonb_build_object('enabled',new.enabled,'mode',new.mode),'botType',new.bot_type));
  end if;
  new.mode_change_actor:=null;
  return new;
end $$;
revoke all on function public.ai_recruiter_bots_audit_mode() from public,anon,authenticated;

drop trigger if exists ai_recruiter_bots_audit_mode on public.ai_recruiter_bots;
create trigger ai_recruiter_bots_audit_mode
  before insert or update on public.ai_recruiter_bots
  for each row execute function public.ai_recruiter_bots_audit_mode();

create or replace function public.omnichannel_conversations_audit_ai_mode()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_from text; v_to text; v_actor uuid;
begin
  v_from:=old.metadata->>'aiRecruiterModeOverride';
  v_to:=new.metadata->>'aiRecruiterModeOverride';
  v_actor:=public.ai_recruiter_audit_actor(new.workspace_id,new.metadata->>'aiRecruiterModeChangedBy');
  if v_from is distinct from v_to then
    insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
    values(new.workspace_id,v_actor,'AI_RECRUITER_CONVERSATION_MODE_CHANGED','OMNICHANNEL_CONVERSATION',new.id,
      jsonb_build_object('from',v_from,'to',v_to));
  end if;
  new.metadata:=new.metadata-'aiRecruiterModeChangedBy';
  return new;
end $$;
revoke all on function public.omnichannel_conversations_audit_ai_mode() from public,anon,authenticated;

drop trigger if exists omnichannel_conversations_audit_ai_mode on public.omnichannel_conversations;
create trigger omnichannel_conversations_audit_ai_mode
  before update on public.omnichannel_conversations
  for each row
  when (old.metadata->'aiRecruiterModeOverride' is distinct from new.metadata->'aiRecruiterModeOverride'
        or new.metadata ? 'aiRecruiterModeChangedBy')
  execute function public.omnichannel_conversations_audit_ai_mode();

commit;
