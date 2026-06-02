@echo off
REM Double-click entry point for Darrow Time & Invoicing install.
REM Hands off to scripts/install.ps1 with the right execution policy.
title Darrow Time ^& Invoicing - Install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
echo.
echo Press any key to close this window...
pause >nul
