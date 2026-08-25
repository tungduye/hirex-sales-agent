-- HireX Sales Agent - Phase 2A.4A Gmail incremental History sync state.
-- Schema foundation only: this migration does not call Gmail, process History
-- records, reset Initial sync, or mutate mailbox data.

begin;

create table public.email_incremental_sync_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email_account_id uuid not null,
  status text not null,
  start_history_id text not null,
  next_page_token text,
  target_history_id text,
  processed_history_records integer not null default 0,
  affected_message_count integer not null default 0,
  synced_message_count integer not null default 0,
  deleted_message_count integer not null default 0,
  failed_message_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_batch_at timestamptz,
  safe_error_code text,
  batch_lock_id uuid,
  batch_lock_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_incremental_sync_states_account_same_workspace_fk
    foreign key (email_account_id, workspace_id)
    references public.email_accounts (id, workspace_id)
    on delete cascade,
  constraint email_incremental_sync_states_status_allowed
    check (status in ('RUNNING', 'FAILED', 'COMPLETED')),
  constraint email_incremental_sync_states_start_history_id_not_blank
    check (btrim(start_history_id) <> ''),
  constraint email_incremental_sync_states_target_history_id_not_blank
    check (target_history_id is null or btrim(target_history_id) <> ''),
  constraint email_incremental_sync_states_next_page_token_not_blank
    check (next_page_token is null or btrim(next_page_token) <> ''),
  constraint email_incremental_sync_states_safe_error_code_not_blank
    check (safe_error_code is null or btrim(safe_error_code) <> ''),
  constraint email_incremental_sync_states_counters_nonnegative check (
    processed_history_records >= 0
    and affected_message_count >= 0
    and synced_message_count >= 0
    and deleted_message_count >= 0
    and failed_message_count >= 0
  ),
  constraint email_incremental_sync_states_batch_lock_shape check (
    (batch_lock_id is null and batch_lock_at is null)
    or (batch_lock_id is not null and batch_lock_at is not null)
  ),
  constraint email_incremental_sync_states_completed_shape check (
    status <> 'COMPLETED'
    or (
      completed_at is not null
      and next_page_token is null
      and target_history_id is not null
      and batch_lock_id is null
      and batch_lock_at is null
    )
  ),
  constraint email_incremental_sync_states_workspace_account_key
    unique (workspace_id, email_account_id)
);

comment on table public.email_incremental_sync_states is
  'One reusable incremental History sync state per Gmail account. A later reviewed server-only boundary may reset a COMPLETED row for the next run; concurrent rows are prohibited.';
comment on column public.email_incremental_sync_states.start_history_id is
  'Opaque account provider_history_id captured when an incremental run starts. Keep as text.';
comment on column public.email_incremental_sync_states.target_history_id is
  'Opaque Gmail History cursor to publish only after pagination completes. Keep as text.';
comment on column public.email_incremental_sync_states.next_page_token is
  'Opaque Gmail History page token. Server-only; never accept from or expose to a browser.';
comment on column public.email_incremental_sync_states.safe_error_code is
  'Safe application category only. HISTORY_ID_EXPIRED signals that Gmail returned 404 and a reviewed full-resync flow is required.';

create index email_incremental_sync_states_workspace_status_idx
  on public.email_incremental_sync_states (workspace_id, status);
create index email_incremental_sync_states_workspace_updated_idx
  on public.email_incremental_sync_states (workspace_id, updated_at desc);

create trigger email_incremental_sync_states_set_updated_at
before update on public.email_incremental_sync_states
for each row execute function public.set_updated_at();

alter table public.email_incremental_sync_states enable row level security;

create policy email_incremental_sync_states_select_workspace
on public.email_incremental_sync_states
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

revoke all on table public.email_incremental_sync_states from public;
revoke all on table public.email_incremental_sync_states from anon;
revoke all on table public.email_incremental_sync_states from authenticated;

-- Authenticated clients receive progress metadata only. History checkpoints,
-- page tokens, and lease fields remain server-only.
grant select (
  email_account_id,
  status,
  processed_history_records,
  affected_message_count,
  synced_message_count,
  deleted_message_count,
  failed_message_count,
  started_at,
  completed_at,
  last_batch_at,
  safe_error_code
) on public.email_incremental_sync_states to authenticated;

-- Atomically publishes the final History cursor and checkpoints the final
-- successfully processed page. No token or credential is accepted.
create or replace function public.finalize_incremental_email_sync(
  p_state_id uuid,
  p_workspace_id uuid,
  p_email_account_id uuid,
  p_batch_lock_id uuid,
  p_processed_history_records integer,
  p_affected_message_count integer,
  p_synced_message_count integer,
  p_deleted_message_count integer,
  p_failed_message_count integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start_history_id text;
  v_target_history_id text;
  v_finalized_at timestamptz := clock_timestamp();
begin
  if p_processed_history_records < 0
    or p_affected_message_count < 0
    or p_synced_message_count < 0
    or p_deleted_message_count < 0
    or p_failed_message_count <> 0 then
    raise exception 'Invalid incremental final sync counters';
  end if;

  select start_history_id, target_history_id
    into v_start_history_id, v_target_history_id
  from public.email_incremental_sync_states
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id
    and start_history_id is not null
    and target_history_id is not null
  for update;

  if not found then
    return false;
  end if;

  update public.email_accounts
  set provider_history_id = v_target_history_id,
      last_sync_at = v_finalized_at,
      last_sync_error = null
  where id = p_email_account_id
    and workspace_id = p_workspace_id
    and provider = 'GMAIL'
    and status = 'CONNECTED'
    and provider_history_id = v_start_history_id;

  if not found then
    raise exception 'Incremental sync cursor changed before finalization';
  end if;

  update public.email_incremental_sync_states
  set status = 'COMPLETED',
      next_page_token = null,
      processed_history_records = processed_history_records + p_processed_history_records,
      affected_message_count = affected_message_count + p_affected_message_count,
      synced_message_count = synced_message_count + p_synced_message_count,
      deleted_message_count = deleted_message_count + p_deleted_message_count,
      failed_message_count = failed_message_count + p_failed_message_count,
      completed_at = v_finalized_at,
      last_batch_at = v_finalized_at,
      safe_error_code = null,
      batch_lock_id = null,
      batch_lock_at = null
  where id = p_state_id
    and workspace_id = p_workspace_id
    and email_account_id = p_email_account_id
    and status = 'RUNNING'
    and batch_lock_id = p_batch_lock_id;

  if not found then
    raise exception 'Incremental sync state changed during finalization';
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_incremental_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer) from public;
revoke all on function public.finalize_incremental_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer) from anon;
revoke all on function public.finalize_incremental_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer) from authenticated;
grant execute on function public.finalize_incremental_email_sync(uuid, uuid, uuid, uuid, integer, integer, integer, integer, integer) to service_role;

commit;
