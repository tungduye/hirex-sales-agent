# ensure-worker.ps1
# Giữ cho worker AccountsHS (moduleHS/accountshs/worker/hs-accountshs-worker.py) luôn chạy trên host Windows.
# Theo mẫu ensure-deplao-realtime-supervisor.ps1: tìm tiến trình theo CommandLine, chưa chạy thì khởi động ẩn,
# ghi log vào runtime/. Chạy định kỳ (mỗi phút) qua Task Scheduler — idempotent, đang chạy thì thoát ngay.
$ErrorActionPreference = 'Stop'

$ScriptDir  = $PSScriptRoot
$Root       = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $ScriptDir))   # gốc repo HireX (moduleHS\accountshs\worker → ..\..\..)
$Worker     = Join-Path $ScriptDir 'hs-accountshs-worker.py'
$RuntimeDir = Join-Path $Root 'runtime'
$LogFile    = Join-Path $RuntimeDir 'hs-accountshs-worker.log'
$ErrFile    = Join-Path $RuntimeDir 'hs-accountshs-worker.err.log'

if (-not (Test-Path $RuntimeDir)) { New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null }

# Đã chạy chưa? Nhận diện theo CommandLine chứa tên script (python.exe hoặc pythonw.exe).
$pattern = '*hs-accountshs-worker.py*'
$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('python.exe', 'pythonw.exe') -and $_.CommandLine -like $pattern }
if ($running) { exit 0 }

# Python: cho phép ghi đè bằng biến môi trường HS_WORKER_PYTHON; mặc định pythonw.exe (chạy không cửa sổ).
$py = $env:HS_WORKER_PYTHON
if (-not $py) { $py = 'pythonw.exe' }

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
Add-Content -Path $LogFile -Value "[$stamp] khởi động worker ($py)"

Start-Process -FilePath $py -ArgumentList $Worker `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
exit 0
