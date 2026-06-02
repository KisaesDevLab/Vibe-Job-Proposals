# Stop all Darrow services + Docker containers.
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host ""
Write-Host "Darrow Time & Invoicing - Stop" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host ""

# Close the three named PowerShell windows opened by start.ps1
Write-Host "Closing service windows..." -ForegroundColor Cyan
$titles = @('Darrow API', 'Darrow Workers', 'Darrow Web')
$procs = Get-Process powershell -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  if ($titles -contains $p.MainWindowTitle) {
    try { Stop-Process -Id $p.Id -Force; Write-Host "  Stopped: $($p.MainWindowTitle)" -ForegroundColor Green } catch {}
  }
}

# Stop Docker containers (keeps data — only `down -v` would wipe volumes)
Write-Host ""
Write-Host "Stopping Docker containers..." -ForegroundColor Cyan
$composeFile = Join-Path $repoRoot 'docker\docker-compose.yml'
if (Test-Path $composeFile) {
  docker compose -f $composeFile stop
}

Write-Host ""
Write-Host "All Darrow services are stopped. Data is preserved in Docker volumes." -ForegroundColor Green
Write-Host "Run start.bat to launch the app again." -ForegroundColor Yellow
Write-Host ""
