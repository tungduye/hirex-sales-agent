-- Preserve historical conversations/messages while replacing legacy QA labels
-- with account-scoped provider IDs. A verified provider profile can later
-- replace these ID fallbacks without overwriting operator-entered names.
update public.contacts as contact
set full_name = 'Zalo ' || channel.channel_value
from public.contact_channels as channel
where channel.contact_id = contact.id
  and channel.workspace_id = contact.workspace_id
  and channel.channel_type = 'ZALO'
  and not exists (
    select 1 from public.contact_channels as other
    where other.contact_id = contact.id and other.workspace_id = contact.workspace_id
      and other.channel_type = 'ZALO' and other.id <> channel.id
  )
  and contact.full_name = 'Zalo contact';

update public.channel_accounts
set display_name = 'Zalo ' || external_account_id
where channel_type = 'ZALO'
  and display_name = 'HireX QA zalo';

create function public.keep_zalo_conversation_latest_message()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.channel_type = 'ZALO' and old.last_message_at is not null and
     (new.last_message_at is null or new.last_message_at < old.last_message_at) then
    new.last_message_at := old.last_message_at;
  end if;
  return new;
end;
$$;
create trigger keep_zalo_conversation_latest_message
before update on public.omnichannel_conversations
for each row execute function public.keep_zalo_conversation_latest_message();
revoke all on function public.keep_zalo_conversation_latest_message() from public, anon, authenticated;

create function public.count_zalo_inbound_message()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.channel_type = 'ZALO' and new.direction = 'INBOUND' then
    update public.omnichannel_conversations
    set unread_count = unread_count + 1,
        last_message_at = greatest(last_message_at, new.received_at)
    where id = new.conversation_id and workspace_id = new.workspace_id
      and channel_account_id = new.channel_account_id;
  end if;
  return new;
end;
$$;
create trigger count_zalo_inbound_message
after insert on public.omnichannel_messages
for each row execute function public.count_zalo_inbound_message();
revoke all on function public.count_zalo_inbound_message() from public, anon, authenticated;

-- Existing workspace RLS policies and authenticated SELECT grants remain the
-- authorization boundary for Postgres Changes subscribers.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'omnichannel_messages'
  ) then
    alter publication supabase_realtime add table public.omnichannel_messages;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'omnichannel_conversations'
  ) then
    alter publication supabase_realtime add table public.omnichannel_conversations;
  end if;
end;
$$;
