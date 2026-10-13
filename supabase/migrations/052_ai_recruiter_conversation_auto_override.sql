begin;

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
  if v_bot.mode<>'AUTO' and upper(coalesce(v_conversation.metadata->>'aiRecruiterModeOverride',''))<>'AUTO' then return null;end if;
  if not exists(select 1 from public.ai_recruiter_channel_bindings where workspace_id=p_workspace_id and bot_id=v_bot.id and channel_account_id=v_conversation.channel_account_id and enabled) then return null;end if;
  select sender_external_id into v_recipient from public.omnichannel_messages where workspace_id=p_workspace_id and conversation_id=v_conversation.id and direction='INBOUND' order by received_at desc nulls last,created_at desc limit 1;
  if v_recipient is null or btrim(v_recipient)='' then return null;end if;
  if exists(select 1 from public.channel_suppressions where workspace_id=p_workspace_id and channel_type=v_conversation.channel_type and normalized_recipient=lower(btrim(v_recipient))) then return null;end if;
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,lower(btrim(v_recipient)),true,v_reason,clock_timestamp()+interval '10 minutes') returning id into v_policy_id;
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,attachment_ids,approved_by,approved_at,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
    values(p_workspace_id,v_conversation.id,v_conversation.channel_account_id,v_conversation.channel_type,v_recipient,'APPROVED',p_text_content,'{}',v_bot.created_by,clock_timestamp(),'ai-recruiter:'||p_run_id::text||':part:'||p_part::text,v_policy_id,'AI_ASSIST','AI_AUTOMATION')
    on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then select id into v_action_id from public.channel_outbound_actions where workspace_id=p_workspace_id and channel_account_id=v_conversation.channel_account_id and idempotency_key='ai-recruiter:'||p_run_id::text||':part:'||p_part::text;end if;
  return v_action_id;
end $$;

revoke all on function public.propose_ai_recruiter_message_service(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.propose_ai_recruiter_message_service(uuid,uuid,text,integer) to service_role;

commit;
