@echo off
REM Stop all Darrow services + Docker containers.
title Darrow Time ^& Invoicing - Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
echo.
echo Press any key to close this window...
pause >nul
