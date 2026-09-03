# Campaign claim two-session harness

This harness uses only deterministic synthetic database rows. It never calls Gmail or the campaign worker. Run it only with an operator-supplied PostgreSQL connection whose database role can create the fixtures and execute the service-only claim RPC. Do not place a database password or service-role key in these files.

From PowerShell, set the connection only in the operator environment and move to the project root:

```powershell
$env:HIREX_TEST_DATABASE_URL = '<operator-supplied PostgreSQL connection string>'
Set-Location 'C:\Users\Admin\hirex-sales-agent'
psql "$env:HIREX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f '.\supabase\tests\concurrency\setup.sql'
```

`setup.sql` must print `SETUP_PASS` and the deterministic workspace, campaign, and token IDs.

## Same-recipient race

Open two interactive terminals so Session A can retain its transaction.

Terminal A:

```powershell
psql "$env:HIREX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1
```

At the `psql` prompt:

```text
\i 'C:/Users/Admin/hirex-sales-agent/supabase/tests/concurrency/same_recipient_session_a.sql'
```

Session A must return one recipient and print `SESSION_A_HOLDS_TRANSACTION`. Do not close it and do not commit yet.

Terminal B:

```powershell
psql "$env:HIREX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1
```

At the second `psql` prompt:

```text
\i 'C:/Users/Admin/hirex-sales-agent/supabase/tests/concurrency/same_recipient_session_b.sql'
```

Session B may block at the claim call because Session A holds the campaign `FOR UPDATE` lock. Once blocking is visible, return to Terminal A and run:

```sql
commit;
```

Session B must resume, return zero rows, commit, and print `SAME_RECIPIENT_B_DONE`. Then verify from either terminal:

```text
\i 'C:/Users/Admin/hirex-sales-agent/supabase/tests/concurrency/verify_same_recipient.sql'
```

Expected output: `VERIFY_SAME_RECIPIENT_PASS`.

## Cross-campaign shared-account race

Keep two interactive `psql` terminals. In Terminal A run:

```text
\i 'C:/Users/Admin/hirex-sales-agent/supabase/tests/concurrency/cross_campaign_session_a.sql'
```

It must return one claim and retain the transaction. While it remains open, run in Terminal B:

```text
\i 'C:/Users/Admin/hirex-sales-agent/supabase/tests/concurrency/cross_campaign_session_b.sql'
```

The campaigns compete for the same account with one remaining global day/minute slot. Exactly one may reserve that shared slot. The enabled fallback account lets the other campaign claim through the fallback when lock scheduling permits. Terminal B may finish via fallback or wait on database locking; after it finishes or visibly blocks, run `commit;` in Terminal A. If B was blocked, wait for it to finish.

Verify from either terminal:

```text
\i 'C:/Users/Admin/hirex-sales-agent/supabase/tests/concurrency/verify_cross_campaign.sql'
```

Expected output: `VERIFY_CROSS_CAMPAIGN_PASS`. The shared account must have exactly one reservation in each current UTC bucket and must never exceed cap 1.

## Cleanup

After both sessions have committed, run:

```powershell
psql "$env:HIREX_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f '.\supabase\tests\concurrency\cleanup.sql'
```

Expected output: `CLEANUP_PASS`. If any session is still open in a transaction, commit or roll it back before cleanup. Cleanup deletes only the deterministic `960...` fixtures and verifies that their user, workspace, accounts, campaigns, recipients, limits, usage, and events are absent.
