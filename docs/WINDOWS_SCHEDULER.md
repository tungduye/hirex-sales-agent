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

Keep the terminal and attached application runner open: W3A does not add application autostart. While the production application remains running, the existing Gmail scheduler task continues calling the localhost endpoint automatically.

The production runner resolves the project root from its own location, requires an existing `.next/BUILD_ID`, and invokes the existing `npm.cmd run start` project command with `--hostname 127.0.0.1 --port 3000`. Local Windows mode intentionally binds only to IPv4 loopback and does not expose the application to the LAN. The runner neither builds nor installs dependencies and does not read or print `.env.local`; Next.js performs its normal environment loading.

W3B will prepare a login-start task only after this production runtime has passed live validation. The application must be running before the scheduler runner is invoked.

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

The Next.js application itself must still be started manually and remain running for the localhost scheduler endpoint to work. W3A is preparing and validating the local production runtime; it does not configure application autostart. W3B will create the application login-start task.

A future VPS migration will configure its reverse proxy and network exposure separately. It changes only the application runtime and external scheduler configuration; the Gmail incremental synchronization core and internal endpoint remain unchanged.
