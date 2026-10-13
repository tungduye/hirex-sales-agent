do $$
declare
  message_row record;
  target_conversation_id uuid;
  participant_id text;
begin
  for message_row in
    select m.*, c.id as bad_conversation_id, c.workspace_id as conversation_workspace_id,
           c.channel_account_id as conversation_account_id, a.external_account_id as page_id
    from public.omnichannel_messages m
    join public.omnichannel_conversations c on c.id=m.conversation_id and c.workspace_id=m.workspace_id
    join public.channel_accounts a on a.id=c.channel_account_id and a.workspace_id=c.workspace_id
    where c.channel_type='FACEBOOK' and c.provider_conversation_id=a.external_account_id
  loop
    participant_id:=case when message_row.sender_external_id=message_row.page_id then message_row.recipient_external_ids[1] else message_row.sender_external_id end;
    if participant_id is null or btrim(participant_id)='' or participant_id=message_row.page_id then continue; end if;
    select id into target_conversation_id from public.omnichannel_conversations
      where workspace_id=message_row.conversation_workspace_id and channel_account_id=message_row.conversation_account_id
        and channel_type='FACEBOOK' and provider_conversation_id=participant_id limit 1;
    if target_conversation_id is null then
      insert into public.omnichannel_conversations(workspace_id,channel_account_id,channel_type,provider_conversation_id,status,last_message_at,metadata)
      values(message_row.conversation_workspace_id,message_row.conversation_account_id,'FACEBOOK',participant_id,'OPEN',coalesce(message_row.sent_at,message_row.received_at,message_row.created_at),jsonb_build_object('participantExternalId',participant_id))
      returning id into target_conversation_id;
    end if;
    update public.omnichannel_messages set conversation_id=target_conversation_id,
      direction=case when sender_external_id=message_row.page_id then 'OUTBOUND' else direction end,
      sent_at=case when sender_external_id=message_row.page_id then coalesce(sent_at,received_at,created_at) else sent_at end,
      received_at=case when sender_external_id=message_row.page_id then null else received_at end
    where id=message_row.id;
    update public.omnichannel_conversations set last_message_at=greatest(coalesce(last_message_at,'epoch'::timestamptz),coalesce(message_row.sent_at,message_row.received_at,message_row.created_at)) where id=target_conversation_id;
  end loop;
  delete from public.omnichannel_conversations c using public.channel_accounts a
  where c.channel_account_id=a.id and c.workspace_id=a.workspace_id and c.channel_type='FACEBOOK'
    and c.provider_conversation_id=a.external_account_id
    and not exists(select 1 from public.omnichannel_messages m where m.conversation_id=c.id and m.workspace_id=c.workspace_id);
end $$;
