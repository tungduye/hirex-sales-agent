$ErrorActionPreference = "Stop"

$defaultEndpointUrl = "http://127.0.0.1:3000/api/internal/gmail/incremental-sync"
$timeoutSeconds = 240
$exitCode = 1
$cronSecret = $null
$secretMatches = $null
$requestHeaders = $null

function Write-SafeSummary {
    param([Parameter(Mandatory = $true)] $Response)

    Write-Output ("timestamp={0}" -f [DateTimeOffset]::UtcNow.ToString("o"))
    Write-Output ("success={0}" -f $Response.success)
    Write-Output ("accountsConsidered={0}" -f $Response.accountsConsidered)
    Write-Output ("accountsProcessed={0}" -f $Response.accountsProcessed)
    Write-Output ("accountsCompleted={0}" -f $Response.accountsCompleted)
    Write-Output ("accountsRemaining={0}" -f $Response.accountsRemaining)
    Write-Output ("accountsSkipped={0}" -f $Response.accountsSkipped)
    Write-Output ("accountsFailed={0}" -f $Response.accountsFailed)
    Write-Output ("historyPagesProcessed={0}" -f $Response.historyPagesProcessed)

}

function Test-SchedulerResponse {
    param([Parameter(Mandatory = $true)] $Response)

    $requiredProperties = @(
        "success",
        "accountsConsidered",
        "accountsProcessed",
        "accountsCompleted",
        "accountsRemaining",
        "accountsSkipped",
        "accountsFailed",
        "historyPagesProcessed"
    )
    foreach ($property in $requiredProperties) {
        if ($Response.PSObject.Properties.Name -notcontains $property) { return $false }
    }
    if ($Response.success -isnot [bool]) { return $false }
    foreach ($property in $requiredProperties | Where-Object { $_ -ne "success" }) {
        $parsedValue = 0L
        if (-not [long]::TryParse([string]$Response.$property, [ref]$parsedValue) -or $parsedValue -lt 0) { return $false }
    }
    return $true
}

try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $environmentFile = Join-Path $projectRoot ".env.local"
    if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
        throw [System.InvalidOperationException]::new("Scheduler configuration is missing.")
    }

    $secretMatches = @(Get-Content -LiteralPath $environmentFile | Where-Object { $_ -match '^\s*AUTOMATION_CRON_SECRET\s*=' })
    if ($secretMatches.Count -ne 1) {
        throw [System.InvalidOperationException]::new("AUTOMATION_CRON_SECRET must be configured exactly once in .env.local.")
    }
    $cronSecret = ($secretMatches[0] -replace '^\s*AUTOMATION_CRON_SECRET\s*=\s*', '').Trim()
    if ($cronSecret.Length -ge 2 -and (($cronSecret.StartsWith('"') -and $cronSecret.EndsWith('"')) -or ($cronSecret.StartsWith("'") -and $cronSecret.EndsWith("'")))) {
        $cronSecret = $cronSecret.Substring(1, $cronSecret.Length - 2)
    }
    if ([string]::IsNullOrWhiteSpace($cronSecret)) {
        throw [System.InvalidOperationException]::new("AUTOMATION_CRON_SECRET is blank in .env.local.")
    }

    $endpointUrl = if ([string]::IsNullOrWhiteSpace($env:GMAIL_INCREMENTAL_SYNC_URL)) {
        $defaultEndpointUrl
    } else {
        $env:GMAIL_INCREMENTAL_SYNC_URL.Trim()
    }
    $parsedEndpoint = $null
    if (-not [Uri]::TryCreate($endpointUrl, [UriKind]::Absolute, [ref]$parsedEndpoint) -or $parsedEndpoint.Scheme -notin @("http", "https")) {
        throw [System.InvalidOperationException]::new("GMAIL_INCREMENTAL_SYNC_URL is invalid.")
    }

    $requestHeaders = @{ Authorization = "Bearer $cronSecret" }
    try {
        $response = Invoke-RestMethod -Uri $parsedEndpoint.AbsoluteUri -Method Post -Headers $requestHeaders -TimeoutSec $timeoutSeconds
    } catch {
        $statusCode = $null
        if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 401) {
            Write-Output "error=Scheduler authorization failed."
        } else {
            Write-Output "error=Gmail incremental scheduler endpoint is unavailable."
        }
        $exitCode = 1
        $response = $null
    }

    if ($null -ne $response) {
        if (-not (Test-SchedulerResponse -Response $response)) {
            Write-Output "error=Gmail incremental scheduler returned a malformed response."
            $exitCode = 1
        } else {
            Write-SafeSummary -Response $response
            if (-not $response.success) {
                $exitCode = 1
            } elseif ([long]$response.accountsFailed -gt 0) {
                $exitCode = 2
            } else {
                $exitCode = 0
            }
        }
    }
} catch {
    Write-Output ("error={0}" -f $_.Exception.Message)
    $exitCode = 1
} finally {
    $cronSecret = $null
    $secretMatches = $null
    $requestHeaders = $null
    Remove-Variable cronSecret, secretMatches, requestHeaders -ErrorAction SilentlyContinue
}

exit $exitCode
