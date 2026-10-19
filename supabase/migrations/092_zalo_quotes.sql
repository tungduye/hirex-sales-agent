-- 092: Zalo reply-quotes.
--  * A person's reply may quote one earlier message of the same chat (quote_message_id = its Zalo msg id),
--    written by the server after checking the message belongs to the conversation.
--  * zalo_message_quotes: which message each Zalo message quoted, per nick, copied from Deplao by
--    scripts/sync-zalo-reactions.mjs (service role), so the inbox can show the quoted line above a reply.
begin;
alter table public.channel_outbound_actions add column if not exists quote_message_id text;
alter table public.channel_outbound_actions drop constraint if exists channel_outbound_actions_quote_shape;
alter table public.channel_outbound_actions add constraint channel_outbound_actions_quote_shape check (
  quote_message_id is null or (quote_message_id ~ '^[1-9][0-9]{0,39}$' and channel_type = 'ZALO' and dispatch_source = 'HUMAN_MANUAL'));

create table if not exists public.zalo_message_quotes (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  provider_message_id text not null check (provider_message_id ~ '^[0-9]{1,40}$'),
  quoted_message_id text check (quoted_message_id is null or quoted_message_id ~ '^[0-9]{1,40}$'),
  quoted_text text not null check (length(quoted_text) <= 500),
  quoted_sender text check (quoted_sender is null or length(quoted_sender) <= 255),
  updated_at timestamptz not null default now(),
  primary key (channel_account_id, provider_message_id)
);
alter table public.zalo_message_quotes enable row level security;
create policy zalo_message_quotes_read on public.zalo_message_quotes for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.can_access_channel_account(channel_account_id));
grant select on public.zalo_message_quotes to authenticated;
grant select, insert, update, delete on public.zalo_message_quotes to service_role;
commit;
