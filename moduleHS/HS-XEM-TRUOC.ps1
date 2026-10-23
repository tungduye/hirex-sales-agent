# Ban xem truoc HireX (moduleHS) cong 3005 = app2.hirexmkt.online, cung code + database voi ban that.
# - Mac dinh chay BAN BUILD ("next start"): mo trang ngay, khong phu thuoc cache Turbopack (cache hong / mat cache = trang treo hang chuc phut).
#   Tu theo doi src / moduleHS / public: co thay doi va yen 60 giay -> build ngam vao o con lai runtime\hs-preview\a|b (van phuc vu ban cu),
#   build xong thi doi sang ban moi trong vai giay; build loi thi giu ban cu (xem runtime\hs-preview-build.log).
#   Lan dau chua co ban build: chep tam ban that (.next) de mo duoc ngay, roi build ban xem truoc.
# - -Dev: chay "next dev" nhu cu (tu cap nhat tung file, nhung lan dau / mat cache rat cham).
# - Tu chay lai: server tat / loi -> bat lai sau 5 giay; task "HireX HS Preview" chay khi khoi dong may (khong can dang nhap) va khi dang nhap,
#   khong bao gio chay 2 ban cung luc (khoa Global\HireXHSPreview).
# - Tam nghi khi release.ps1 / restart-web.ps1 dang chay (runtime\web-maintenance.flag) de khong vuong deploy cua anh Tung.
# - Ban that (cong 3000, app.hirexmkt.online) khong bi dung toi.  Dia chi: runtime\hs-preview.txt ; log: runtime\hs-preview.log
param([switch]$Install, [switch]$Dev)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$task = 'HireX HS Preview'
$runtime = Join-Path $root 'runtime'
$info = Join-Path $runtime 'hs-preview.txt'

if ($Install) {
  "install start $((Get-Date).ToString('o')) user=$([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
  try {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`"" -WorkingDirectory $root
    $triggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -AtLogOn -User $me))
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    # S4U: chay ca khi chua ai dang nhap (may vua khoi dong lai), khong can luu mat khau
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $task -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
    "task=ok (khoi dong may + dang nhap, tu chay lai 999 lan)"
  } catch { "task=FAILED $($_.Exception.Message)" }
  try {
    if (-not (Get-NetFirewallRule -DisplayName 'HireX HS Preview 3005' -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName 'HireX HS Preview 3005' -Direction Inbound -Protocol TCP -LocalPort 3005 -RemoteAddress LocalSubnet -Action Allow -Profile Any -ErrorAction Stop | Out-Null
    }
    "firewall=ok"
  } catch { "firewall=FAILED $($_.Exception.Message)" }
  # FFmpeg cho muc Tien ich > Cuoc hop (ghep / nen audio). Cai bang winget neu may chua co.
  $ff = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
  if ((Get-Command ffmpeg -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath $ff)) { "ffmpeg=already" }
  else {
    try { winget install --id Gyan.FFmpeg -e --silent --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Select-Object -Last 5; "ffmpeg=" + $(if (Test-Path -LiteralPath $ff) { 'ok' } else { 'check' }) }
    catch { "ffmpeg=FAILED $($_.Exception.Message)" }
  }
  # dung ban dang chay (neu co) roi bat lai bang ban script moi
  try { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue } catch { }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'next' -and $_.CommandLine -match '3005' } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F 2>&1 | Out-Null }
  Start-Sleep -Seconds 2
  try { Start-ScheduledTask -TaskName $task -ErrorAction Stop; "start=ok" } catch { "start=FAILED $($_.Exception.Message)" }
  Start-Sleep -Seconds 5
  if (Test-Path -LiteralPath $info) { Get-Content -LiteralPath $info }
  "install done $((Get-Date).ToString('o'))"
  return
}

# chi 1 ban chay (task khoi dong may + task dang nhap + chay tay)
$mutex = New-Object System.Threading.Mutex($false, 'Global\HireXHSPreview')
try { if (-not $mutex.WaitOne(0)) { exit 0 } } catch [System.Threading.AbandonedMutexException] { }

Set-Location -LiteralPath $root
New-Item -ItemType Directory -Force $runtime | Out-Null
$flag = Join-Path $runtime 'web-maintenance.flag'
$log = Join-Path $runtime 'hs-preview.log'
$blog = Join-Path $runtime 'hs-preview-build.log'
$env:NEXT_TELEMETRY_DISABLED = '1'
function L([string]$m) { Add-Content -LiteralPath $log -Value "[$(Get-Date -Format s)] $m" }
function Rotate([string]$f) { if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).Length -gt 20MB) { Move-Item -LiteralPath $f -Destination "$f.old" -Force } }
function WriteInfo([string]$mode) {
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -ExpandProperty IPAddress)
  Set-Content -LiteralPath $info -Encoding UTF8 -Value @("started=$((Get-Date).ToString('o'))", "mode=$mode", ("urls=" + (($ips | ForEach-Object { "http://${_}:3005" }) -join ' ')))
}
function StopTree($p) { if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null } }

if ($Dev) {   # che do cu: next dev
  $env:HIREX_BUILD_DIR = 'runtime/hs-preview/next'
  while ($true) {
    while (Test-Path -LiteralPath $flag) { Start-Sleep -Seconds 10 }
    Rotate $log; WriteInfo 'dev'
    L 'start next dev :3005'
    & cmd.exe /c "npx.cmd next dev -p 3005 -H 0.0.0.0 >> `"$log`" 2>&1"
    L "next dev stopped (exit $LASTEXITCODE)"
    Start-Sleep -Seconds 30
  }
}

