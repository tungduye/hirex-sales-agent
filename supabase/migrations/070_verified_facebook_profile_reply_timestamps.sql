-- Do not attribute a backfilled Facebook Profile message to a campaign when
-- the bridge could not read the provider's original timestamp. Such messages
-- remain visible in the inbox, but sync time is not evidence of a campaign reply.
create or replace function public.attribute_latest_channel_campaign_reply(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message record;
  v_campaign_id uuid;
begin
  select message.workspace_id, message.channel_account_id, message.received_at,
         conversation.contact_id
  into v_message
  from public.omnichannel_messages message
  join public.omnichannel_conversations conversation
    on conversation.id = message.conversation_id
   and conversation.workspace_id = message.workspace_id
  where message.id = p_message_id
    and message.direction = 'INBOUND'
    and message.metadata->>'occurredAtVerified' is distinct from 'false';

  if not found or v_message.contact_id is null then return false; end if;

  select campaign.id
  into v_campaign_id
  from public.channel_campaigns campaign
  join public.channel_campaign_recipients recipient
    on recipient.campaign_id = campaign.id and recipient.workspace_id = campaign.workspace_id
  join public.channel_campaign_recipient_steps recipient_step
    on recipient_step.recipient_id = recipient.id
   and recipient_step.campaign_id = campaign.id
   and recipient_step.workspace_id = campaign.workspace_id
  where campaign.workspace_id = v_message.workspace_id
    and campaign.stop_on_reply = true
    and campaign.status in ('RUNNING', 'COMPLETED')
    and recipient.contact_id = v_message.contact_id
    and recipient.status in ('ACTIVE', 'COMPLETED', 'REPLIED')
    and recipient_step.channel_account_id = v_message.channel_account_id
    and recipient_step.status = 'SENT'
    and recipient_step.completed_at <= v_message.received_at
  order by recipient_step.completed_at desc, campaign.started_at desc
  limit 1;

  if v_campaign_id is null then return false; end if;
  return public.mark_channel_campaign_reply(v_message.workspace_id, v_campaign_id, v_message.contact_id, p_message_id);
end;
$$;

revoke all on function public.attribute_latest_channel_campaign_reply(uuid) from public, anon, authenticated;
grant execute on function public.attribute_latest_channel_campaign_reply(uuid) to service_role;
