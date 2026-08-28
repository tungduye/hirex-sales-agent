# Gmail Send and Reply Strategy

## Phase 2B.1 through 2B.4G-A status

Phase 2B.1 schema is complete. Phase 2B.2 send consent is complete and live-tested. Phase 2B.3A one-message send passed its controlled live test. Phase 2B.3B persists Gmail-observed `X-HireX-Send-Request-ID` metadata. Phase 2B.3C records one successful controlled correlation-header preservation test. Phase 2B.3D adds a server-only, read-only ambiguous-send evidence evaluator. Phase 2B.3E adds the database-side transactional reconciliation finalizer. Phase 2B.3F adds the exact one-request orchestrator. Phase 2B.3G adds bounded read-only discovery. Phase 2B.3H adds the manual exact-request boundary. Phase 2B.3I-A adds local read-only list/inspect commands, and Phase 2B.3I-B adds an explicit local operator reconcile command. Phase 2B.4A adds read-only validation of one exact canonical Gmail message as a future reply target. Phase 2B.4B adds server-only creation of one idempotent `PENDING` reply intent. Phase 2B.4C adds a separate service-role-only transactional first-attempt claim for that reply intent. Phase 2B.4D adds read-only post-claim canonical execution planning. Phase 2B.4E adds a pure plain-text Gmail reply MIME builder. Phase 2B.4F-A adds a REPLY-specific transactional SENT finalizer. Phase 2B.4F-B only extends the reviewed Gmail send transport with an optional provider thread ID. Phase 2B.4F-C1 adds a separate deterministic REPLY FAILED finalizer and intentionally does not add a catch-all failure code. Phase 2B.4F-C adds a server-only, exact-one-request executor foundation with no production caller. Phase 2B.4G-A adds a guarded operator-only read-only preflight for one explicitly selected inbound message. Automatic reconciliation, reply execution entry points, retries, HTML, attachments, multiple recipients, workers, scheduled follow-ups, campaigns, and AI-triggered delivery remain inactive.

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

### Phase 2B.3F one-request orchestration boundary

The server-only orchestrator accepts only an exact request, workspace, and email-account UUID. It validates those identifiers, invokes the existing read-only evaluator, and returns without mutation for `NO_MATCH` or `AMBIGUOUS`. Only `SAFE_MATCH` with a valid evaluator-returned local message UUID may invoke the migration-009 finalizer once. It never accepts provider IDs, addresses, content, lock IDs, Gmail identifiers, or credentials from its caller.

The evaluator remains advisory. `SAFE_MATCH` does not authorize a forced status change: migration 009 locks the request and independently rechecks all canonical account, message, thread, exact-one correlation, provider-conflict, and CAS evidence. A false RPC result is reported as changed evidence and is not retried. The orchestrator has no Gmail call, direct table mutation, automatic request scan, scheduler, cron, route, server action, UI, webhook, or AI caller. It remains dormant until a separate production invocation boundary is reviewed.

### Phase 2B.3G bounded candidate discovery

The server-only discovery function performs one bounded, read-only query for `NEW` requests that are still `SENDING` with both execution-lock fields present and whose exact account is a connected Gmail account in the requested workspace. It defaults to 10 rows, caps requests at 25, and orders by oldest `send_lock_at` then request UUID. The lock age is ordering metadata only and never implies that a lock may be reclaimed or a send retried.

Discovery returns only local request/workspace/account IDs, lock timestamp, and attempt count. It does not expose the lock UUID, message content, addresses, provider identifiers, MIME, errors, or credentials. A candidate means only that the request currently has the shape of an unresolved send. It is not authorization to finalize. Any future explicit caller must still use the Phase 2B.3F chain: read-only evaluator, `SAFE_MATCH` gate, migration-009 transactional revalidation, and final CAS.

Phase 2B.3G has no evaluator/finalizer call, Gmail request, retry, stale-lock reclaim, mutation, automatic loop, route, server action, UI, scheduler, webhook, worker, or production caller.

### Phase 2B.3H explicit manual execution boundary

The server-only manual boundary accepts exactly a request, workspace, and email-account UUID. It performs an exact read-only preflight for one `NEW` request that remains `SENDING` with both lock fields present and an exact connected Gmail account in the same workspace. It does not use the bounded discovery page, so a valid exact request cannot be excluded merely because it is outside the first 10 or 25 candidates.

