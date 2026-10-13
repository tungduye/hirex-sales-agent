# Reusable one-command release for the HireX host.
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Admin\hirex-sales-agent\scripts\release.ps1 -Release <name> [-ExpectMigrations 070,071]
#
#   1. Commit all current work (refuses secrets, logs, runtime/ and build folders)
#   2. Run unit tests (npm test)
#   3. Build into .next-<name> (reused if already built after the last source commit)
#   4. Dry-run migrations. With no -ExpectMigrations, any pending migration stops the release.
#      With -ExpectMigrations, exactly those may be pending.
#   5. deploy-recruiter-tone.ps1: waits for the email scheduler, stops web, applies migrations (if any),
#      swaps .next, restarts, checks /login. The previous build is kept as .next-before-<name>.
#   6. Push to GitHub
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]{1,40}$')][string]$Release,
  [string[]]$ExpectMigrations = @(),
  [string]$Message = ''
)
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\hirex-sales-agent'
Set-Location -LiteralPath $root

function Step([string]$text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail([string]$text) { Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }
# Windows PowerShell 5.1 turns redirected stderr of native tools into terminating errors under
# ErrorActionPreference=Stop; the Supabase CLI and node:test write to stderr.
function Capture([string]$exe, [string[]]$arguments) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $text = (& $exe @arguments 2>&1 | ForEach-Object { "$_" } | Out-String); $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  return @{ Text = $text; Code = $code }
}
function Confirm([string]$question) {
  $answer = Read-Host "$question [y/N]"
  if ($answer -notmatch '^(y|yes)$') { Fail 'Cancelled by operator. Nothing was deployed.' }
}

# 1. Commit -----------------------------------------------------------------
Step 'Git: commit current work'
git add -A
if ($LASTEXITCODE -ne 0) { Fail 'git add failed' }
$staged = @(git diff --cached --name-only)
$forbidden = @($staged | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -ne '.env.example' -or $_ -match '\.log$' -or $_ -match '^runtime/' -or $_ -match '^\.next' -or $_ -match '^playwright/\.auth/' })
if ($forbidden.Count -gt 0) {
  git reset -q
  Fail ("These files must not be committed (check .gitignore):`n  " + ($forbidden -join "`n  "))
}
if ($staged.Count -gt 0) {
  Write-Host "$($staged.Count) file(s) will be committed. First 40:"
  $staged | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" }
  Confirm 'Commit these files?'
  $subject = if ($Message) { $Message } else { "Release $Release" }
  git commit -q -m $subject
  if ($LASTEXITCODE -ne 0) { Fail 'git commit failed' }
  Write-Host "Committed $(git rev-parse --short HEAD)"
} else {
  Write-Host 'Nothing new to commit.'
}

# 2. Unit tests -------------------------------------------------------------
Step 'Unit tests'
$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]") | Out-String).Trim()
if ($nodeMajor -lt 22) { Fail "Node $nodeMajor is too old for the unit tests (need 22.18+). Upgrade Node, then run again." }
$test = Capture 'node' @('--test', 'tests/*.test.mjs')
$summary = ($test.Text -split "`n" | Where-Object { $_ -match '^# (tests|pass|fail) ' }) -join '  '
Write-Host $summary
if ($test.Code -ne 0) {
  Write-Host ($test.Text -split "`n" | Where-Object { $_ -match '^not ok|Error' } | Select-Object -First 20 | Out-String)
  Fail 'Unit tests failed. Nothing was deployed.'
}

