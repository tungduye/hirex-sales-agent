# Phase 5 controlled rollout

1. Review migrations 018–019.
2. Apply 001–019 to a clean local PostgreSQL 17 database.
3. Run remote preflight with explicit read authorization.
4. Run scheduler dry-run.
5. Apply reviewed migrations remotely.
6. Verify private Storage bucket and policies.
7. Upload one guarded remote attachment fixture.
8. Send one allowlisted QA email with a small attachment.
9. Verify the received attachment and hash.
10. Repeat scheduler dry-run.
11. Explicitly install the scheduler.
12. Observe five consecutive healthy runs.
13. Pause the QA campaign and verify no send.
14. Resume and verify one due send.
15. Simulate process restart.
16. Verify scheduler recovery and heartbeat UI.
17. Complete manual production activation review.

Remote Storage requires `HIREX_ALLOW_REMOTE_STORAGE_TESTS=1`; live email additionally requires existing QA sender, recipient allowlist, prefix, maximum-send, and live-email authorization guards.
