# One-shot release of migration 069 (AI Recruiter AUTO gates) plus the matching app code.
# Run from an elevated-or-normal PowerShell on the HireX host:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Admin\hirex-sales-agent\scripts\deploy-auto-gates.ps1
#
# Order (stops at the first problem; production is touched only in step 5):
#   1. Commit all current work to git (refuses if secrets, logs or runtime files would be committed)
#   2. Run the unit test for the AUTO executor change
#   3. Build the new release into .next-auto-gates (Next.js also type-checks here)
#   4. Dry-run the migration and require that 069 is the ONLY pending migration
#   5. deploy-recruiter-tone.ps1 -Release auto-gates -MigrateDatabase
#      (waits for the email scheduler, stops web, applies 069, swaps build, restarts, checks /login)
#   6. Confirm 069 is recorded remotely and push the commit to GitHub
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\hirex-sales-agent'
$release = 'auto-gates'
Set-Location -LiteralPath $root

function Step([string]$text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail([string]$text) { Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue; Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }
# Windows PowerShell 5.1 turns redirected stderr of native tools into terminating errors
# under ErrorActionPreference=Stop; the Supabase CLI writes progress to stderr.
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
  git commit -q -m 'Snapshot: AI Recruiter, Human documents, migrations 049-069, worker backoff, docs' -m 'Includes migration 069 (AI Recruiter AUTO gates) and the executor change it requires.'
  if ($LASTEXITCODE -ne 0) { Fail 'git commit failed' }
  Write-Host "Committed $(git rev-parse --short HEAD)"
} else {
  Write-Host 'Nothing new to commit.'
}

# 2. Unit test --------------------------------------------------------------
Step 'Unit test: AUTO actions without a human approver'
$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]") | Out-String).Trim()
if ($nodeMajor -lt 22) {
  Write-Host "WARNING: Node $nodeMajor cannot run .ts imports in tests; skipping. Upgrade to Node 22.18+ for unit tests." -ForegroundColor Yellow
} else {
  $test = Capture 'node' @('--test','tests/outbound-auto-approver.test.mjs')
  if ($test.Code -ne 0) { $test = Capture 'node' @('--experimental-strip-types','--no-warnings','--test','tests/outbound-auto-approver.test.mjs') }
  Write-Host $test.Text
  if ($test.Code -ne 0) { Fail 'Unit test failed. Nothing was deployed.' }
}

# 3. Build ------------------------------------------------------------------
Step "Build into .next-$release"
if (Test-Path -LiteralPath "$root\.next-before-$release") { Fail ".next-before-$release already exists (an earlier deploy of this release). Rename it, then run again." }
$changedSource = @(git status --porcelain -- src supabase package.json next.config.ts)
if ((Test-Path -LiteralPath "$root\.next-$release\BUILD_ID") -and $changedSource.Count -eq 0) {
  # A previous run already built this commit (it stopped later, at the migration check).
  Write-Host "Reusing existing build .next-$release (no source changes since the last commit)."
} else {
  if (Test-Path -LiteralPath "$root\.next-$release") { Fail ".next-$release exists but source files changed since it was built. Delete .next-$release, then run again." }
  $env:HIREX_BUILD_DIR = ".next-$release"
  try { npm run build; $buildExit = $LASTEXITCODE } finally { Remove-Item Env:HIREX_BUILD_DIR -ErrorAction SilentlyContinue }
  if ($buildExit -ne 0 -or -not (Test-Path -LiteralPath "$root\.next-$release\BUILD_ID")) { Fail 'Build failed. Nothing was deployed.' }
}

# 4. Migration dry run ------------------------------------------------------
Step 'Supabase: which migrations are pending?'
# The CLI reads SUPABASE_DB_PASSWORD; asking here avoids a hidden prompt while output is captured.
$secure = Read-Host -AsSecureString 'Supabase database password (press Enter if the CLI does not ask for one)'
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($plain) { $env:SUPABASE_DB_PASSWORD = $plain }
$plain = $null
$result = Capture 'npx.cmd' @('supabase','db','push','--dry-run')
$dry = $result.Text
Write-Host $dry
if ($result.Code -ne 0) { Fail 'supabase db push --dry-run failed (login / link / password?). Nothing was deployed.' }
$pending = @([regex]::Matches($dry, '\b(\d{3})_[A-Za-z0-9_]+\.sql') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
if ($pending.Count -eq 0) { Fail 'No pending migration found. Either 069 is already applied or the CLI output changed; check manually.' }
# 067 and 068 may already exist remotely if they were applied by hand (outside `supabase db push`).
# Both are safe to re-run: 067 is `create or replace function`, 068 checks for its own guard first.
$allowed = @('067','068','069')
$unexpected = @($pending | Where-Object { $allowed -notcontains $_ })
if ($unexpected.Count -gt 0 -or $pending -notcontains '069') { Fail ("Unexpected pending migrations: " + ($pending -join ', ') + '. Expected 069, optionally with 067/068.') }
Confirm ("Pending: " + ($pending -join ', ') + ". Stop the web app briefly, apply them and switch to the new build?")

# 5. Deploy -----------------------------------------------------------------
Step 'Deploy (web will be down for a short time)'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\deploy-recruiter-tone.ps1" -Release $release -MigrateDatabase
if ($LASTEXITCODE -ne 0) { Fail 'Deploy script reported a failure. Read its output above; the previous build is kept as .next or .next-before-auto-gates.' }

# 6. Verify and push --------------------------------------------------------
Step 'Verify migration history'
$list = (Capture 'npx.cmd' @('supabase','migration','list')).Text
Write-Host $list
if ($list -notmatch '069\s*\|\s*069') { Write-Host 'WARNING: 069 not shown as applied remotely. Check the Supabase dashboard.' -ForegroundColor Yellow }

Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue

Step 'Push commit to GitHub'
git push origin HEAD
if ($LASTEXITCODE -ne 0) { Write-Host 'WARNING: git push failed; the commit is safe locally. Push it later.' -ForegroundColor Yellow }

Write-Host ''
Write-Host 'DONE. Next: in /settings/ai-recruiter switch one test conversation to DRAFT and back to AUTO,' -ForegroundColor Green
Write-Host 'then check audit_logs for AI_RECRUITER_CONVERSATION_MODE_CHANGED with your name.' -ForegroundColor Green
