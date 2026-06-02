@echo off
REM Start Darrow Time & Invoicing after the initial install has been run.
title Darrow Time ^& Invoicing - Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
echo.
echo Press any key to close this window...
pause >nul
