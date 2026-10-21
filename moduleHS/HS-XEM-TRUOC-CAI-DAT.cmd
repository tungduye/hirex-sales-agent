@echo off
rem Cai 1 lan tren may anh Tung: ban xem truoc HireX cong 3005 (tu chay khi dang nhap Windows) + mo cong 3005 trong mang noi bo + FFmpeg.
rem Ket qua ghi vao runtime\hs-preview-install.log. Ban that cong 3000 khong bi dung toi.
net session >nul 2>&1
if errorlevel 1 (
  echo Dang xin quyen Administrator: bam YES o cua so Windows hien ra...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  timeout /t 3 >nul
  exit /b
)
cd /d "%~dp0.."
if not exist runtime mkdir runtime
echo Dang cai, vui long cho (FFmpeg co the mat 1-2 phut)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0HS-XEM-TRUOC.ps1" -Install > runtime\hs-preview-install.log 2>&1
type runtime\hs-preview-install.log
echo.
pause
