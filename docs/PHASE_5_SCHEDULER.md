# Email campaign scheduler

The prepared Windows task is `HireX Email Campaign Worker`, running every minute. Installation requires `HIREX_ALLOW_SCHEDULER_INSTALL=1`; the installer is never run automatically.

The runner reads only `AUTOMATION_CRON_SECRET` from ignored `.env.local`, sends it in an Authorization header, binds to `127.0.0.1`, applies a four-minute timeout, and never prints the secret. An exclusive lock file prevents overlapping local processes. Database claim locks remain defense in depth.

Set `HIREX_SCHEDULER_DRY_RUN=1` to validate configuration, lock acquisition, endpoint authentication, and heartbeat persistence without Gmail or campaign processing. Logs contain UTC timestamp, safe result, and exit code only.

For a deterministic local harness, `HIREX_CAMPAIGN_SCHEDULER_URL` may override the endpoint only when it is an absolute HTTP URL hosted at `127.0.0.1`; every other host or protocol is rejected. This override is intended for local tests, never remote fallback.

Health: healthy under 3 minutes, warning from 3–10 minutes, stale after 10 minutes. Task installation remains operator-managed and is not inferred from heartbeat data.
