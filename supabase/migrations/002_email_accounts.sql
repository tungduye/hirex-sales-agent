-- HireX Sales Agent - Phase 2A.1 Gmail Foundation
-- Schema preparation only. OAuth, token encryption, mailbox sync, and Gmail API
-- integration are intentionally outside this migration.

begin;

create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  connected_by uuid not null,
  provider text not null,
  email_address text not null,
  display_name text,
  provider_account_id text,
  refresh_token_encrypted text,
  access_token_encrypted text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  status text not null default 'CONNECTED',
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_accounts_connected_by_same_workspace_fk
    foreign key (connected_by, workspace_id)
    references public.profiles (id, workspace_id)
    on delete restrict,
  constraint email_accounts_provider_allowed
    check (provider in ('GMAIL')),
  constraint email_accounts_status_allowed
    check (status in ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR')),
  constraint email_accounts_email_not_blank
    check (btrim(email_address) <> ''),
  constraint email_accounts_display_name_not_blank
    check (display_name is null or btrim(display_name) <> ''),
  constraint email_accounts_provider_account_id_not_blank
    check (provider_account_id is null or btrim(provider_account_id) <> ''),
  constraint email_accounts_refresh_token_ciphertext_not_blank
    check (refresh_token_encrypted is null or btrim(refresh_token_encrypted) <> ''),
  constraint email_accounts_access_token_ciphertext_not_blank
    check (access_token_encrypted is null or btrim(access_token_encrypted) <> ''),
  constraint email_accounts_scopes_have_no_nulls
    check (array_position(scopes, null) is null),
  constraint email_accounts_id_workspace_id_key
    unique (id, workspace_id)
);

comment on column public.email_accounts.refresh_token_encrypted is
  'Encrypted ciphertext only. Encryption and decryption occur in a trusted application-server boundary.';
comment on column public.email_accounts.access_token_encrypted is
  'Encrypted ciphertext only. Encryption and decryption occur in a trusted application-server boundary.';

-- One mailbox identity may be connected only once per provider and workspace.
-- btrim/lower makes email matching insensitive to surrounding whitespace/case.
create unique index email_accounts_workspace_provider_email_unique_idx
  on public.email_accounts (
    workspace_id,
    provider,
    lower(btrim(email_address))
  );

-- Google account IDs are a stronger provider identity when OAuth supplies one.
create unique index email_accounts_workspace_provider_account_unique_idx
  on public.email_accounts (workspace_id, provider, provider_account_id)
  where provider_account_id is not null;

create index email_accounts_workspace_connected_by_idx
  on public.email_accounts (workspace_id, connected_by);

create index email_accounts_workspace_status_idx
  on public.email_accounts (workspace_id, status);

create index email_accounts_workspace_last_sync_idx
  on public.email_accounts (workspace_id, last_sync_at desc)
  where last_sync_at is not null;

create trigger email_accounts_set_updated_at
before update on public.email_accounts
for each row execute function public.set_updated_at();

alter table public.email_accounts enable row level security;

create policy email_accounts_select_workspace
on public.email_accounts
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

create policy email_accounts_insert_workspace
on public.email_accounts
for insert
to authenticated
with check (
  workspace_id = (select public.current_workspace_id())
  and connected_by = (select auth.uid())
);

create policy email_accounts_update_workspace
on public.email_accounts
for update
to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and connected_by = (select auth.uid())
)
with check (
  workspace_id = (select public.current_workspace_id())
  and connected_by = (select auth.uid())
);

create policy email_accounts_delete_workspace
on public.email_accounts
for delete
to authenticated
using (
  workspace_id = (select public.current_workspace_id())
  and connected_by = (select auth.uid())
);

-- Supabase grants table privileges separately from RLS. Keep token ciphertext
-- unreadable to the normal authenticated role even for rows allowed by RLS.
-- Authenticated application clients receive metadata read access only.
-- Credential writes require the reviewed server-only OAuth credential boundary
-- implemented in a later phase.
-- Mutation policies remain as defense-in-depth, but PostgreSQL grants below do
-- not give authenticated application clients mutation privileges.
revoke all on table public.email_accounts from public;
revoke all on table public.email_accounts from anon;
revoke select, insert, update, delete on table public.email_accounts from authenticated;

grant select (
  id,
  workspace_id,
  connected_by,
  provider,
  email_address,
  display_name,
  provider_account_id,
  access_token_expires_at,
  scopes,
  status,
  last_sync_at,
  last_sync_error,
  created_at,
  updated_at
) on public.email_accounts to authenticated;

commit;
