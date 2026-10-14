param([switch]$Once)
$ErrorActionPreference = "Stop"
$runtimeRoot = "C:\Users\Admin\AppData\Local\HireX\ZaloRuntime"
foreach ($name in @("HIREX_BRIDGE_SIGNING_SECRET", "DEPLAO_INTERNAL_SHARED_SECRET", "HIREX_ZALO_QA_ACCOUNT_ID")) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if ([string]::IsNullOrWhiteSpace($value)) { throw "EXISTING_CONFIG_MISSING_$name" }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $runtimeRoot "runtime-config.env"))) {
  if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) { continue }
  $pair = $line.Split("=", 2)
  if ($pair.Count -ne 2 -or $pair[0] -match "SECRET|TOKEN|PASSWORD") { throw "RUNTIME_CONFIG_INVALID" }
  [Environment]::SetEnvironmentVariable($pair[0], $pair[1], "Process")
}
if ($env:HIREX_DEPLAO_QA_USER_DATA_DIR -ne (Join-Path $runtimeRoot "deplao-qa-profile")) { throw "QA_PROFILE_CHANGED" }
if ($env:HIREX_REAL_INBOUND_CUTOVER_AT -ne "2026-09-17T17:07:11.795Z") { throw "CUTOVER_CHANGED" }
$env:HIREX_ZALO_CONTACT_ACTIONS_ENABLED = "true"
foreach ($name in @("HIREX_FACEBOOK_PROFILE_BRIDGE_ENABLED", "HIREX_FACEBOOK_PROFILE_BRIDGE_SECRET", "HIREX_FACEBOOK_PROFILE_ACCOUNT_IDS")) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if (-not [string]::IsNullOrWhiteSpace($value)) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
}
$env:NODE_ENV = "production"
$arguments = @("C:\Users\Admin\hirex-sales-agent\scripts\deplao-realtime-supervisor.mjs")
if ($Once) { $arguments += "--once" }
& (Get-Command node.exe).Source @arguments
exit $LASTEXITCODE
