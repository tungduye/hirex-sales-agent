# Phase 4C two-session harness

These scripts are deliberately operator-driven and must use only a reviewed database connection. They never call Gmail. Run `016_setup.sql`, then open two `psql` terminals. For each race, run session A until its `SESSION_A_LOCK_HELD` marker, start session B (it may block), commit A manually, then verify. Run cleanup last.

1. `016_setup.sql`
2. `016_same_step_session_a.sql` in A
3. `016_same_step_session_b.sql` in B; then `COMMIT;` in A
4. `016_verify.sql`
5. Repeat with a reply signal in B before a due follow-up claim to verify the row lock serializes the decision and no post-signal claim succeeds.
6. `016_cleanup.sql`

The harness is not executed automatically. Shared sender quota safety is additionally inherited from the reviewed 014/015 row-locking design.
