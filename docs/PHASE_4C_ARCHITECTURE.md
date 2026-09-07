# Phase 4C architecture

Phase 4C is additive. Historic and single-send campaigns retain `sequence_enabled=false` and continue through the live-tested 014/015 claim/finalize path. New sequence campaigns use separate definition, delivery and signal tables plus service-role-only RPCs.

Campaign reporting is canonical: one pure aggregation layer defines campaign, step, sender and conservative reply-attribution metrics; the detail UI and both export formats consume it. Audience browsing is server-filtered and bounded to 25/50/100 rows. Sequence reordering is a service-role-only transactional RPC that locks a DRAFT campaign, validates the complete ordered ID set, preserves INITIAL at order zero, and applies a contiguous atomic reorder.

## Lifecycle and safety

- A campaign has at most six enabled steps: order 0 is `INITIAL`; orders 1–5 are `FOLLOW_UP`.
- Definitions are editable only while the parent is `DRAFT`.
- Initialization materializes only step 0. A successful finalizer schedules the next step from the authoritative `sent_at`, never claim time.
- Each recipient/step has one stable idempotency key. Claims are bounded, row-locked and reclaim only a stale `SENDING` row without a send request.
- `DELIVERY_UNKNOWN` is terminal and never automatically retried.
- Paused/cancelled campaigns cannot claim. Cancellation preserves sent/unknown evidence and cancels pending work.

## Stop signals

Reply matching requires the same workspace, Gmail account and provider thread, inbound direction, exact normalized recipient sender, and a receive time after the campaign send. Subject-only matching is forbidden. Durable signal keys make processing idempotent. A confirmed reply stops pending steps but does not globally suppress the person.

Unsubscribe uses the existing signed URL and global suppression precedence. It also applies recipient-level stop state. Hard bounce classification is deliberately conservative: an explicit failed recipient plus permanent DSN evidence is required. The parser persists only selected multipart/report delivery-status fields, never raw MIME. Temporary 4.x.x, vacation and generic automatic mail are not hard bounces. Confirmed DSNs are tied to a prior SENT delivery by workspace, sender account, exact recipient and time.

## Threading and transport

Step 0 uses the reviewed NEW-send lifecycle. Follow-ups also remain NEW outbound campaign messages, but pass the prior Gmail provider thread ID and canonical RFC Message-ID to the same safe send infrastructure. Missing or malformed threading evidence fails `THREAD_METADATA_UNAVAILABLE`; it never falls back to a duplicate standalone conversation. Human Inbox REPLY behavior is unchanged.

## Quotas, reporting and exports

Every fresh claim reserves sender quota once; stale reclaim does not reserve again. Suppressed/skipped work consumes none. Reporting uses database delivery and engagement facts only—no opens/clicks or tracking pixels. CSV and XLSX exports sanitize cells beginning with `=`, `+`, `-`, or `@`; they never include credentials.

## Automation and security

The existing bearer-protected internal route runs signal refresh, legacy processing, and sequence processing with bounded limits. Windows scripts are preparation only and are not installed. Tables use workspace RLS; authenticated users receive selected metadata only; mutation RPC execution is service-role-only. No credential is added to a public environment variable.
