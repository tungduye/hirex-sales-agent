@echo off
rem Kiem tra truoc khi deploy: typecheck + test + build thu vao .next-hscheck. Khong dung toi ban that.
title HireX - kiem tra build
cd /d "%~dp0.."
set HIREX_BUILD_DIR=.next-hscheck
echo [1/3] Typecheck...
call npx tsc --noEmit --incremental false || goto loi
echo [2/3] Test...
call npm test || goto loi
call node --test moduleHS/accountshs/tests/*.test.mjs moduleHS/record/*.test.mjs || goto loi
echo [3/3] Build thu...
call npx next build || goto loi
echo.
echo OK - build duoc. Chay release.ps1 la len app.hirexmkt.online.
pause
exit /b 0
:loi
echo.
echo LOI - xem thong bao phia tren. Ban that khong bi anh huong.
pause
exit /b 1
