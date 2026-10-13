create or replace function public.update_inbox_conversation_preference(
  p_conversation_id uuid, p_action text
) returns boolean language plpgsql security definer set search_path='' as $$
declare v public.omnichannel_conversations%rowtype; v_meta jsonb;
begin
  select * into v from public.omnichannel_conversations
  where id=p_conversation_id and workspace_id=public.current_workspace_id() for update;
  if not found or not public.has_workspace_permission('inbox.update')
    or not public.can_access_channel_account(v.channel_account_id) then return false; end if;
  v_meta:=coalesce(v.metadata,'{}'::jsonb);
  if p_action='MARK_READ' then update public.omnichannel_conversations set unread_count=0 where id=v.id;
  elsif p_action='MARK_UNREAD' then update public.omnichannel_conversations set unread_count=greatest(unread_count,1) where id=v.id;
  elsif p_action='TOGGLE_MUTE' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{muted}',to_jsonb(not coalesce((v_meta->>'muted')::boolean,false))) where id=v.id;
  elsif p_action='TOGGLE_PIN' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{appPinned}',to_jsonb(not coalesce((v_meta->>'appPinned')::boolean,false))) where id=v.id;
  elsif p_action='TOGGLE_OTHER' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{folder}',to_jsonb(case when v_meta->>'folder'='OTHER' then 'PRIMARY' else 'OTHER' end)) where id=v.id;
  elsif p_action='SOFT_DELETE' then update public.omnichannel_conversations set metadata=jsonb_set(v_meta,'{hidden}', 'true'::jsonb) where id=v.id;
  else return false; end if;
  return true;
end $$;
revoke all on function public.update_inbox_conversation_preference(uuid,text) from public,anon;
grant execute on function public.update_inbox_conversation_preference(uuid,text) to authenticated;
