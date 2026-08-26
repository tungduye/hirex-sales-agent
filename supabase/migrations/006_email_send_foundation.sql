-- HireX Sales Agent - Phase 2B.1 Gmail send/reply schema foundation.
-- This migration does not grant Gmail send consent, build MIME, call Gmail,
-- execute pending requests, or expose server-controlled mutations to browsers.

begin;

create table public.email_send_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email_account_id uuid not null,
  send_type text not null,
  status text not null default 'PENDING',
  reply_to_email_message_id uuid,
  to_addresses text[] not null,
  cc_addresses text[] not null default '{}'::text[],
  bcc_addresses text[] not null default '{}'::text[],
  subject text not null,
  body_text text,
  body_html text,
  send_after timestamptz,
  idempotency_key uuid not null,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  safe_error_code text,
  provider_message_id text,
  provider_thread_id text,
  rfc_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_send_requests_account_same_workspace_fk
    foreign key (email_account_id, workspace_id)
    references public.email_accounts (id, workspace_id)
    on delete cascade,
  constraint email_send_requests_send_type_allowed
    check (send_type in ('NEW', 'REPLY')),
  constraint email_send_requests_status_allowed
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  constraint email_send_requests_reply_target_shape check (
    (send_type = 'NEW' and reply_to_email_message_id is null)
    or (send_type = 'REPLY' and reply_to_email_message_id is not null)
  ),
  constraint email_send_requests_to_address_required
    check (cardinality(to_addresses) > 0),
  constraint email_send_requests_address_arrays_have_no_nulls check (
    array_position(to_addresses, null) is null
    and array_position(cc_addresses, null) is null
    and array_position(bcc_addresses, null) is null
  ),
  constraint email_send_requests_subject_not_blank
    check (btrim(subject) <> ''),
  constraint email_send_requests_body_text_not_blank
    check (body_text is null or btrim(body_text) <> ''),
  constraint email_send_requests_body_html_not_blank
    check (body_html is null or btrim(body_html) <> ''),
  constraint email_send_requests_body_required
    check (body_text is not null or body_html is not null),
  constraint email_send_requests_attempt_count_nonnegative
    check (attempt_count >= 0),
  constraint email_send_requests_safe_error_code_not_blank
    check (safe_error_code is null or btrim(safe_error_code) <> ''),
  constraint email_send_requests_provider_message_id_not_blank
    check (provider_message_id is null or btrim(provider_message_id) <> ''),
  constraint email_send_requests_provider_thread_id_not_blank
    check (provider_thread_id is null or btrim(provider_thread_id) <> ''),
  constraint email_send_requests_rfc_message_id_not_blank
    check (rfc_message_id is null or btrim(rfc_message_id) <> ''),
  constraint email_send_requests_status_shape check (
    (
      status = 'SENT'
      and sent_at is not null
      and provider_message_id is not null
      and provider_thread_id is not null
      and safe_error_code is null
    )
    or (
      status = 'FAILED'
      and sent_at is null
      and safe_error_code is not null
    )
    or (
      status in ('PENDING', 'SENDING', 'CANCELLED')
      and sent_at is null
    )
  ),
  constraint email_send_requests_workspace_account_idempotency_key
    unique (workspace_id, email_account_id, idempotency_key)
);

comment on table public.email_send_requests is
  'Server-controlled send intent, retry, audit, and idempotency record. Rows are not an automatic-send queue in Phase 2B.1.';
comment on column public.email_send_requests.reply_to_email_message_id is
  'Local reply target identifier. Phase 2B.2 must resolve and verify its workspace/account server-side; no browser provider thread ID is authoritative.';
comment on column public.email_send_requests.idempotency_key is
  'Stable key for one logical send. Retries reuse this row and key rather than creating another request.';
comment on column public.email_send_requests.safe_error_code is
  'Controlled application category only; never store raw Gmail, OAuth, MIME, or database errors.';

-- A hard FK to email_messages is intentionally deferred. Mailbox sync
-- hard-deletes local messages: RESTRICT would break sync, CASCADE would erase
-- the durable send audit record, and SET NULL conflicts with the REPLY shape.
-- The reviewed create/send boundary must verify reply target tenancy/account.
create index email_send_requests_workspace_reply_target_idx
  on public.email_send_requests (workspace_id, email_account_id, reply_to_email_message_id)
  where reply_to_email_message_id is not null;

create index email_send_requests_workspace_status_send_after_idx
  on public.email_send_requests (workspace_id, status, send_after, created_at)
  where status in ('PENDING', 'FAILED');

create index email_send_requests_workspace_account_created_idx
  on public.email_send_requests (workspace_id, email_account_id, created_at desc);

create trigger email_send_requests_set_updated_at
before update on public.email_send_requests
for each row execute function public.set_updated_at();

alter table public.email_send_requests enable row level security;

create policy email_send_requests_select_workspace
on public.email_send_requests
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

-- Authenticated browser clients receive workspace-scoped display access only.
-- No INSERT/UPDATE/DELETE grant or mutation policy exists; every future send
-- mutation must cross the reviewed server-only service boundary.
revoke all on table public.email_send_requests from public;
revoke all on table public.email_send_requests from anon;
revoke all on table public.email_send_requests from authenticated;

grant select (
  id,
  email_account_id,
  send_type,
  status,
  reply_to_email_message_id,
  to_addresses,
  cc_addresses,
  bcc_addresses,
  subject,
  body_text,
  body_html,
  send_after,
  attempt_count,
  safe_error_code,
  sent_at,
  created_at,
  updated_at
) on public.email_send_requests to authenticated;

commit;
