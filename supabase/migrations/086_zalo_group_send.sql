-- 086: real sending into Zalo group chats.
-- A manual reply in a Zalo group is now addressed to the group (provider conversation id) instead of
-- the last member who wrote, and the Zalo bridge sends it with thread type GROUP. One-to-one chats keep
-- their recipient, except that Zalo's own notices (sender "system") can no longer be picked as it.
begin;

-- One definition of "Zalo group chat", shared by sending and the inbox: flagged by the history sync
-- (metadata conversationKind/threadType GROUP, isGroup, groupName) or someone other than the thread
-- itself has written in it (Zalo's "system" notices do not count).
create or replace function public.is_zalo_group_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.omnichannel_conversations c
    where c.id = p_conversation_id and c.channel_type = 'ZALO'
      -- Members only learn about their own workspace; the server (no signed-in user) sees all.
      and ((select auth.uid()) is null or c.workspace_id = public.current_workspace_id())
      and (upper(coalesce(c.metadata->>'conversationKind', '')) = 'GROUP'
        or upper(coalesce(c.metadata->>'threadType', '')) = 'GROUP'
        or coalesce(c.metadata->>'isGroup', '') = 'true'
        or jsonb_typeof(c.metadata->'groupName') = 'string'
        or exists(
          select 1 from public.omnichannel_messages m
          where m.workspace_id = c.workspace_id and m.conversation_id = c.id and m.direction = 'INBOUND'
            and m.sender_external_id is distinct from c.provider_conversation_id
            and m.sender_external_id is distinct from 'system')));
$$;
revoke all on function public.is_zalo_group_conversation(uuid) from public;
grant execute on function public.is_zalo_group_conversation(uuid) to authenticated, service_role;

create or replace function public.propose_channel_message(
  p_conversation_id uuid, p_text_content text, p_idempotency_key text, p_proposed_by text default 'HUMAN'
) returns uuid language plpgsql security definer set search_path='' as $$
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
    or p_proposed_by not in ('HUMAN','AI_ASSIST')
    or not public.has_workspace_permission(case when p_proposed_by='HUMAN' then 'inbox.reply' else 'channels.manage' end)
  then return null; end if;
  v_dispatch_source := case when p_proposed_by='HUMAN' then 'HUMAN_MANUAL' else 'AI_AUTOMATION' end;
  select * into v_conversation from public.omnichannel_conversations
    where id=p_conversation_id and workspace_id=v_workspace_id and status in ('OPEN','PENDING','RESOLVED') for update;
  if not found or not public.can_access_channel_account(v_conversation.channel_account_id) then return null; end if;
  -- A Zalo group is addressed as the group itself; a one-to-one chat as the last person who wrote.
  -- Zalo's own notices (sender "system") are never a recipient.
  if public.is_zalo_group_conversation(v_conversation.id) then
    v_recipient := v_conversation.provider_conversation_id;
  else
    select sender_external_id into v_recipient from public.omnichannel_messages
      where workspace_id=v_workspace_id and conversation_id=v_conversation.id and direction='INBOUND'
        and sender_external_id is distinct from 'system'
      order by received_at desc nulls last,created_at desc limit 1;
  end if;
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

create or replace function public.get_inbox_zalo_group_ids(p_conversation_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = public
as $$
  select c.id
  from public.omnichannel_conversations c
  where c.id = any(p_conversation_ids)
    and c.workspace_id = public.current_workspace_id()
    and c.channel_type = 'ZALO'
    and public.is_zalo_group_conversation(c.id);
$$;
revoke all on function public.get_inbox_zalo_group_ids(uuid[]) from public;
grant execute on function public.get_inbox_zalo_group_ids(uuid[]) to authenticated;
commit;
