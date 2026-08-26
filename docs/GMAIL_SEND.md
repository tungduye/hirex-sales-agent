# Gmail Send and Reply Strategy

## Phase 2B.1 status

Phase 2B.1 prepares schema and OAuth strategy only. Gmail sending, replying, MIME construction, reconsent, workers, scheduled follow-ups, and AI-triggered delivery are not active.

## Least-privilege scopes

The current Gmail connection requests identity scopes `openid`, `email`, and `profile`, plus:

```text
https://www.googleapis.com/auth/gmail.readonly
```

A future send-enabled connection will retain those scopes and explicitly add:

```text
https://www.googleapis.com/auth/gmail.send
```

`gmail.send` is sufficient for `users.messages.send`, including replies. The platform does not request `gmail.modify`, `gmail.compose`, or `https://mail.google.com/` in this phase.

## Explicit send enablement

Sending will be enabled through a separate **Enable Gmail sending** flow. A readonly connection must never silently gain a send scope. The future authorization request will use offline access, `include_granted_scopes=true`, the existing identity/readonly scopes plus `gmail.send`, and `prompt=consent` for explicit upgrade consent and clear refresh-token handling.

The existing `email_accounts.scopes` array remains the granted-scope source of truth; no duplicate `granted_scopes` column or `send_enabled` boolean is added. Send capability is true only when the exact `https://www.googleapis.com/auth/gmail.send` value is recorded. Existing rows are not backfilled with assumed grants. The future upgrade callback must record normalized scopes actually observed from Google and must not assume `gmail.send` when a scope response is unavailable.

Any refresh-token replacement must encrypt the new token and persist the credential plus its scope state atomically within the reviewed server-only credential boundary. Failed or declined send consent must preserve the existing encrypted refresh token, readonly scopes, connected status, and mailbox synchronization. `SEND_SCOPE_REQUIRED` disables only the send operation; it must not disconnect a healthy readonly Gmail account.

## Send requests and idempotency

`email_send_requests` is a durable server-controlled record for one logical new message or reply. A stable idempotency key is unique per workspace and email account. Every retry reclaims the same row; it must not create another request or trust browser-supplied provider identifiers.

The table is follow-up ready through nullable `send_after`, but Phase 2B.1 has no worker, cron, or automatic transition of `PENDING` rows. No AI path can create and send mail automatically.

Safe error categories for future phases include `REAUTH_REQUIRED`, `SEND_SCOPE_REQUIRED`, `GMAIL_PERMISSION_DENIED`, `GMAIL_RATE_LIMITED`, `GMAIL_TEMPORARY_ERROR`, `INVALID_RECIPIENT`, `MIME_BUILD_FAILED`, `SEND_REQUEST_CONFLICT`, and `MAILBOX_PERSISTENCE_ERROR`. Raw provider, credential, MIME, and database errors must never be stored.

## Reply threading

For a `REPLY`, the browser supplies only an authorized local reply target and user-authored content. The server reloads `email_messages`, verifies the same workspace and email account, and derives the Gmail thread ID, RFC Message-ID, `In-Reply-To`, `References`, recipients, and subject. The future `users.messages.send` request uses the derived Gmail `threadId` plus RFC-compatible headers; an arbitrary browser thread ID is never authoritative.

Migration 006 intentionally defers a database FK from the send request to `email_messages`. Local mailbox messages are hard-deleted during Gmail synchronization: `RESTRICT` would break sync, `CASCADE` would destroy the send audit/idempotency record, and `SET NULL` conflicts with the required reply target. Phase 2B.2 must enforce same-workspace/account ownership at request creation and again before sending. A later immutable target snapshot may permit a different FK lifecycle without weakening mailbox sync.

## Sent mailbox reconciliation

After Gmail eventually accepts a send:

1. The send request records Gmail's returned message and thread identifiers.
2. Gmail History incremental synchronization observes the Sent mailbox change.
3. `email_messages` remains the canonical mailbox copy.
4. `email_send_requests` remains the durable send-attempt, audit, and idempotency record.

The system should prefer Gmail synchronization over creating a duplicate optimistic `email_messages` row unless Phase 2B.2 explicitly reviews a safe immediate-persistence requirement.
