# Phase 4C local concurrency results

Executed only against disposable PostgreSQL 17 with deterministic synthetic workspace data. No Gmail or remote Supabase access occurred.

| Test | Session A | Session B | Blocking observed | Final evidence | Result |
|---|---|---|---|---|---|
| Same recipient + step | Claimed one row and held the transaction for 4 seconds | Attempted the same delivery with another token | Yes, about 3.6 seconds | One SENDING delivery, one effective token/idempotency/sender, day and minute reservations each exactly one | PASS |
| Global account quota | Claimed from campaign A at cap 1 | Raced campaign B for the same account | No material wait (lock-aware skip) | Exactly one campaign won; UTC_DAY=1 and UTC_MINUTE=1 | PASS |
| Stale reclaim | Aged a null-request SENDING claim | Reclaimed with a new token | Not applicable | Same sender/idempotency; no additional quota; non-null send-request claim could not reclaim | PASS |
| Reply vs follow-up | Claimed and held the delivery lock | Applied a valid reply signal | Yes, about 3.6 seconds | Recipient committed REPLIED; later claim returned zero; guarded send-request insert was rejected | PASS |

Lock order is campaign, recipient, then delivery for claim; signal processing locks campaign and recipient. If claim wins first, signal waits, then the send-request insert guard rechecks terminal eligibility and rejects it. If reply commits first, later claim sees non-ACTIVE engagement and returns no row.

Cleanup ran after verification and the deterministic fixture workspace count was confirmed as zero: **PASS**.
