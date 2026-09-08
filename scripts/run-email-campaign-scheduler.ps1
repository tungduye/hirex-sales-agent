$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectRoot "runtime"
$lockPath = Join-Path $runtimeDirectory "email-campaign-scheduler.lock"
$logPath = Join-Path $runtimeDirectory "email-campaign-scheduler.log"
$endpoint = "http://127.0.0.1:3000/api/internal/email-campaigns/process"
if (-not [string]::IsNullOrWhiteSpace($env:HIREX_CAMPAIGN_SCHEDULER_URL)) {
    $candidate = $null
    if (-not [Uri]::TryCreate($env:HIREX_CAMPAIGN_SCHEDULER_URL,[UriKind]::Absolute,[ref]$candidate) -or $candidate.Scheme -ne "http" -or $candidate.Host -ne "127.0.0.1") { throw "CONFIG_UNAVAILABLE" }
    $endpoint = $candidate.AbsoluteUri
}
$secret = $null
$headers = $null
$lockStream = $null
$exitCode = 1
function Write-SafeLog([string]$Result,[int]$Code) { try { New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null; Add-Content -LiteralPath $logPath -Value "timestamp=$([DateTime]::UtcNow.ToString('o')) result=$Result exitCode=$Code" } catch {} }
try {
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    try { $lockStream = [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { Write-SafeLog "OVERLAP_SKIPPED" 0; exit 0 }
    $envFile = Join-Path $projectRoot ".env.local"
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "CONFIG_UNAVAILABLE" }
    $matches = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*AUTOMATION_CRON_SECRET\s*=' })
    if ($matches.Count -ne 1) { throw "CONFIG_UNAVAILABLE" }
    $secret = ($matches[0] -replace '^\s*AUTOMATION_CRON_SECRET\s*=\s*','').Trim().Trim('"').Trim("'")
    if ([string]::IsNullOrWhiteSpace($secret)) { throw "CONFIG_UNAVAILABLE" }
    $headers = @{ Authorization = "Bearer $secret" }
    if ($env:HIREX_SCHEDULER_DRY_RUN -eq "1") { $headers["X-HireX-Dry-Run"] = "1" }
    $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -TimeoutSec 240
    if ($response.success -eq $false) { $exitCode=2; Write-SafeLog "WORKER_FAILURE" $exitCode; exit $exitCode }
    $exitCode=0; Write-SafeLog $(if($env:HIREX_SCHEDULER_DRY_RUN -eq "1"){"DRY_RUN_SUCCESS"}else{"SUCCESS"}) $exitCode; exit $exitCode
} catch { Write-SafeLog "UNAVAILABLE" $exitCode; exit $exitCode } finally { $secret=$null;$matches=$null;$headers=$null;if($lockStream){$lockStream.Dispose()};Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue }
