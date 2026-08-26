# Windows Gmail Scheduler Runner

This project includes a server-local PowerShell runner for the internal Gmail incremental sync endpoint. It performs one endpoint invocation and does not contain or accept the scheduler secret as a command-line argument.

## Application runtime

For development testing, start the application with:

```powershell
npm run dev
```

For the current stable-local validation sequence:

1. Stop the currently running `npm run dev` process.
2. Build the production application with `npm run build`.
3. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-hirex-local-app.ps1"`.
4. Verify `http://127.0.0.1:3000` in the browser.

This attached terminal sequence remains useful for maintenance and manual validation. Normal local operation now uses the installed login-start task described below.

The production runner resolves the project root from its own location, requires an existing `.next/BUILD_ID`, and invokes the existing `npm.cmd run start` project command with `--hostname 127.0.0.1 --port 3000`. Local Windows mode intentionally binds only to IPv4 loopback and does not expose the application to the LAN. The runner neither builds nor installs dependencies and does not read or print `.env.local`; Next.js performs its normal environment loading.

The production runtime and W3B login-start behavior have passed live validation. The application must be running before the scheduler runner can reach its local endpoint.

## Runner

The runner is:

```text
scripts/run-gmail-incremental-sync.ps1
```

It resolves the project root from its own location and reads `AUTOMATION_CRON_SECRET` from the ignored project-root `.env.local`. By default it calls:

```text
http://127.0.0.1:3000/api/internal/gmail/incremental-sync
```

A server-local `GMAIL_INCREMENTAL_SYNC_URL` environment variable may override that URL. Neither the URL nor secret is accepted as a command-line argument.

Exit codes are `0` for a successful run with no failed accounts, `1` for configuration/network/HTTP/malformed-response failures, and `2` when the endpoint ran successfully but one or more accounts failed. Busy/skipped accounts alone do not produce exit code `2`.

## Windows Task Scheduler

The Windows task `HireX Gmail Incremental Sync` is installed and has passed live testing. It runs every five minutes, and its observed `LastTaskResult` has been confirmed as `0`.

The task runs for the current Windows user only while that user is logged on, ignores overlapping starts, and does not place the scheduler secret in the task definition.

For maintenance or a reviewed reinstall, run the installer only after removing the existing task:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-gmail-scheduler-task.ps1"
```

Inspect the registered definition and runtime state with:

```powershell
Get-ScheduledTask -TaskName "HireX Gmail Incremental Sync"
Get-ScheduledTaskInfo -TaskName "HireX Gmail Incremental Sync"
```

Remove only the HireX Gmail task with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\uninstall-gmail-scheduler-task.ps1"
```

The Gmail task recovered automatically after the validated Windows logout/login cycle. Its final observed health returned to `LastTaskResult = 0` with `NumberOfMissedRuns = 0`, and the safe diagnostic log recorded `SUCCESS` followed by `END exitCode=0`.

## HireX Local App autostart

The root task `\HireX Local App` is installed. It passed a manual `Start-ScheduledTask` live test and a full Windows logout/login test. After login, its state is `Running`, the application listens only on `127.0.0.1:3000`, and the web interface is accessible.

The task starts the attached production runner when the current Windows user logs on. It is a long-running process, uses an unlimited execution time, ignores overlapping starts, and retries an abnormal exit at most three times with a one-minute interval.

Install after review and after a successful `npm run build`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\install-hirex-local-app-task.ps1"
```

Inspect the definition and runtime state:

```powershell
Get-ScheduledTask -TaskName "HireX Local App" -TaskPath "\"
Get-ScheduledTaskInfo -TaskName "HireX Local App" -TaskPath "\"
```

Remove only the app autostart task with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\uninstall-hirex-local-app-task.ps1"
```

While the application is healthy, the task state will normally remain `Running`. `LastTaskResult` is not the primary health check while a long-running task is still active. Verify that `127.0.0.1:3000` is listening, the web application is accessible, and `HireX Gmail Incremental Sync` continues reporting `LastTaskResult = 0`.

Because both tasks use the interactive current-user session, Windows may terminate a running scheduler process during sign-out. On the next login, `HireX Local App` starts the production application automatically and `HireX Gmail Incremental Sync` resumes on its next scheduled five-minute cycle.

Final W3B health validation: **PASS**. App autostart, loopback binding, web access, Gmail scheduler recovery, zero missed runs, and safe diagnostic success were all confirmed.

For a reviewed code update: stop or restart the app task through the maintenance flow, run `npm run build`, then start the app task again. W3B does not implement automatic deployment or updates.

A future VPS migration will configure its reverse proxy and network exposure separately. It changes only the application runtime and external scheduler configuration; the Gmail incremental synchronization core and internal endpoint remain unchanged.
