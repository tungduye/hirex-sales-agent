-- HireX Sales Agent - Phase 2B.3B Gmail-observed send correlation storage.
-- Storage/readiness only: this migration does not reconcile, unlock, retry, or
-- send email, and the observed header remains untrusted mailbox metadata.

begin;

alter table public.email_messages
  add column hirex_send_request_id uuid;

comment on column public.email_messages.hirex_send_request_id is
  'Nullable UUID parsed from Gmail header X-HireX-Send-Request-ID. This external mailbox value is not proof of delivery by itself and may only be considered by future reviewed reconciliation with same-workspace, same-account, SENT-label, connected-sender, expected-message, and provider-ID conflict checks.';

create index email_messages_workspace_account_hirex_send_request_idx
  on public.email_messages (workspace_id, email_account_id, hirex_send_request_id)
  where hirex_send_request_id is not null;

-- Migration 003 granted table-level SELECT, which would automatically expose
-- this new internal correlation column. Replace it with the pre-existing safe
-- mailbox columns only. RLS remains workspace-scoped and browser mutation
-- permissions remain fully revoked.
revoke select on table public.email_messages from authenticated;

grant select (
  id,
  workspace_id,
  email_account_id,
  email_thread_id,
  provider,
  provider_message_id,
  provider_history_id,
  rfc_message_id,
  in_reply_to,
  references_header,
  direction,
  from_email,
  from_name,
  to_emails,
  cc_emails,
  bcc_emails,
  subject,
  snippet,
  body_text,
  body_html,
  labels,
  is_unread,
  is_starred,
  sent_at,
  received_at,
  provider_internal_date,
  contact_id,
  has_attachments,
  attachment_count,
  created_at,
  updated_at
) on public.email_messages to authenticated;

commit;