# 3. Build ------------------------------------------------------------------
Step "Build into .next-$Release"
if (Test-Path -LiteralPath "$root\.next-before-$Release") { Fail ".next-before-$Release already exists (an earlier deploy with this name). Pick another -Release name." }
# Reuse an existing build only if no commit touched the app source after it was built.
# (tsconfig.json is left out: next build rewrites it on its own.)
$buildMarker = "$root\.next-$Release\BUILD_ID"
$reuse = $false
if (Test-Path -LiteralPath $buildMarker) {
  $lastSourceCommit = [DateTimeOffset]::FromUnixTimeSeconds([long](git log -1 --format=%ct -- src supabase package.json package-lock.json next.config.ts)).UtcDateTime
  $reuse = (Get-Item -LiteralPath $buildMarker).LastWriteTimeUtc -gt $lastSourceCommit
}
if ($reuse) {
  Write-Host "Reusing existing build .next-$Release (built after the last source commit)."
} else {
  if (Test-Path -LiteralPath "$root\.next-$Release") {
    if (Test-Path -LiteralPath $buildMarker) { Fail ".next-$Release is older than the latest source commit. Delete it, then run again." }
    # No BUILD_ID: left over from a failed build of this release, never deployed.
    Remove-Item -LiteralPath "$root\.next-$Release" -Recurse -Force
  }
  # Turbopack reads files under runtime\ while tracing. The campaign schedulers hold their lock
  # files exclusively while they run, which makes the build fail ("being used by another process").
  # Hold both locks ourselves, readable by others, for the length of the build: the schedulers then
  # skip their run (OVERLAP_SKIPPED) and resume on the next tick.
  $lockNames = @('channel-campaign-scheduler.lock', 'email-campaign-scheduler.lock')
  $locks = @()
  try {
    foreach ($name in $lockNames) {
      $path = Join-Path "$root\runtime" $name
      $deadline = [DateTime]::UtcNow.AddMinutes(6)
      $stream = $null
      while (-not $stream) {
        try { $stream = [IO.File]::Open($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read) }
        catch {
          if ([DateTime]::UtcNow -gt $deadline) { Fail "A campaign scheduler has held $name for 6 minutes. Try again later." }
          Write-Host "Waiting for the running campaign scheduler to finish ($name)..."
          Start-Sleep -Seconds 5
        }
      }
      $locks += $stream
    }
    Write-Host 'Campaign schedulers paused for the build.'
    $buildExit = 1
    for ($attempt = 1; $attempt -le 2 -and $buildExit -ne 0; $attempt++) {
      if ($attempt -gt 1) {
        Write-Host 'Build hit a locked file; retrying once in 20 seconds...' -ForegroundColor Yellow
        Start-Sleep -Seconds 20
        Remove-Item -LiteralPath "$root\.next-$Release" -Recurse -Force -ErrorAction SilentlyContinue
      }
      Write-Host 'Building (usually 2-5 minutes; output is shown when it finishes)...'
      $env:HIREX_BUILD_DIR = ".next-$Release"
      try {
        $build = Capture 'npm.cmd' @('run', 'build')
        $buildExit = $build.Code
      } finally { Remove-Item Env:HIREX_BUILD_DIR -ErrorAction SilentlyContinue }
      Write-Host ($build.Text -split "`n" | Select-Object -Last 25 | Out-String)
      if ($buildExit -ne 0 -and $build.Text -notmatch 'being used by another process') { break }
    }
  } finally {
    foreach ($stream in $locks) { $stream.Dispose() }
  }
  if ($buildExit -ne 0 -or -not (Test-Path -LiteralPath $buildMarker)) {
    Remove-Item -LiteralPath "$root\.next-$Release" -Recurse -Force -ErrorAction SilentlyContinue
    Fail 'Build failed. Nothing was deployed.'
  }
}

# 4. Migrations -------------------------------------------------------------
Step 'Supabase: which migrations are pending?'
$secure = Read-Host -AsSecureString 'Supabase database password (press Enter if the CLI does not ask for one)'
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($plain) { $env:SUPABASE_DB_PASSWORD = $plain }
$plain = $null
$dry = Capture 'npx.cmd' @('supabase', 'db', 'push', '--dry-run')
Write-Host $dry.Text
if ($dry.Code -ne 0) { Fail 'supabase db push --dry-run failed (login / link / password?). Nothing was deployed.' }
$pending = @([regex]::Matches($dry.Text, '\b(\d{3})_[A-Za-z0-9_]+\.sql') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
$expected = @($ExpectMigrations | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
if (($pending -join ',') -ne ($expected -join ',')) {
  Fail ("Pending migrations [" + ($pending -join ', ') + "] do not match -ExpectMigrations [" + ($expected -join ', ') + "].")
}
$migrate = $pending.Count -gt 0
$what = if ($migrate) { "apply migrations $($pending -join ', ') and " } else { '' }
Confirm "Stop the web app briefly, $($what)switch to .next-$Release?"

# 5. Deploy -----------------------------------------------------------------
Step 'Deploy (web will be down for a short time)'
$deployArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$root\scripts\deploy-recruiter-tone.ps1", '-Release', $Release)
if ($migrate) { $deployArgs += '-MigrateDatabase' }
& powershell.exe @deployArgs
if ($LASTEXITCODE -ne 0) { Fail "Deploy script reported a failure. Read its output above; the previous build is kept as .next or .next-before-$Release." }
Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue

# 6. Push -------------------------------------------------------------------
Step 'Push commit to GitHub'
git push origin HEAD
if ($LASTEXITCODE -ne 0) { Write-Host 'WARNING: git push failed; the commit is safe locally. Push it later.' -ForegroundColor Yellow }

Write-Host ''
Write-Host "DONE. Release $Release is live. Roll back: stop task 'HireX Local App', rename .next, rename .next-before-$Release to .next, start the task." -ForegroundColor Green
