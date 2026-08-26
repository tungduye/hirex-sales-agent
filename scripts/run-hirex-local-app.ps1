$ErrorActionPreference = "Stop"

try {
    $projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    $packageJsonPath = Join-Path $projectRoot "package.json"
    $buildMarkerPath = Join-Path $projectRoot ".next\BUILD_ID"

    if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
        Write-Output "error=Project package.json was not found."
        exit 1
    }
    if (-not (Test-Path -LiteralPath $buildMarkerPath -PathType Leaf)) {
        Write-Output "error=Production build is missing. Run npm run build first."
        exit 1
    }

    Set-Location -LiteralPath $projectRoot
    Write-Output "runtime=production"
    Write-Output ("projectRoot={0}" -f $projectRoot)
    Write-Output "command=npm run start -- --hostname 127.0.0.1 --port 3000"

    & npm.cmd run start -- --hostname 127.0.0.1 --port 3000
    if ($null -eq $LASTEXITCODE) { exit 1 }
    exit $LASTEXITCODE
} catch {
    Write-Output "error=Production runtime could not be started."
    exit 1
}
