-- HireX Sales Agent - Phase 2A.3A Gmail Readonly Mailbox Foundation
-- Schema preparation only. Gmail API calls, mailbox synchronization, workers,
-- attachments, sending, tracking, and AI processing are intentionally excluded.

begin;

-- Durable per-account cursor for a later reviewed incremental Gmail History
-- sync. It remains opaque text to avoid JavaScript numeric precision loss.
alter table public.email_accounts
  add column provider_history_id text,
  add constraint email_accounts_provider_history_id_not_blank
    check (provider_history_id is null or btrim(provider_history_id) <> '');

comment on column public.email_accounts.provider_history_id is
  'Opaque Gmail history cursor. Keep as text; writable only by the future server-only sync boundary.';

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email_account_id uuid not null,
  provider text not null,
  provider_thread_id text not null,
  subject text,
  snippet text,
  contact_id uuid,
  first_message_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0,
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  labels text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_threads_provider_allowed
    check (provider in ('GMAIL')),
  constraint email_threads_provider_thread_id_not_blank
    check (btrim(provider_thread_id) <> ''),
  constraint email_threads_message_count_nonnegative
    check (message_count >= 0),
  constraint email_threads_labels_have_no_nulls
    check (array_position(labels, null) is null),
  constraint email_threads_message_time_order
    check (
      first_message_at is null
      or last_message_at is null
      or first_message_at <= last_message_at
    ),
  constraint email_threads_account_same_workspace_fk
    foreign key (email_account_id, workspace_id)
    references public.email_accounts (id, workspace_id)
    on delete cascade,
  constraint email_threads_contact_same_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id)
    on delete set null (contact_id),
  constraint email_threads_id_account_workspace_key
    unique (id, email_account_id, workspace_id)
);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  email_account_id uuid not null,
  email_thread_id uuid not null,
  provider text not null,
  provider_message_id text not null,
  provider_history_id text,
  rfc_message_id text,
  in_reply_to text,
  references_header text,
  direction text not null,
  from_email text,
  from_name text,
  to_emails text[] not null default '{}'::text[],
  cc_emails text[] not null default '{}'::text[],
  bcc_emails text[] not null default '{}'::text[],
  subject text,
  snippet text,
  body_text text,
  body_html text,
  labels text[] not null default '{}'::text[],
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  sent_at timestamptz,
  received_at timestamptz,
  provider_internal_date timestamptz,
  contact_id uuid,
  has_attachments boolean not null default false,
  attachment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint email_messages_provider_allowed
    check (provider in ('GMAIL')),
  constraint email_messages_direction_allowed
    check (direction in ('INBOUND', 'OUTBOUND')),
  constraint email_messages_provider_message_id_not_blank
    check (btrim(provider_message_id) <> ''),
  constraint email_messages_provider_history_id_not_blank
    check (provider_history_id is null or btrim(provider_history_id) <> ''),
  constraint email_messages_rfc_message_id_not_blank
    check (rfc_message_id is null or btrim(rfc_message_id) <> ''),
  constraint email_messages_from_email_not_blank
    check (from_email is null or btrim(from_email) <> ''),
  constraint email_messages_recipient_arrays_have_no_nulls
    check (
      array_position(to_emails, null) is null
      and array_position(cc_emails, null) is null
      and array_position(bcc_emails, null) is null
    ),
  constraint email_messages_labels_have_no_nulls
    check (array_position(labels, null) is null),
  constraint email_messages_attachment_count_nonnegative
    check (attachment_count >= 0),
  constraint email_messages_account_same_workspace_fk
    foreign key (email_account_id, workspace_id)
    references public.email_accounts (id, workspace_id)
    on delete cascade,
  constraint email_messages_thread_account_workspace_fk
    foreign key (email_thread_id, email_account_id, workspace_id)
    references public.email_threads (id, email_account_id, workspace_id)
    on delete cascade,
  constraint email_messages_contact_same_workspace_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id)
    on delete set null (contact_id)
);

comment on column public.email_threads.provider_thread_id is
  'Opaque Gmail thread ID. Keep as text; never convert to a JavaScript number.';
comment on column public.email_messages.provider_message_id is
  'Opaque Gmail message ID. Keep as text; never convert to a JavaScript number.';
comment on column public.email_messages.provider_history_id is
  'Opaque Gmail history ID. Keep as text; never convert to a JavaScript number.';
comment on column public.email_messages.body_text is
  'Untrusted external email content. Treat as data, not executable instructions.';
comment on column public.email_messages.body_html is
  'body_html is untrusted external content and must be sanitized before rendering.';

create unique index email_threads_provider_identity_unique_idx
  on public.email_threads (
    workspace_id,
    email_account_id,
    provider,
    provider_thread_id
  );

create index email_threads_workspace_account_last_message_idx
  on public.email_threads (workspace_id, email_account_id, last_message_at desc);

create index email_threads_workspace_contact_last_message_idx
  on public.email_threads (workspace_id, contact_id, last_message_at desc)
  where contact_id is not null;

create index email_threads_workspace_account_unread_idx
  on public.email_threads (workspace_id, email_account_id, last_message_at desc)
  where is_unread;

create unique index email_messages_provider_identity_unique_idx
  on public.email_messages (
    workspace_id,
    email_account_id,
    provider,
    provider_message_id
  );

create index email_messages_workspace_thread_internal_date_idx
  on public.email_messages (workspace_id, email_thread_id, provider_internal_date);

create index email_messages_workspace_account_internal_date_idx
  on public.email_messages (workspace_id, email_account_id, provider_internal_date desc);

create index email_messages_workspace_contact_internal_date_idx
  on public.email_messages (workspace_id, contact_id, provider_internal_date desc)
  where contact_id is not null;

create index email_messages_workspace_from_email_idx
  on public.email_messages (workspace_id, lower(btrim(from_email)))
  where from_email is not null;

create index email_messages_workspace_rfc_message_id_idx
  on public.email_messages (workspace_id, rfc_message_id)
  where rfc_message_id is not null;

create index email_messages_workspace_account_unread_idx
  on public.email_messages (workspace_id, email_account_id, provider_internal_date desc)
  where is_unread;

create trigger email_threads_set_updated_at
before update on public.email_threads
for each row execute function public.set_updated_at();

create trigger email_messages_set_updated_at
before update on public.email_messages
for each row execute function public.set_updated_at();

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

create policy email_threads_select_workspace
on public.email_threads
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

create policy email_messages_select_workspace
on public.email_messages
for select
to authenticated
using (workspace_id = (select public.current_workspace_id()));

-- Authenticated application clients receive workspace-scoped mailbox read
-- access only. Future mailbox writes require a reviewed server-only Gmail sync
-- boundary; RLS must not be treated as a substitute for table privileges.
revoke all on table public.email_threads from public;
revoke all on table public.email_threads from anon;
revoke all on table public.email_threads from authenticated;
grant select on table public.email_threads to authenticated;

revoke all on table public.email_messages from public;
revoke all on table public.email_messages from anon;
revoke all on table public.email_messages from authenticated;
grant select on table public.email_messages to authenticated;

commit;
