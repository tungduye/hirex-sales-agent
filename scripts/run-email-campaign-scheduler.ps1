$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$endpoint = "http://127.0.0.1:3000/api/internal/email-campaigns/process"
$secret = $null
$headers = $null
try {
    $envFile = Join-Path $projectRoot ".env.local"
    if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "CONFIG_UNAVAILABLE" }
    $matches = @(Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*AUTOMATION_CRON_SECRET\s*=' })
    if ($matches.Count -ne 1) { throw "CONFIG_UNAVAILABLE" }
    $secret = ($matches[0] -replace '^\s*AUTOMATION_CRON_SECRET\s*=\s*','').Trim().Trim('"').Trim("'")
    if ([string]::IsNullOrWhiteSpace($secret)) { throw "CONFIG_UNAVAILABLE" }
    $headers = @{ Authorization = "Bearer $secret" }
    $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -TimeoutSec 240
    if ($response.success -eq $false) { exit 2 }
    Write-Output "campaignScheduler=success"
    exit 0
} catch {
    Write-Output "campaignScheduler=unavailable"
    exit 1
} finally {
    $secret = $null; $matches = $null; $headers = $null
}
