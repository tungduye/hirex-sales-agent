-- HireX Sales Agent - Phase 2A.3D resumable full initial Gmail sync state.
-- Execution remains a reviewed server-only boundary; this migration does not
-- run Gmail sync or expose opaque checkpoints to authenticated clients.

begin;

create table public.email_sync_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email_account_id uuid not null,
  sync_type text not null,
  status text not null default 'NOT_STARTED',
  next_page_token text,
  initial_history_id text,
  batch_lock_id uuid,
  batch_lock_at timestamptz,
  processed_messages integer not null default 0,
  synced_messages integer not null default 0,
  skipped_messages integer not null default 0,
  failed_messages integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_batch_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_sync_states_account_same_workspace_fk
    foreign key (email_account_id, workspace_id)
    references public.email_accounts (id, workspace_id)
    on delete cascade,
  constraint email_sync_states_sync_type_allowed check (sync_type in ('INITIAL')),
  constraint email_sync_states_status_allowed
    check (status in ('NOT_STARTED', 'RUNNING', 'COMPLETED', 'FAILED')),
  constraint email_sync_states_next_page_token_not_blank
    check (next_page_token is null or btrim(next_page_token) <> ''),
  constraint email_sync_states_initial_history_id_not_blank
    check (initial_history_id is null or btrim(initial_history_id) <> ''),
  constraint email_sync_states_safe_error_code_not_blank
    check (safe_error_code is null or btrim(safe_error_code) <> ''),
  constraint email_sync_states_batch_lock_shape check (
    (batch_lock_id is null and batch_lock_at is null)
    or (batch_lock_id is not null and batch_lock_at is not null)
  ),
  constraint email_sync_states_counters_nonnegative check (
    processed_messages >= 0 and synced_messages >= 0
    and skipped_messages >= 0 and failed_messages >= 0
  ),
  constraint email_sync_states_counter_total_valid check (
    synced_messages + skipped_messages + failed_messages <= processed_messages
  ),
  constraint email_sync_states_completion_shape check (
    status <> 'COMPLETED'
    or (completed_at is not null and next_page_token is null and initial_history_id is not null)
  ),
  constraint email_sync_states_id_account_workspace_key
    unique (id, email_account_id, workspace_id),
  constraint email_sync_states_account_type_key
    unique (email_account_id, workspace_id, sync_type)
);

comment on column public.email_sync_states.next_page_token is
  'Opaque Gmail messages.list page token. Server-only; never accept it from a browser.';
comment on column public.email_sync_states.initial_history_id is
  'History anchor from the newest message on the first page. Published to the account only after full initial sync completes.';
comment on table public.email_sync_states is
  'Authenticated application clients receive workspace-scoped progress metadata read access only. Checkpoint and counter mutations require the reviewed server-only Gmail sync boundary.';

create index email_sync_states_workspace_status_idx
  on public.email_sync_states (workspace_id, status);
create index email_sync_states_workspace_updated_idx
  on public.email_sync_states (workspace_id, updated_at desc);

create trigger email_sync_states_set_updated_at
before update on public.email_sync_states
for each row execute function public.set_updated_at();

alter table public.email_sync_states enable row level security;

create policy email_sync_states_select_workspace
on public.email_sync_states
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

revoke all on table public.email_sync_states from public;
revoke all on table public.email_sync_states from anon;
revoke all on table public.email_sync_states from authenticated;

-- Opaque page/history checkpoints are intentionally excluded.
grant select (
  id, workspace_id, email_account_id, sync_type, status,
  processed_messages, synced_messages, skipped_messages, failed_messages,
  started_at, completed_at, last_batch_at, safe_error_code,
  created_at, updated_at
) on public.email_sync_states to authenticated;

-- Atomically publishes the initial History anchor and checkpoints the final
-- successfully processed page. Only the reviewed server credential boundary
-- may execute this function; browser roles receive no execution privilege.
create or replace function public.finalize_initial_email_sync(
  p_state_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_batch_lock_id uuid,
  p_processed_messages integer,
  p_synced_messages integer,
  p_skipped_messages integer,
  p_failed_messages integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial_history_id text;
  v_finalized_at timestamptz := clock_timestamp();
begin
  if p_processed_messages < 0 or p_synced_messages < 0
    or p_skipped_messages < 0 or p_failed_messages < 0
    or p_synced_messages + p_skipped_messages + p_failed_messages <> p_processed_messages
    or p_failed_messages <> 0 then
    raise exception 'Invalid final sync counters';
  end if;

  select initial_history_id
    into v_initial_history_id
  from public.email_sync_states
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and sync_type = 'INITIAL'
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id
    and initial_history_id is not null
  for update;

  if not found then
    return false;
  end if;

  update public.email_accounts
  set provider_history_id = v_initial_history_id,
      last_sync_at = v_finalized_at,
      last_sync_error = null
  where id = p_email_account_id
    and workspace_id = p_workspace_id
    and provider = 'GMAIL';

  if not found then
    raise exception 'Email account not found for initial sync finalization';
  end if;

  update public.email_sync_states
  set status = 'COMPLETED',
      next_page_token = null,
      processed_messages = processed_messages + p_processed_messages,
      synced_messages = synced_messages + p_synced_messages,
      skipped_messages = skipped_messages + p_skipped_messages,
      failed_messages = failed_messages + p_failed_messages,
      last_batch_at = v_finalized_at,
      completed_at = v_finalized_at,
      safe_error_code = null,
      batch_lock_id = null,
      batch_lock_at = null
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and sync_type = 'INITIAL'
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id;

  if not found then
    raise exception 'Initial sync state changed during finalization';
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_initial_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer) from public;
revoke all on function public.finalize_initial_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer) from anon;
revoke all on function public.finalize_initial_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer) from authenticated;
grant execute on function public.finalize_initial_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer) to service_role;

commit;
