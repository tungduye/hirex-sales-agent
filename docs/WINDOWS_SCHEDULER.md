# Windows Gmail Scheduler Runner

This project includes a server-local PowerShell runner for the internal Gmail incremental sync endpoint. It performs one endpoint invocation and does not contain or accept the scheduler secret as a command-line argument.

## Application runtime

For development testing, start the application with:

```powershell
npm run dev
```

For a stable local runtime later, build and start the production server with:

```powershell
npm run build
npm run start
```

The application must be running before the scheduler runner is invoked.

## Runner

The runner is:

```text
scripts/run-gmail-incremental-sync.ps1
```

It resolves the project root from its own location and reads `AUTOMATION_CRON_SECRET` from the ignored project-root `.env.local`. By default it calls:

```text
http://localhost:3000/api/internal/gmail/incremental-sync
```

A server-local `GMAIL_INCREMENTAL_SYNC_URL` environment variable may override that URL. Neither the URL nor secret is accepted as a command-line argument.

Exit codes are `0` for a successful run with no failed accounts, `1` for configuration/network/HTTP/malformed-response failures, and `2` when the endpoint ran successfully but one or more accounts failed. Busy/skipped accounts alone do not produce exit code `2`.

## Scheduling status

Windows Task Scheduler setup remains pending. No scheduled task is created by this phase.

A future VPS migration changes only the application runtime and external scheduler configuration. The Gmail incremental synchronization core and internal endpoint remain unchanged.