Preflight is a guard, not authorization. An eligible result delegates exactly once to Phase 2B.3F, which still performs the read-only evaluator, `SAFE_MATCH` gate, migration-009 transactional evidence revalidation, and final CAS. The manual boundary does not accept caller-supplied message/provider IDs, lock IDs, addresses, content, MIME, credentials, or evidence. It has no direct mutation, RPC, Gmail call, retry, route, server action, UI, scheduler, automation, or production caller.

### Phase 2B.3I-A local read-only inspector

The local operator CLI has exactly two commands: `list` invokes bounded candidate discovery, while `inspect` invokes the read-only evaluator for one exact request/workspace/account identity. It emits machine-readable JSON containing only reviewed candidate metadata or evaluator classification metadata. It does not print locks, content, addresses, provider responses, credentials, environment values, or raw errors.

Phase 2B.3I-A `list` and `inspect` remain read-only and never execute reconciliation.

### Phase 2B.3I-B explicit operator reconciliation

The local CLI adds exactly one execution command, `reconcile`, for one exact request/workspace/account identity. It requires the deterministic confirmation token `RECONCILE:<request UUID>` to match the validated request ID exactly. There are no execute, finalize, repair, retry, or send aliases and no interactive confirmation fallback.

The command rebuilds an exact three-ID input and delegates once only to Phase 2B.3H. It does not accept or forward matched-message/provider IDs, lock IDs, addresses, content, MIME, tokens, or arbitrary evidence. Phase 2B.3H still performs exact preflight and delegates through Phase 2B.3F, whose evaluator, `SAFE_MATCH` gate, migration-009 revalidation, and final CAS remain authoritative. The CLI does not directly call the orchestrator or RPC, send Gmail, scan/list candidates automatically, batch, loop, reclaim locks, or retry any outcome.

### Phase 2B.4A read-only reply target evaluator

The server-only evaluator accepts only one workspace UUID, email-account UUID, and canonical local message UUID. It reads the exact stored Gmail message plus its canonical thread and connected account, then fails closed unless all evidence has the same scope, the message is inbound and outside Spam/Trash, the original sender is one valid address distinct from the connected mailbox, provider identifiers are present and consistent, and the Gmail-observed RFC Message-ID is safe for a future `In-Reply-To` header.

A safe internal plan contains only local scope/target IDs, the canonical sender as the single future recipient, one normalized `Re:` subject, the canonical provider thread ID, and canonical parent RFC Message-ID. No body, credential, raw Gmail payload, or MIME is included. This phase creates no `REPLY` send request, route, UI, CLI, mutation, Gmail request, or reply. Later phases must separately review reply-request creation, transactional claiming, MIME construction, and one controlled live reply.

### Phase 2B.4B reply send-request creation

The server-only creation boundary accepts only workspace/account/target UUIDs, a plain-text body, and the existing UUID idempotency key. It invokes the Phase 2B.4A evaluator exactly once and inserts only when the returned canonical plan is runtime-valid and explicitly safe. The new row is a single-recipient `REPLY` in `PENDING`, with `attempt_count=0`, empty CC/BCC, null HTML and scheduling, and no execution lock or delivery-result identifiers.

The unique `(workspace_id, email_account_id, idempotency_key)` constraint remains the sole idempotency mechanism. A uniqueness race is resolved by an exact scoped read: equivalent immutable intent returns the existing request, while any target, recipient, subject, body, or send-type difference is a conflict and is never overwritten. Only `reply_to_email_message_id` persists the canonical linkage. Provider thread and parent RFC Message-ID evidence are deliberately not copied into delivery-result columns; a future reviewed claim/send phase must re-evaluate the canonical target before building reply MIME. Phase 2B.4B does not claim, build MIME, call Gmail, send, retry, or finalize.

### Phase 2B.4C transactional reply claim

Migration 010 adds a separate service-role-only `claim_reply_email_send_request` RPC and leaves the reviewed NEW claim/finalizers unchanged. It atomically changes one exact, pristine `REPLY` request from `PENDING` to `SENDING`, increments `attempt_count` from zero to one, and records the caller-generated lock UUID plus one claim timestamp in `send_lock_at` and `last_attempt_at`. The predicate rejects any prior attempt/error, schedule, lock, malformed recipient/content shape, delivery identifier, or sent timestamp. Concurrent callers race on the same conditional update, so at most one receives claim evidence; an already `SENDING` request is never claimed again and no stale lock is reclaimed.

