# Darrow Time & Invoicing — start script.
# Starts the API, background workers, and Vite dev server in three terminal
# windows, then opens the browser. Run install.bat first if you haven't.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" }
function Fail($msg) {
  Write-Host ""
  Write-Host "[X] $msg" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Darrow Time & Invoicing - Start" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host ""

if (-not (Test-Path (Join-Path $repoRoot '.env'))) {
  Fail "No .env file found. Run install.bat first."
}
if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
  Fail "Dependencies are not installed. Run install.bat first."
}

# Ensure Docker is up
Section "Checking Docker services"
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) { Fail "Docker is not in PATH. Run install.bat." }
try { docker ps *>$null } catch {
  Fail "Docker Desktop is not running. Start it from the Start menu and wait for the whale icon to turn solid, then try again."
}
$composeFile = Join-Path $repoRoot 'docker\docker-compose.yml'
docker compose -f $composeFile up -d *>$null
Ok "Postgres and Redis are running"

# Start each service in its own visible window so the operator can see logs
Section "Launching application services"
function Start-InNewWindow($title, $command) {
  $script = @"
`$Host.UI.RawUI.WindowTitle = '$title'
Set-Location '$repoRoot'
Write-Host '$title' -ForegroundColor Cyan
$command
"@
  Start-Process powershell.exe -ArgumentList '-NoProfile','-NoExit','-Command',$script | Out-Null
}

Start-InNewWindow 'Darrow API'     'npx tsx watch --env-file=../../.env apps/api/src/index.ts'
Start-InNewWindow 'Darrow Workers' 'npx tsx watch --env-file=../../.env packages/workers/src/index.ts'
Start-InNewWindow 'Darrow Web'     'npm -w @darrow/web run dev'

Ok "Three terminal windows opened (API, Workers, Web). Leave them running."
Info "    Closing any of them stops that service."

# Wait for the web server to accept connections, then open the browser
Section "Waiting for the web server"
$webUrl = 'http://localhost:5173'
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    if ($r.StatusCode -lt 500) { $ready = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}
if ($ready) {
  Ok "Web server is ready"
  Start-Process $webUrl
  Info "    Opened $webUrl in your browser"
} else {
  Info "    Web server did not respond yet - open $webUrl in your browser manually"
}

Write-Host ""
Write-Host "To stop everything: close the three new PowerShell windows." -ForegroundColor Yellow
Write-Host "(Docker containers keep running until you stop Docker Desktop or run scripts/stop.ps1)"
Write-Host ""