# 2 o build xen ke (a / b): build vao o dang KHONG phuc vu, xong thi chuyen server sang o do -> khong doi ten thu muc dang dung,
# moi ban build chay dung thu muc no duoc build ra (distDir khop).
$slotFile = Join-Path $runtime 'hs-preview\slot.txt'
$stampFile = Join-Path $runtime 'hs-preview\slot.stamp'
New-Item -ItemType Directory -Force (Join-Path $runtime 'hs-preview') | Out-Null
# don cache cua che do dev cu (~300 MB), che do build khong dung toi
$devCache = Join-Path $runtime 'hs-preview\next'
if (Test-Path -LiteralPath $devCache) { Remove-Item -LiteralPath $devCache -Recurse -Force -ErrorAction SilentlyContinue }
function SlotRel([string]$s) { "runtime/hs-preview/$s" }
function SlotDir([string]$s) { Join-Path $root "runtime\hs-preview\$s" }
function Other([string]$s) { if ($s -eq 'a') { 'b' } else { 'a' } }
# moc thay doi moi nhat cua ma nguon (ticks UTC). tsconfig.json / next-env.d.ts bo qua: chinh lenh build tu sua 2 file nay.
function Stamp {
  $dirs = @('src', 'moduleHS', 'public') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ }
  $files = @(Get-ChildItem -LiteralPath $dirs -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(node_modules|_src_python|__pycache__|_fbdebug)\\' -and $_.Extension -notmatch '^\.(log|pyc)$' })
  $files += @('package.json', 'package-lock.json', 'next.config.ts', 'postcss.config.mjs') | ForEach-Object { Get-Item -LiteralPath (Join-Path $root $_) -ErrorAction SilentlyContinue }
  $m = ($files | ForEach-Object { $_.LastWriteTimeUtc.Ticks } | Measure-Object -Maximum).Maximum
  if ($m) { return [long]$m } else { return 0L }
}
function StartServer([string]$slot) {
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "set HIREX_BUILD_DIR=$(SlotRel $slot)&& npx.cmd next start -p 3005 -H 0.0.0.0 >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $null = $p.Handle; return $p
}
function StartBuild([string]$slot) {
  $d = SlotDir $slot
  if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
  Rotate $blog; Add-Content -LiteralPath $blog -Value "[$(Get-Date -Format s)] build bat dau (o $slot)"
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "set HIREX_BUILD_DIR=$(SlotRel $slot)&& npx.cmd next build >> `"$blog`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $null = $p.Handle; return $p
}
$cur = 'a'; if (Test-Path -LiteralPath $slotFile) { $cur = ((Get-Content -LiteralPath $slotFile -Raw) + '').Trim(); if ($cur -ne 'b') { $cur = 'a' } }
$built = 0L; if (Test-Path -LiteralPath $stampFile) { try { $built = [long]((Get-Content -LiteralPath $stampFile -Raw).Trim()) } catch { $built = 0L } }
$failed = -1L; $bp = $null; $bslot = ''; $bstamp = 0L; $fast = 0
function Ready([string]$slot) { Test-Path -LiteralPath (Join-Path (SlotDir $slot) 'BUILD_ID') }

while ($true) {
  while (Test-Path -LiteralPath $flag) { Start-Sleep -Seconds 10 }
  Rotate $log
  if (-not (Ready $cur) -and (Ready (Other $cur))) { $cur = Other $cur; Set-Content -LiteralPath $slotFile -Value $cur }
  if (-not (Ready $cur) -and -not $script:copied -and (Test-Path -LiteralPath (Join-Path $root '.next\BUILD_ID'))) {
    $script:copied = $true
    L 'chua co ban build xem truoc: chep tam ban that (.next) de mo duoc ngay, roi build ban xem truoc'
    & robocopy.exe (Join-Path $root '.next') (SlotDir $cur) /E /XD cache /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    $built = 0L
  }
  if (-not (Ready $cur)) {
    if (-not $bp) { L 'chua co ban build nao: build lan dau'; $bstamp = Stamp; $bslot = $cur; $bp = StartBuild $cur }
    $bp.WaitForExit()
    if ($bp.ExitCode -eq 0 -and (Ready $bslot)) { $cur = $bslot; $built = $bstamp; Set-Content -LiteralPath $slotFile -Value $cur; Set-Content -LiteralPath $stampFile -Value $built; Remove-Item -LiteralPath (SlotDir (Other $cur)) -Recurse -Force -ErrorAction SilentlyContinue }
    else { L "build lan dau loi (exit $($bp.ExitCode)) - thu lai sau 60 giay"; Start-Sleep -Seconds 60 }
    $bp = $null; continue
  }
  WriteInfo "build $cur"
  $sp = StartServer $cur; $t0 = Get-Date; L "start next start :3005 (o $cur, pid $($sp.Id))"
  $nextCheck = (Get-Date).AddSeconds(20)
  while ($true) {
    Start-Sleep -Seconds 10
    if ($sp.HasExited) {
      L "next start stopped (exit $($sp.ExitCode))"
      if (((Get-Date) - $t0).TotalSeconds -lt 40) { $fast++ } else { $fast = 0 }
      if ($fast -ge 2) {   # tat ngay sau khi bat: cong 3005 bi chiem -> giai phong; van loi (ban build hong / ban chep tam khong chay) -> build lai
        Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { & taskkill.exe /PID $_.OwningProcess /T /F 2>&1 | Out-Null }
        if ($fast -ge 3 -or $built -eq 0) { L "ban build o $cur khong chay duoc: build lai"; StopTree $bp; $bp = $null; Remove-Item -LiteralPath (SlotDir $cur) -Recurse -Force -ErrorAction SilentlyContinue; $fast = 0 }
      }
      break
    }
    if (Test-Path -LiteralPath $flag) { L 'tam nghi: dang release ban that'; StopTree $sp; StopTree $bp; $bp = $null; break }
    if ($bp) {
      if (-not $bp.HasExited) { continue }
      if ($bp.ExitCode -eq 0 -and (Ready $bslot)) {
        L "build xong: chuyen sang ban moi (o $bslot)"
        StopTree $sp; $old = $cur; $cur = $bslot; $built = $bstamp
        Set-Content -LiteralPath $slotFile -Value $cur; Set-Content -LiteralPath $stampFile -Value $built
        Start-Sleep -Seconds 2; Remove-Item -LiteralPath (SlotDir $old) -Recurse -Force -ErrorAction SilentlyContinue   # chi giu 1 ban build
        $bp = $null; break
      }
      L "build loi (exit $($bp.ExitCode)) - giu ban dang chay, xem runtime\hs-preview-build.log"; $failed = $bstamp; $bp = $null; continue
    }
    if ((Get-Date) -lt $nextCheck) { continue }
    $nextCheck = (Get-Date).AddSeconds(60)
    $st = Stamp
    if ($st -ne $built -and $st -ne $failed -and ([DateTime]::UtcNow.Ticks - $st) -gt [TimeSpan]::FromSeconds(60).Ticks) {
      L 'co thay doi ma nguon: build ngam'; $bstamp = $st; $bslot = Other $cur; $bp = StartBuild $bslot
    }
  }
  Start-Sleep -Seconds 3
}