The RPC returns only request/workspace/account/reply-target UUIDs, the execution lock UUID, and attempt count. A successful claim is execution ownership only, not authorization to deliver the reply. A future phase must re-run `evaluateReplyTarget()` after claim using the canonical `reply_to_email_message_id`, compare the current canonical recipient, subject, provider thread, and parent RFC Message-ID with the immutable stored intent, and fail closed if evidence changed. Phase 2B.4C has no Gmail call, MIME construction, finalization, retry, route, UI, CLI, scheduler, or server wrapper consumer.

### Phase 2B.4D post-claim execution planning

The server-only planner performs one exact, explicit-column SELECT for the claimed request and fails closed unless the caller owns its exact lock and the row still has the pristine first-attempt `REPLY`/`SENDING` shape. Only then does it invoke `evaluateReplyTarget()` exactly once using the persisted `reply_to_email_message_id`. Claim ownership is necessary but is not authorization to send.

The planner compares the persisted immutable target, one recipient, and subject exactly with current canonical evaluator evidence. Any change produces `EVIDENCE_CHANGED` and the request is not rewritten. The provider thread ID and parent RFC Message-ID were deliberately never stored in the request, so they are validated as current post-claim canonical execution evidence rather than compared with a historical snapshot. A READY internal plan additionally carries the preserved plain-text body and exact lock ownership needed by a future MIME phase. Phase 2B.4D performs no mutation, claim, Gmail request, MIME construction, finalization, retry, route, UI, CLI, or scheduler work.

### Phase 2B.4E reply MIME builder

The pure builder accepts only a complete Phase 2B.4D READY execution plan and an internal sender address. It runtime-validates the exact plan again, RFC2047-encodes and safely folds the subject, base64-encodes the unmodified UTF-8 plain-text body in lines of at most 76 characters, and returns Gmail-compatible base64url MIME plus the current canonical provider thread ID. Required headers are From, To, Subject, In-Reply-To, References, MIME-Version, plain-text UTF-8 content type, base64 transfer encoding, and exactly one `X-HireX-Send-Request-ID` correlation header.

The builder does not add a caller Message-ID; Gmail will assign the canonical outgoing Message-ID. The provider thread ID is returned separately for a future `messages.send({ raw, threadId })` call and never placed in a MIME header. The supplied sender is server-internal evidence only: this phase does not authorize it or the canonical target. Phase 2B.4E has no database/network access, Gmail call, claim, mutation, finalization, retry, route, UI, or CLI. A future send phase must validate the exact connected account and credentials, derive its sender, use a reviewed READY plan, build MIME, call Gmail with raw plus thread ID, and preserve ambiguous-delivery safety.

### Phase 2B.4F-A transactional reply SENT finalizer

Migration 011 adds a separate service-role-only exact-lock finalizer for one first-attempt `REPLY` request in `SENDING`. It independently checks the complete claimed request shape, unchanged claim timestamps, null pre-existing delivery evidence, and conservative Gmail provider message/thread IDs before atomically setting `SENT`, recording provider IDs and one database-generated sent timestamp, and clearing the execution lock. A second or wrong-lock invocation returns false and cannot overwrite provider evidence. Existing NEW claim/finalizers remain unchanged.

The REPLY finalizer intentionally leaves `rfc_message_id` as `NULL`. Gmail `messages.send` does not return the canonical outgoing RFC Message-ID, and the platform does not manufacture one merely to satisfy NEW-send semantics. A later mailbox sync or reviewed reconciliation may observe Gmail's canonical outgoing message. Phase 2B.4F-A contains no Gmail call, transport extension, executor, retry, reconciliation, route, UI, CLI, or scheduler.

### Phase 2B.4F-B Gmail transport thread ID extension

The existing one-request Gmail transport now accepts one optional, server-supplied provider thread ID. A NEW send remains byte-for-byte equivalent at the Gmail request boundary and sends JSON containing only `{ raw }`. A future REPLY executor may send exactly `{ raw, threadId: providerThreadId }`; the provider thread ID is never inserted into MIME. The transport validates a supplied thread ID conservatively before network access and returns Gmail's actual provider message and thread IDs without substituting the requested thread ID.

