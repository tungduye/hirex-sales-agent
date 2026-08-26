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

## Windows Task Scheduler

The installer registers `HireX Gmail Incremental Sync` for the current Windows user. It runs only while that user is logged on, repeats every five minutes, ignores overlapping starts, and does not place the scheduler secret in the task definition.

Installation remains pending until this reviewed command is run manually:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-gmail-scheduler-task.ps1"
```

Inspect the registered definition and runtime state with:

```powershell
Get-ScheduledTask -TaskName "HireX Gmail Incremental Sync"
Get-ScheduledTaskInfo -TaskName "HireX Gmail Incremental Sync"
```

Manual triggering is intentionally deferred until after review. The later test command will be:

```powershell
Start-ScheduledTask -TaskName "HireX Gmail Incremental Sync"
```

Remove only the HireX Gmail task with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\uninstall-gmail-scheduler-task.ps1"
```

The Next.js application itself must remain running for the localhost scheduler endpoint to work. Currently that means starting `npm run dev` manually. A later W3 phase may use `npm run build`, `npm run start`, and a separate Windows startup/service mechanism; W2 does not configure application autostart.

A future VPS migration changes only the application runtime and external scheduler configuration. The Gmail incremental synchronization core and internal endpoint remain unchanged.
