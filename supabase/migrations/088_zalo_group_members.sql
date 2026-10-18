-- 088: names and avatars of Zalo group members, per nick (Zalo gives each nick its own ids).
-- Filled from Deplao's own member list by scripts/sync-zalo-group-members.mjs (service role).
-- The inbox uses it to show who wrote each group message and to highlight @mentions.
begin;
create table if not exists public.zalo_group_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  group_id text not null check (group_id ~ '^[0-9]{1,40}$'),
  member_id text not null check (member_id ~ '^[0-9]{1,40}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 255),
  avatar_url text check (avatar_url is null or (length(avatar_url) <= 2048 and avatar_url ~ '^https?://')),
  role smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_account_id, group_id, member_id)
);
create index if not exists zalo_group_members_group_idx on public.zalo_group_members(workspace_id, channel_account_id, group_id);
alter table public.zalo_group_members enable row level security;
-- Members see the groups of nicks they may use; nobody writes from the app.
create policy zalo_group_members_read on public.zalo_group_members for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.can_access_channel_account(channel_account_id));
grant select on public.zalo_group_members to authenticated;
grant select, insert, update, delete on public.zalo_group_members to service_role;
commit;