This transport extension does not authorize thread selection. A future reviewed REPLY executor must derive the thread from canonical server-side evidence and require Gmail's returned thread ID to equal the requested provider thread ID before SENT finalization. Timeout, network, and unreadable-success outcomes remain ambiguous and are never retried automatically. Phase 2B.4F-B added no executor, claim, planner orchestration, finalizer call, database mutation, route, UI, CLI, or live Gmail send.

### Phase 2B.4F-C1 deterministic REPLY failure finalizer

Migration 013 adds a separate exact-lock finalizer for deterministic failures after a successful first-attempt REPLY claim and before Gmail acceptance. Its closed taxonomy is `REPLY_TARGET_CHANGED`, `REPLY_TARGET_NOT_REPLYABLE`, `MIME_BUILD_FAILED`, `REAUTH_REQUIRED`, `GMAIL_PERMISSION_DENIED`, `GMAIL_RATE_LIMITED`, and `GMAIL_SEND_REJECTED`. There is intentionally no generic local, internal, unknown, or temporary failure code. The existing NEW/shared failure finalizer is unchanged.

The RPC may be used only when Gmail acceptance is known not to have happened. Planner unavailable or malformed evidence, claim uncertainty, ambiguous Gmail transport, a provider thread mismatch after Gmail success, and an uncertain or failed SENT finalization must never call this RPC. Those outcomes remain unresolved in `SENDING` for reviewed reconciliation; they are not converted to `FAILED`, unlocked, retried, or resent. Phase 2B.4F-C1 does not implement the executor or call Gmail.

### Phase 2B.4F-C controlled REPLY executor foundation

The server-only executor accepts only the exact request, workspace, and email-account UUIDs. It validates credentials before mutation, generates one internal UUID lock, claims once, plans once against current canonical evidence, builds MIME once, sends Gmail at most once with the required provider thread ID, validates Gmail's returned provider IDs and thread consistency, and invokes at most one appropriate finalizer. There is no production caller, route, UI, CLI, scheduler, batch, retry, or live execution in this phase.

The state machine is fail-closed. A pre-claim failure makes no request mutation. After claim, `EVIDENCE_CHANGED`, `NOT_REPLYABLE`, or deterministic MIME invalidity finalizes `FAILED` with `REPLY_TARGET_CHANGED`, `REPLY_TARGET_NOT_REPLYABLE`, or `MIME_BUILD_FAILED`. Planner/MIME unavailability leaves the request unresolved in `SENDING` without a Gmail call. A definitive Gmail rejection uses only the four reviewed provider codes and finalizes `FAILED`; an ambiguous transport remains `SENDING` without retry. Gmail success with a different returned thread, or an uncertain SENT finalization, also remains `SENDING` for reconciliation. Only Gmail success with exact thread equality and a true REPLY SENT finalizer becomes `SENT`.

### Phase 2B.4G-A controlled live-reply preflight

The operator command `scripts/preflight-controlled-gmail-reply.mjs` is read-only and evaluates exactly one explicitly supplied workspace, Gmail account, and local inbound message UUID through the existing canonical reply-target evaluator. It has no default, latest-message selection, search-and-pick behavior, mutation, send, claim, finalizer, executor, route, UI, scheduler, or automation. It refuses to run unless `HIREX_ENABLE_CONTROLLED_REPLY_PREFLIGHT=1`; this guard enables only read-only inspection and is not send authorization.

A `READY_FOR_CONTROLLED_REPLY_TEST` result exposes only the reviewed recipient, reply subject, provider thread ID, and parent RFC Message-ID alongside the three scoped IDs. Success does not create a send request and does not authorize Gmail delivery. A separate later operator step must create one immutable `PENDING` REPLY request, and another separately authorized explicit step must execute that exact request once.

After Gmail eventually accepts a send:

1. The send request records Gmail's returned message and thread identifiers.
2. Gmail History incremental synchronization observes the Sent mailbox change.
3. `email_messages` remains the canonical mailbox copy.
4. `email_send_requests` remains the durable send-attempt, audit, and idempotency record.

Phase 2B.3A does not create an optimistic `email_messages` row. Gmail History synchronization remains the canonical path for the Sent mailbox copy.
