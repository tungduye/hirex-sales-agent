@echo off
rem Deploy len cong 3000 / app.hirexmkt.online (chung voi anh Tung): chay scripts\release.ps1 voi ten tu dat.
rem Build loi thi tu dung, ban that giu nguyen. Can tra loi y vai cau hoi trong qua trinh chay.
title HireX - deploy
powershell -NoProfile -ExecutionPolicy Bypass -Command "& 'C:\Users\Admin\hirex-sales-agent\scripts\release.ps1' -Release ('hs-' + (Get-Date -Format 'MMdd-HHmm'))"
pause
