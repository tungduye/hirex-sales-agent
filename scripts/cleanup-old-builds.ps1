# Frees disk space taken by old Next.js builds of HireX.
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Admin\hirex-sales-agent\scripts\cleanup-old-builds.ps1 [-Keep 2] [-Yes]
#
# Every release keeps the previous build as .next-before-<name> (for rollback). They add up: each is
# several hundred MB. This keeps:
#   - .next                    the live build (never touched)
#   - the newest -Keep .next-before-* folders (rollback for the last releases)
# and deletes the older .next-before-* folders and leftover .next-<name> build folders that are
# not live (failed or abandoned builds). Nothing else is touched.
param([ValidateRange(1, 10)][int]$Keep = 2, [switch]$Yes)
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\hirex-sales-agent'

function FolderSize([string]$path) {
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if ($sum) { return [long]$sum } else { return 0L }
}
function Gb([long]$bytes) { '{0:N1} GB' -f ($bytes / 1GB) }
$drive = (Get-Item -LiteralPath $root).PSDrive
Write-Host ("Free space on {0}: before {1}" -f $drive.Name, (Gb $drive.Free)) -ForegroundColor Cyan

$folders = @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.next-*' })
$backups = @($folders | Where-Object { $_.Name -like '.next-before-*' } | Sort-Object LastWriteTime -Descending)
$keepBackups = @($backups | Select-Object -First $Keep)
$delete = @($backups | Select-Object -Skip $Keep) + @($folders | Where-Object { $_.Name -notlike '.next-before-*' })

if ($delete.Count -eq 0) { Write-Host 'Nothing to delete.'; exit 0 }
Write-Host ''
Write-Host 'Kept for rollback:' -ForegroundColor Green
$keepBackups | ForEach-Object { Write-Host ("  {0}  ({1:yyyy-MM-dd HH:mm})" -f $_.Name, $_.LastWriteTime) }
Write-Host ''
Write-Host 'Will delete:' -ForegroundColor Yellow
$total = 0L
foreach ($folder in $delete) {
  $size = FolderSize $folder.FullName
  $total += $size
  Write-Host ("  {0,-45} {1,10}  ({2:yyyy-MM-dd HH:mm})" -f $folder.Name, (Gb $size), $folder.LastWriteTime)
}
Write-Host ("Total: {0}" -f (Gb $total)) -ForegroundColor Yellow
if (-not $Yes) {
  $answer = Read-Host 'Delete these folders permanently? [y/N]'
  if ($answer -notmatch '^(y|yes)$') { Write-Host 'Cancelled. Nothing was deleted.'; exit 1 }
}
foreach ($folder in $delete) {
  Remove-Item -LiteralPath $folder.FullName -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $folder.FullName) { Write-Host "  Could not fully delete $($folder.Name) (file in use?)" -ForegroundColor Red }
}
$drive = (Get-Item -LiteralPath $root).PSDrive
Write-Host ("Free space on {0}: after {1}" -f $drive.Name, (Gb $drive.Free)) -ForegroundColor Cyan
