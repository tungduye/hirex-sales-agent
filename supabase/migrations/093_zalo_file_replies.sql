-- 093: a person's Zalo reply may be one file they uploaded in HireX (picture, CV, document...).
-- The reply is proposed like a text reply, then turned into "this one file, no text" before approval:
-- only by a member who may reply and use the nick, only with a file that member uploaded, and each
-- upload is sent at most once (it can be tried again only after a definite failure). The file itself never leaves storage except through the sender.
begin;

create or replace function public.attach_file_to_zalo_reply(p_action_id uuid, p_attachment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_action public.channel_outbound_actions%rowtype;
begin
  if v_workspace_id is null or v_actor_id is null or p_action_id is null or p_attachment_id is null
    or not public.has_workspace_permission('inbox.reply') then return false; end if;
  select * into v_action from public.channel_outbound_actions
    where id=p_action_id and workspace_id=v_workspace_id and status='PROPOSED' and channel_type='ZALO'
      and dispatch_source='HUMAN_MANUAL' and proposed_by='HUMAN' and approved_by is null
      and cardinality(attachment_ids)=0 and conversation_id is not null
    for update;
  if not found or not public.can_access_channel_account(v_action.channel_account_id) then return false; end if;
  -- The member proposed this reply themselves.
  if not exists(select 1 from public.audit_logs where workspace_id=v_workspace_id and entity_id=p_action_id
      and action='CHANNEL_MESSAGE_PROPOSED' and actor_id=v_actor_id) then return false; end if;
  -- A file this member uploaded for a reply, never sent before.
  if not exists(select 1 from public.channel_attachments where id=p_attachment_id and workspace_id=v_workspace_id
      and source='HUMAN_UPLOAD' and created_by=v_actor_id and storage_bucket='channel-attachments'
      and size_bytes between 1 and 26214400)
    or exists(select 1 from public.channel_outbound_actions where workspace_id=v_workspace_id and p_attachment_id=any(attachment_ids)
      and status not in ('FAILED','CANCELLED'))
  then return false; end if;
  update public.channel_outbound_actions
    set attachment_ids=array[p_attachment_id], text_content=null, mentions=null, quote_message_id=null
    where id=p_action_id and workspace_id=v_workspace_id;
  insert into public.audit_logs(workspace_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_workspace_id,v_actor_id,'CHANNEL_MESSAGE_FILE_ATTACHED','CHANNEL_OUTBOUND_ACTION',p_action_id,
    jsonb_build_object('attachmentId',p_attachment_id));
  return true;
end $$;
revoke all on function public.attach_file_to_zalo_reply(uuid,uuid) from public, anon;
grant execute on function public.attach_file_to_zalo_reply(uuid,uuid) to authenticated;

commit;
