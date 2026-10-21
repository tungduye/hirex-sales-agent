@echo off
rem Cai 1 lan tren may anh Tung (can xac nhan quyen Administrator): ban xem truoc HireX cong 3005
rem tu chay moi khi dang nhap Windows + mo tuong lua cong 3005 trong mang noi bo. Ban that cong 3000 khong bi dung toi.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File ""%~dp0HS-XEM-TRUOC.ps1"" -Install'"
