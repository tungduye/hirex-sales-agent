-- 094: a person's Zalo file reply is proposed in one step, already as "this one file, no text".
-- Replaces 093's two-step version (proposal with a stand-in text, then the file attached), which refused
-- every file on the live database. A proposal row never holds the stand-in text any more.
begin;

drop function if exists public.attach_file_to_zalo_reply(uuid,uuid);

-- Stand-in proposals left by the first attempt ("📎 <file name>", no file): removed so nobody approves the
-- stand-in text by mistake. They were never approved or sent.
delete from public.channel_outbound_actions
  where status='PROPOSED' and channel_type='ZALO' and dispatch_source='HUMAN_MANUAL' and proposed_by='HUMAN'
    and approved_by is null and cardinality(attachment_ids)=0 and text_content like '📎 %'
    and created_at >= timestamptz '2026-10-19 00:00:00+07';

create or replace function public.propose_zalo_file_reply(p_conversation_id uuid, p_attachment_id uuid, p_idempotency_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_conversation public.omnichannel_conversations%rowtype;
  v_recipient text;
  v_allowed boolean;
  v_policy_id uuid;
  v_action_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_conversation_id is null or p_attachment_id is null
    or p_idempotency_key is null or btrim(p_idempotency_key)='' or length(p_idempotency_key)>256
    or not public.has_workspace_permission('inbox.reply') then return null; end if;
  select * into v_conversation from public.omnichannel_conversations
    where id=p_conversation_id and workspace_id=v_workspace_id and channel_type='ZALO' and status in ('OPEN','PENDING','RESOLVED') for update;
  if not found or not public.can_access_channel_account(v_conversation.channel_account_id) then return null; end if;
  -- A file this member uploaded for a reply; sent at most once (again only after a definite failure).
  if not exists(select 1 from public.channel_attachments where id=p_attachment_id and workspace_id=v_workspace_id
      and source='HUMAN_UPLOAD' and created_by=v_actor_id and storage_bucket='channel-attachments' and size_bytes between 1 and 26214400)
    or exists(select 1 from public.channel_outbound_actions where workspace_id=v_workspace_id and p_attachment_id=any(attachment_ids)
      and status not in ('FAILED','CANCELLED'))
  then return null; end if;
  -- Same addressing as a text reply (migration 086): a group as itself, a one-to-one chat as the last person who wrote.
  if public.is_zalo_group_conversation(v_conversation.id) then
    v_recipient := v_conversation.provider_conversation_id;
  else
    select sender_external_id into v_recipient from public.omnichannel_messages
      where workspace_id=v_workspace_id and conversation_id=v_conversation.id and direction='INBOUND'
        and sender_external_id is distinct from 'system'
      order by received_at desc nulls last, created_at desc limit 1;
  end if;
  if v_recipient is null or btrim(v_recipient)='' then return null; end if;
  v_allowed := exists(select 1 from public.channel_accounts where id=v_conversation.channel_account_id
      and workspace_id=v_workspace_id and status='CONNECTED' and channel_type='ZALO')
    and not exists(select 1 from public.channel_suppressions where workspace_id=v_workspace_id
      and channel_type='ZALO' and lower(btrim(normalized_recipient))=lower(btrim(v_recipient)));
  insert into public.channel_policy_decisions(workspace_id,conversation_id,channel_account_id,channel_type,normalized_recipient,allowed,reason_codes,expires_at)
  values(v_workspace_id,v_conversation.id,v_conversation.channel_account_id,'ZALO',lower(btrim(v_recipient)),v_allowed,
    case when v_allowed then '{}'::text[] else array['ACCOUNT_OR_SUPPRESSION_BLOCK']::text[] end,clock_timestamp()+interval '10 minutes')
  returning id into v_policy_id;
  if not v_allowed then return null; end if;
  insert into public.channel_outbound_actions(workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,text_content,
    attachment_ids,idempotency_key,policy_decision_id,proposed_by,dispatch_source)
  values(v_workspace_id,v_conversation.id,v_conversation.channel_account_id,'ZALO',v_recipient,null,
    array[p_attachment_id],p_idempotency_key,v_policy_id,'HUMAN','HUMAN_MANUAL')
  on conflict(workspace_id,channel_account_id,idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then return null; end if;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_workspace_id,v_actor_id,'CHANNEL_MESSAGE_PROPOSED','CHANNEL_OUTBOUND_ACTION',v_action_id,
    jsonb_build_object('proposedBy','HUMAN','dispatchSource','HUMAN_MANUAL','attachmentId',p_attachment_id));
  return v_action_id;
end $$;
revoke all on function public.propose_zalo_file_reply(uuid,uuid,text) from public, anon;
grant execute on function public.propose_zalo_file_reply(uuid,uuid,text) to authenticated;

commit;
