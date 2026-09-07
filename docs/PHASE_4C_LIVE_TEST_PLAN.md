# Phase 4C controlled live-test plan

Do not start until code and migration review are approved.

Local closure completed first: clean migration apply and the 51-check rollback foundation passed on disposable PostgreSQL 17. The four true concurrency tests previously passed and remain applicable because final closure changed DRAFT configuration reordering, not claim/finalizer/signal lock semantics. Remote execution still requires explicit operator authorization.

1. Review the full code diff and the documented limitations.
2. Run `supabase/tests/016_email_campaign_sequences_preflight.sql` read-only.
3. Run `npx supabase db push --dry-run`; confirm only migration 016 appears.
4. Apply only migration 016 after explicit approval.
5. Run the rollback-safe foundation SQL.
6. Complete and run the operator-controlled two-session concurrency harness.
7. Walk through list, wizard, detail, sequence, sender, activity, report and suppression UI.
8. Send one controlled initial email to an owned address.
9. Send one controlled follow-up and verify the Gmail thread.
10. Reply from the owned recipient inbox.
11. Run incremental Gmail sync through the existing reviewed control.
12. Verify the recipient becomes REPLIED and no future step is claimable.
13. Validate hard bounce only with stored/synthetic DSN fixtures—never send to an invalid address.
14. Use a controlled signed unsubscribe link and verify precedence/idempotency.
15. Export CSV/XLSX and inspect all sheets and formula-injection cases.
16. Verify send requests, delivery rows, events and quota contain no duplicates.
17. Remove controlled fixtures using reviewed cleanup SQL.
