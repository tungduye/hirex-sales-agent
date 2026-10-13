-- Attribute inbound replies to the most recently sent matching channel campaign
-- and close campaigns once no active recipient remains.

create or replace function public.mark_channel_campaign_reply(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_contact_id uuid,
  p_source_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
begin
  if p_workspace_id is null or p_campaign_id is null or p_contact_id is null or p_source_message_id is null then
    return false;
  end if;
  if not exists (
    select 1 from public.omnichannel_messages message
    where message.id = p_source_message_id
      and message.workspace_id = p_workspace_id
      and message.direction = 'INBOUND'
  ) then
    return false;
  end if;

  update public.channel_campaign_recipients
  set status = 'REPLIED', stop_reason = 'REPLIED', replied_at = clock_timestamp(),
      source_message_id = p_source_message_id, next_step_at = null
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and contact_id = p_contact_id
    and status in ('ACTIVE', 'COMPLETED')
  returning id into v_recipient_id;

  if v_recipient_id is null then
    return exists (
      select 1 from public.channel_campaign_recipients recipient
      where recipient.workspace_id = p_workspace_id
        and recipient.campaign_id = p_campaign_id
        and recipient.contact_id = p_contact_id
        and recipient.status = 'REPLIED'
    );
  end if;

  update public.channel_campaign_recipient_steps
  set status = 'STOPPED', completed_at = clock_timestamp(), safe_error_code = 'RECIPIENT_REPLIED'
  where workspace_id = p_workspace_id
    and campaign_id = p_campaign_id
    and recipient_id = v_recipient_id
    and status = 'PENDING';

  insert into public.channel_campaign_events(workspace_id, campaign_id, recipient_id, event_type, metadata)
  values (p_workspace_id, p_campaign_id, v_recipient_id, 'REPLIED', jsonb_build_object('sourceMessageId', p_source_message_id));
  return true;
end;
$$;

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
  where message.id = p_message_id and message.direction = 'INBOUND';

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

create or replace function public.attribute_channel_campaign_reply_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'INBOUND' then
    perform public.attribute_latest_channel_campaign_reply(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists attribute_channel_campaign_reply on public.omnichannel_messages;
create trigger attribute_channel_campaign_reply
after insert on public.omnichannel_messages
for each row execute function public.attribute_channel_campaign_reply_on_message();

create or replace function public.complete_channel_campaign_when_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'ACTIVE' and old.status is distinct from new.status then
    with completed as (
      update public.channel_campaigns campaign
      set status = 'COMPLETED', completed_at = clock_timestamp()
      where campaign.id = new.campaign_id
        and campaign.workspace_id = new.workspace_id
        and campaign.status = 'RUNNING'
        and not exists (
          select 1 from public.channel_campaign_recipients recipient
          where recipient.workspace_id = new.workspace_id
            and recipient.campaign_id = new.campaign_id
            and recipient.status = 'ACTIVE'
        )
      returning campaign.id
    )
    insert into public.channel_campaign_events(workspace_id, campaign_id, event_type)
    select new.workspace_id, completed.id, 'COMPLETED' from completed;
  end if;
  return new;
end;
$$;

drop trigger if exists complete_channel_campaign_when_terminal on public.channel_campaign_recipients;
create trigger complete_channel_campaign_when_terminal
after update of status on public.channel_campaign_recipients
for each row execute function public.complete_channel_campaign_when_terminal();

revoke all on function public.attribute_latest_channel_campaign_reply(uuid) from public, anon, authenticated;
revoke all on function public.attribute_channel_campaign_reply_on_message() from public, anon, authenticated;
revoke all on function public.complete_channel_campaign_when_terminal() from public, anon, authenticated;
grant execute on function public.attribute_latest_channel_campaign_reply(uuid) to service_role;
