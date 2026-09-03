# Migration 014 two-session concurrency test

Run only after migration 014 has been reviewed and applied to an isolated test database. Never run against production recipients.

1. Insert the documented synthetic workspace/profile, two connected Gmail accounts, two RUNNING campaigns, campaign senders and PENDING recipients inside the isolated database.
2. Set the shared account global daily and minute caps to `1`.
3. Open SQL sessions A and B with `service_role`; begin both transactions.
4. Same-recipient case: invoke `claim_email_campaign_recipients()` concurrently with distinct claim tokens for the same campaign. Hold session A before commit. Session B is expected to block on the campaign `FOR UPDATE` lock. After session A commits, session B resumes and must return zero rows; exactly one recipient claim and one day/minute reservation exist.
5. Cross-campaign case: create one PENDING recipient in each RUNNING campaign, both using the same Gmail account with remaining global quota `1`. Invoke the claim RPC concurrently. Exactly one session may return a claim and global `reserved_count` must be exactly `1` in both current UTC buckets.
6. Repeat with a second eligible Gmail account. The blocked campaign may select that account, while the first account remains at its cap.
7. Roll back/delete the isolated synthetic workspace and verify all cascade-owned fixtures are absent.

The single-session rollback suite validates schema, privileges and function shape. Only this two-connection procedure validates real lock scheduling.
