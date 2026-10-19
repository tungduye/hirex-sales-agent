-- 091: reactions (❤️ 👍 ...) on Zalo messages, per nick, copied from Deplao by scripts/sync-zalo-reactions.mjs
-- (service role). The inbox shows them under each message; "mine" = emojis this nick itself added.
begin;
create table if not exists public.zalo_message_reactions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  provider_message_id text not null check (provider_message_id ~ '^[0-9]{1,40}$'),
  summary jsonb not null check (jsonb_typeof(summary) = 'array' and jsonb_array_length(summary) between 1 and 30),
  mine text[] not null default '{}' check (cardinality(mine) <= 30),
  updated_at timestamptz not null default now(),
  primary key (channel_account_id, provider_message_id)
);
alter table public.zalo_message_reactions enable row level security;
create policy zalo_message_reactions_read on public.zalo_message_reactions for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.can_access_channel_account(channel_account_id));
grant select on public.zalo_message_reactions to authenticated;
grant select, insert, update, delete on public.zalo_message_reactions to service_role;
commit;
