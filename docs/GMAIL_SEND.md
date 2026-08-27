# Gmail Send and Reply Strategy

## Phase 2B.1 through 2B.3A status

Phase 2B.1 schema is complete. Phase 2B.2 send consent is complete and live-tested. Phase 2B.3A one-message send has now passed one controlled live test. Replies, HTML, attachments, multiple recipients, workers, scheduled follow-ups, campaigns, and AI-triggered delivery remain inactive.

## Least-privilege scopes

The current Gmail connection requests identity scopes `openid`, `email`, and `profile`, plus:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Normal **Connect Gmail** remains readonly. The separate send-enable flow retains those scopes and explicitly requests:

```text
https://www.googleapis.com/auth/gmail.send
```

`gmail.send` is sufficient for `users.messages.send`, including replies. The platform does not request `gmail.modify`, `gmail.compose`, or `https://mail.google.com/` in this phase.

## Explicit send enablement

Sending capability is enabled through a separate **Enable sending** flow. A readonly connection never silently gains a send scope. The authorization request uses offline access, `include_granted_scopes=true`, the existing identity/readonly scopes plus `gmail.send`, and `prompt=consent` for explicit upgrade consent and clear refresh-token handling. The signed, expiring OAuth state binds the authenticated user, `ENABLE_SEND` purpose, nonce, and target local email account while reusing the registered callback URL.

The existing `email_accounts.scopes` array remains the granted-scope source of truth; no duplicate `granted_scopes` column or `send_enabled` boolean is added. Send capability is true only when the exact `https://www.googleapis.com/auth/gmail.send` value is recorded. Existing rows are not backfilled with assumed grants. The upgrade callback uses Google access-token info to verify normalized scopes actually granted and fails closed when `gmail.readonly` or `gmail.send` cannot be verified.

Before mutation, the callback verifies the authorized Google email case-insensitively against the target local account and also checks the stable provider identity when available. The server then reloads the connected account in the authenticated workspace and updates scopes, encrypted access token, and expiry in one credential mutation. A newly returned refresh token is encrypted and replaces the old value; when Google omits it, the existing encrypted refresh token is preserved.

Denied consent, account mismatch, missing scopes, token verification failure, stale callbacks, and database failures do not clear credentials, alter sync cursors, disconnect the account, or mark it `REAUTH_REQUIRED`. The browser receives only safe feedback codes and the metadata DTO exposes only `sendEnabled`, never raw scopes or credentials.

## Manual Google Cloud prerequisite

The live-tested Google OAuth configuration granted `https://www.googleapis.com/auth/gmail.send`. Application code still does not modify Google Cloud configuration.

## Send requests and idempotency

`email_send_requests` is a durable server-controlled record for one logical new message or reply. A stable idempotency key is unique per workspace and email account. Repeated submission of the same logical attempt reloads the same row and compares its immutable payload; different content returns `SEND_REQUEST_CONFLICT`. A `SENT`, `SENDING`, or `FAILED` request is never sent again in Phase 2B.3A.

Migration 007 adds a server-only execution lock and conditional RPC transitions:

```text
PENDING -> SENDING -> SENT
                   -> FAILED (definitive pre-acceptance failure only)
```

Only one caller can claim `PENDING`. Network loss, timeout, HTTP 408/5xx, malformed success responses, or failure to persist Gmail success produce an ambiguous outcome: the request remains `SENDING` with its lock intact for later reconciliation. There is no stale-lock reclaim, background retry, or automatic sender in Phase 2B.3A.

Before claim/send, a new request receives a stable requested/client MIME Message-ID in the form `<hirex.<request-uuid>@<validated-sender-domain>>`. It is derived from the server-generated request ID and connected Gmail sender domain, never from browser input. Gmail may canonicalize or replace this header, so equality with `email_send_requests.rfc_message_id` is not proof of delivery or non-delivery and must not be the sole ambiguous-delivery reconciliation key.

New MIME messages also include `X-HireX-Send-Request-ID` with the validated server-created request UUID. The browser cannot set this header. It is only a future correlation candidate: preservation by Gmail has not yet been live-tested and reconciliation must not rely on it. The Gmail parser can retain a validated value in its canonical in-memory representation, but current mailbox persistence has no dedicated database column and intentionally discards it.

The minimal Settings form is manual-only and accepts one recipient, a CR/LF-free subject, and a plain-text body. Its UUID idempotency key remains stable across duplicate submissions of one attempt. A new key is created only when the user explicitly starts another message after a definitive outcome.

Safe error categories for future phases include `REAUTH_REQUIRED`, `SEND_SCOPE_REQUIRED`, `GMAIL_PERMISSION_DENIED`, `GMAIL_RATE_LIMITED`, `GMAIL_TEMPORARY_ERROR`, `INVALID_RECIPIENT`, `MIME_BUILD_FAILED`, `SEND_REQUEST_CONFLICT`, and `MAILBOX_PERSISTENCE_ERROR`. Raw provider, credential, MIME, and database errors must never be stored.

## Reply threading

For a `REPLY`, the browser supplies only an authorized local reply target and user-authored content. The server reloads `email_messages`, verifies the same workspace and email account, and derives the Gmail thread ID, RFC Message-ID, `In-Reply-To`, `References`, recipients, and subject. The future `users.messages.send` request uses the derived Gmail `threadId` plus RFC-compatible headers; an arbitrary browser thread ID is never authoritative.

Migration 006 intentionally defers a database FK from the send request to `email_messages`. Local mailbox messages are hard-deleted during Gmail synchronization: `RESTRICT` would break sync, `CASCADE` would destroy the send audit/idempotency record, and `SET NULL` conflicts with the required reply target. Phase 2B.2 must enforce same-workspace/account ownership at request creation and again before sending. A later immutable target snapshot may permit a different FK lifecycle without weakening mailbox sync.

## Sent mailbox reconciliation

### Controlled Phase 2B.3A live result

- Local send request `ee550863-beb4-4558-b7c8-ea398a9a2eeb`: `SENT`, `attempt_count=1`, execution lock released, and exactly one send-request row.
- Gmail response provider message ID `1a042a52caf378a3` was recorded as the authoritative successful-response identifier.
- Gmail History sync: provider message ID and provider thread ID matched; the OUTBOUND subject matched; `affected=1`, `synced=1`, and `failed=0`.
- Requested Message-ID: `<hirex.ee550863-beb4-4558-b7c8-ea398a9a2eeb@gmail.com>`.
- Canonical Gmail Sent Message-ID: `<CADKiTYC+r83qrH8C9G6tM=ZBGjwEfRvjOODEbwJo=mS1MHyDAw@mail.gmail.com>`.

This test proves Gmail canonicalized/replaced the supplied Message-ID. Provider message/thread IDs are authoritative after a successful Gmail response. A deterministic requested Message-ID alone is insufficient for ambiguous delivery reconciliation. An ambiguous request must remain locked in `SENDING`; there is no automatic retry or reconciliation until a separately validated, false-positive-resistant mechanism is reviewed.

After Gmail eventually accepts a send:

1. The send request records Gmail's returned message and thread identifiers.
2. Gmail History incremental synchronization observes the Sent mailbox change.
3. `email_messages` remains the canonical mailbox copy.
4. `email_send_requests` remains the durable send-attempt, audit, and idempotency record.

Phase 2B.3A does not create an optimistic `email_messages` row. Gmail History synchronization remains the canonical path for the Sent mailbox copy.
