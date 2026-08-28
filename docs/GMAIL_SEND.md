# Gmail Send and Reply Strategy

## Phase 2B.1 through 2B.3E status

Phase 2B.1 schema is complete. Phase 2B.2 send consent is complete and live-tested. Phase 2B.3A one-message send passed its controlled live test. Phase 2B.3B persists Gmail-observed `X-HireX-Send-Request-ID` metadata. Phase 2B.3C records one successful controlled correlation-header preservation test. Phase 2B.3D adds a server-only, read-only ambiguous-send evidence evaluator. Phase 2B.3E adds a database-side transactional reconciliation finalizer foundation, but it is not called by production code. Replies, automatic reconciliation, retries, HTML, attachments, multiple recipients, workers, scheduled follow-ups, campaigns, and AI-triggered delivery remain inactive.

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

New MIME messages also include `X-HireX-Send-Request-ID` with the validated server-created request UUID. The browser cannot set this header. Phase 2B.3B adds a nullable UUID field and workspace/account partial index so Gmail History upserts can persist only a valid observed header. The field remains internal and is excluded from authenticated browser SELECT grants. There is no UNIQUE constraint or FK because duplicate, copied, forged, or corrupted external headers must not break mailbox synchronization. Preservation has now been verified in one controlled live Gmail send plus History sync, but Gmail is not assumed to guarantee custom-header preservation universally and reconciliation must not rely on this value alone.

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

`hirex_send_request_id` equality alone is also insufficient. Any future reviewed reconciliation must at minimum verify the same workspace and email account, exact local request ID, canonical Gmail `SENT` label, association with the connected sender, expected recipient/content metadata where useful, and absence of conflicting provider identifiers. `ParsedGmailMessage.direction === OUTBOUND` alone is not proof of Gmail delivery.

### Controlled Phase 2B.3C correlation result

- Send request `7930c5d5-3acf-4698-a79b-7bc302045c18`: `SENT`, `attempt_count=1`, execution locks released, and exactly one matching send-request row.
- Gmail response `provider_message_id` matched the canonical `email_messages` row, and `provider_thread_id` matched the canonical thread.
- The canonical Gmail message was `OUTBOUND` and had the Gmail `SENT` label.
- Gmail History sync completed with `affected=1`, `synced=1`, and `failed=0`.
- Gmail preserved `X-HireX-Send-Request-ID`, and `email_messages.hirex_send_request_id` exactly matched `email_send_requests.id`.
- Gmail again replaced/canonicalized the client MIME Message-ID with a different canonical Gmail Message-ID.

Current evidence is deliberately narrow: provider message ID is authoritative after a successful Gmail API response; client MIME Message-ID is not a reconciliation key; and the custom HireX header was preserved in this one controlled test only. Future ambiguous-delivery reconciliation must combine the same workspace, same email account, exact request ID, canonical Gmail `SENT` label, expected connected sender, expected recipient, compatible subject/message metadata, and absence of conflicting provider IDs. No automatic reconciliation or retry exists, and ambiguous `SENDING` requests remain locked.

### Phase 2B.3D read-only evaluator

The server-only evaluator classifies an eligible ambiguous `SENDING`/`NEW` request as exactly `SAFE_MATCH`, `NO_MATCH`, or `AMBIGUOUS`. It uses same-workspace and same-email-account queries and requires exactly one canonical message with the exact HireX UUID, Gmail `SENT` label, no `SPAM`/`TRASH`, connected sender, exactly one matching recipient, exact normalized subject, conservatively equivalent plain-text body, and no conflict with any non-null stored provider message/thread ID.

Body comparison only normalizes CRLF/CR to LF and permits one terminal newline difference because MIME parsing can add or remove that final line ending. It does not trim interior whitespace or perform fuzzy matching. A missing canonical body is `AMBIGUOUS`; a definite mismatch is `NO_MATCH`. Duplicate header matches are also `AMBIGUOUS` and the evaluator never selects the newest or first row.

`SAFE_MATCH` is evidence only. The evaluator performs privileged SELECTs but has no insert, update, delete, RPC, Gmail request, status transition, lock release, or retry. A future mutation phase must separately review transaction/concurrency rules, current lock ownership, provider identifiers, audit trail, false-positive protection, and a final database recheck if state changes between evaluation and finalization.

### Phase 2B.3E transactional finalizer foundation

Migration 009 defines a service-role-only reconciliation RPC that can conditionally transition one locked `NEW` request from `SENDING` to `SENT`. An evaluator `SAFE_MATCH` result is never accepted as authoritative input. The RPC accepts only local request/workspace/account/message UUIDs, locks and re-reads the request, and independently revalidates the connected Gmail account, exact-one correlation, canonical `SENT` message, exclusion of `SPAM`/`TRASH`, sender, single recipient, normalized subject, conservative plain-text body equivalence, canonical thread, and provider-ID conflicts inside one transaction.

The RPC does not accept provider IDs, labels, sender, recipient, subject, body, status, or lock IDs from its caller. It does not reclaim a stale lock. Successful finalization retains the normal request record, copies canonical provider identifiers, clears only the request's still-matching execution lock, and records a minimal `EMAIL_SEND_RECONCILED` audit event containing only local request and message UUIDs. Concurrent calls serialize on the request row; at most one may return true.

This foundation is deliberately dormant. It is not called by the evaluator, Gmail History sync, send route, scheduler, browser, UI, or worker. There is still no automatic retry, automatic reconciliation, stale-lock recovery, or Gmail call in this path. Migration 009 and its rollback-only SQL fixtures must be reviewed and applied separately before any later production integration is designed.

After Gmail eventually accepts a send:

1. The send request records Gmail's returned message and thread identifiers.
2. Gmail History incremental synchronization observes the Sent mailbox change.
3. `email_messages` remains the canonical mailbox copy.
4. `email_send_requests` remains the durable send-attempt, audit, and idempotency record.

Phase 2B.3A does not create an optimistic `email_messages` row. Gmail History synchronization remains the canonical path for the Sent mailbox copy.
