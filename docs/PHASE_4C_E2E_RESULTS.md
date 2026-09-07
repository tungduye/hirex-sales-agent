# Phase 4C autonomous E2E results

## Live QA campaign

- Campaign: `284127b4-db07-4c1f-bc74-5a2d40ae17f3` / `PHASE-4C-E2E-20260904-1730`.
- Authenticated HireX UI: PASS.
- Guarded audience: one allowlisted recipient; one suppressed/duplicate candidate was not added.
- Initial send: PASS (one message).
- Follow-up send: PASS (one message after the configured delay).
- Canonical provider thread continuity: PASS.
- Duplicate campaign sends: zero.
- Failed or delivery-unknown campaign sends: zero.
- Campaign completion: PASS.

## Real reply and stop-on-reply

- The exact recipient mailbox, allowlist membership, database recipient, and exact Gmail thread were verified before the controlled reply.
- Gmail incremental History sync completed successfully and persisted the reply as an inbound canonical_v2 message on the canonical campaign thread.
- A lifecycle defect was found: sequence completion changed recipient engagement to `COMPLETED`, while reply attribution accepted only `ACTIVE` recipients.
- Migration 017 was dry-run as the only pending migration, applied remotely, and the server processor was aligned to accept a strongly matched reply for `ACTIVE` or `COMPLETED` recipients. Other terminal signal transitions remain fail-closed.
- Re-run result: recipient `REPLIED`, `replied_at` populated, canonical reply message ID stored, and scoped reply processor reported one stopped recipient.
- Scoped campaign worker after reply: zero processed and zero sent.
- Reply processing did not create a suppression row; the recipient's suppression count was already one before attribution and remained one afterward.

## Unsubscribe and reporting

- The signed unsubscribe link from the exact QA thread was opened only after operator confirmation.
- The endpoint returned the successful unsubscribe state; database suppression reason is `UNSUBSCRIBED`. The operation was idempotent because that suppression already existed before this click.
- Live Campaign Detail report: PASS (one recipient, two messages, one reply, 100% reply rate, zero failed, zero delivery unknown).
- CSV/XLSX generation and formula-injection protections: regression PASS.
- Strongest available live-data verification: PASS. The production export builder loaded the current remote QA campaign, produced a non-HTML 513-byte CSV that parsed with the expected summary/detail headers and recipient row, and produced a 10,653-byte XLSX that opened with ExcelJS and contained the expected worksheets, headers, and recipient row.
- Both export actions are reachable and were clicked in the authenticated reporting UI. The browser download-event harness did not emit a reliable completion handle and no `campaign-report*` artifact appeared in the Windows Downloads folder. Browser-observed download completion is therefore still INCONCLUSIVE and is not labeled PASS. This is a harness/environment limitation; the live-data artifacts themselves fully generated and parsed without evidence of an application export defect.

## Validation

- 20 JavaScript validator suites: PASS, 1,386 assertions.
- Phase 4C rollback foundation: previously established PASS, 53 checks.
- `npm run lint`: PASS.
- `npm run build`: PASS on Next.js 16.3.2.
- `git diff --check`: PASS (line-ending notices only).
- No scheduler was installed, and no commit or push was performed.

## Remaining external blocker

- The guarded remote two-session concurrency runner remains unavailable because `SUPABASE_DB_URL` is populated with a non-URL value: it has no PostgreSQL scheme, authority separator, user/password, host, port, database path, or `@` separator. No alternative database URL or database-password variable is available, so a valid DSN cannot be derived safely. No concurrency fixture was created by that blocked attempt.

Final release status remains `PHASE 4C: PARTIALLY BLOCKED` because genuine remote two-session concurrency cannot run until the operator supplies a complete PostgreSQL connection URI.
