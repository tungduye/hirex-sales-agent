-- A receipt is not an acknowledgement: interrupted processing must be claimable
-- again, while concurrent callbacks must never acknowledge unfinished work.
alter table public.channel_inbound_events
  add column if not exists processing_token uuid,
  add column if not exists processing_lease_expires_at timestamptz;

create or replace function public.claim_channel_inbound_event(
  p_workspace_id uuid,
  p_channel_account_id uuid,
  p_provider_event_id text,
  p_received_at timestamptz
)
returns table(event_id uuid, claim_token uuid, claim_status text)
language plpgsql security invoker set search_path = '' as $$
declare
  v_event public.channel_inbound_events%rowtype;
  v_token uuid;
begin
  insert into public.channel_inbound_events(
    workspace_id, channel_account_id, provider_event_id, event_type,
    payload_reference, status, received_at
  ) values (
    p_workspace_id, p_channel_account_id, p_provider_event_id, 'MESSAGE',
    'provider-event:' || p_provider_event_id, 'RECEIVED', p_received_at
  ) on conflict (workspace_id, channel_account_id, provider_event_id) do nothing;

  select * into strict v_event from public.channel_inbound_events
  where workspace_id = p_workspace_id and channel_account_id = p_channel_account_id
    and provider_event_id = p_provider_event_id
  for update;

  if v_event.status = 'PROCESSED' then
    return query select v_event.id, null::uuid, 'PROCESSED'::text;
    return;
  end if;
  if v_event.status = 'PROCESSING'
      and v_event.processing_lease_expires_at > clock_timestamp() then
    return query select v_event.id, null::uuid, 'BUSY'::text;
    return;
  end if;

  -- Legacy PROCESSING rows have no lease and are recovered on provider replay.
  v_token := gen_random_uuid();
  update public.channel_inbound_events set status = 'PROCESSING',
    processing_token = v_token,
    processing_lease_expires_at = clock_timestamp() + interval '5 minutes',
    processed_at = null, safe_error_code = null
  where id = v_event.id;
  return query select v_event.id, v_token, 'CLAIMED'::text;
end;
$$;

revoke all on function public.claim_channel_inbound_event(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_channel_inbound_event(uuid,uuid,text,timestamptz)
  to service_role;

-- Replaying a delayed provider event must not move a newer conversation back
-- down the inbox. Enforce this atomically, including concurrent live/recovery
-- writers; leave the separately managed email thread timestamps unchanged.
create or replace function public.preserve_channel_conversation_recency()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.channel_type <> 'EMAIL' and old.last_message_at is not null
      and (new.last_message_at is null or new.last_message_at < old.last_message_at) then
    new.last_message_at := old.last_message_at;
  end if;
  return new;
end;
$$;
drop trigger if exists omnichannel_conversations_preserve_recency on public.omnichannel_conversations;
create trigger omnichannel_conversations_preserve_recency
  before update of last_message_at on public.omnichannel_conversations
  for each row execute function public.preserve_channel_conversation_recency();
