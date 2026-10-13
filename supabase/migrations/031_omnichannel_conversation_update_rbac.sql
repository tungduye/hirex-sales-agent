-- A reply-only user may read and send through a granted channel account, but
-- may not change conversation controls or tags through SECURITY DEFINER RPCs.
begin;

create or replace function public.set_omnichannel_conversation_controls(
  p_conversation_id uuid,
  p_status text,
  p_takeover_mode text,
  p_assigned_to uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_channel_account_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null
    or not public.has_workspace_permission('inbox.update')
    or p_status not in ('OPEN','PENDING','RESOLVED','SPAM')
    or p_takeover_mode not in ('BOT_ALLOWED','HUMAN_TAKEOVER') then
    return false;
  end if;

  select c.channel_account_id into v_channel_account_id
  from public.omnichannel_conversations c
  where c.id = p_conversation_id and c.workspace_id = v_workspace_id;
  if v_channel_account_id is null or not public.can_access_channel_account(v_channel_account_id) then
    return false;
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_assigned_to and p.workspace_id = v_workspace_id
  ) then
    return false;
  end if;

  update public.omnichannel_conversations set
    status = p_status, takeover_mode = p_takeover_mode, assigned_to = p_assigned_to
  where id = p_conversation_id and workspace_id = v_workspace_id
    and channel_account_id = v_channel_account_id;
  if not found then return false; end if;

  insert into public.audit_logs(workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values(v_workspace_id, v_actor_id, 'CONVERSATION_CONTROLS_UPDATED', 'OMNICHANNEL_CONVERSATION', p_conversation_id,
    jsonb_build_object('status', p_status, 'takeoverMode', p_takeover_mode, 'assignedTo', p_assigned_to));
  return true;
end $$;

create or replace function public.set_conversation_tag(
  p_conversation_id uuid,
  p_tag_id uuid,
  p_enabled boolean
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid := public.current_workspace_id();
  v_actor_id uuid := auth.uid();
  v_channel_account_id uuid;
begin
  if v_workspace_id is null or v_actor_id is null or p_enabled is null
    or not public.has_workspace_permission('inbox.update') then
    return false;
  end if;

  select c.channel_account_id into v_channel_account_id
  from public.omnichannel_conversations c
  where c.id = p_conversation_id and c.workspace_id = v_workspace_id;
  if v_channel_account_id is null or not public.can_access_channel_account(v_channel_account_id)
    or not exists (
      select 1 from public.conversation_tags t
      where t.id = p_tag_id and t.workspace_id = v_workspace_id
    ) then
    return false;
  end if;

  if p_enabled then
    insert into public.conversation_tag_links(workspace_id, conversation_id, tag_id)
    values(v_workspace_id, p_conversation_id, p_tag_id)
    on conflict(conversation_id, tag_id) do nothing;
  else
    delete from public.conversation_tag_links
    where workspace_id = v_workspace_id and conversation_id = p_conversation_id and tag_id = p_tag_id;
  end if;
  insert into public.audit_logs(workspace_id, actor_id, action, entity_type, entity_id, metadata)
  values(v_workspace_id, v_actor_id, case when p_enabled then 'CONVERSATION_TAG_ADDED' else 'CONVERSATION_TAG_REMOVED' end,
    'OMNICHANNEL_CONVERSATION', p_conversation_id, jsonb_build_object('tagId', p_tag_id));
  return true;
end $$;

revoke all on function public.set_omnichannel_conversation_controls(uuid,text,text,uuid) from public, anon;
revoke all on function public.set_conversation_tag(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_omnichannel_conversation_controls(uuid,text,text,uuid) to authenticated;
grant execute on function public.set_conversation_tag(uuid,uuid,boolean) to authenticated;

commit;
