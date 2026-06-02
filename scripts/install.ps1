# Darrow Time & Invoicing — one-click installer for Windows.
#
# Designed for non-technical operators. Detects prerequisites, generates a
# secure .env, brings up the Postgres + Redis containers, installs npm
# dependencies, runs database migrations, creates the first admin user, and
# starts the application.
#
# Safe to re-run — every step is idempotent.

# Use Continue so a native command's stderr (e.g. docker compose warnings)
# doesn't abort the whole script. We check $LASTEXITCODE explicitly after
# each native call instead.
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" }
function Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ""
  Write-Host "[X] $msg" -ForegroundColor Red
  Write-Host ""
  Write-Host "Install cannot continue. See message above. After fixing, re-run install.bat." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Darrow Time & Invoicing - Install" -ForegroundColor White -BackgroundColor DarkBlue
Write-Host "Project folder: $repoRoot"
Write-Host ""

# ─── 1. Prerequisite checks ────────────────────────────────────────────────
Section "Checking prerequisites"

# Docker Desktop
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Fail @"
Docker Desktop is not installed (or not in PATH).
Download and install Docker Desktop for Windows:
  https://www.docker.com/products/docker-desktop/
After installing, START Docker Desktop and wait for it to finish loading
(the whale icon in the system tray turns solid). Then re-run install.bat.
"@
}
$null = docker ps 2>$null
if ($LASTEXITCODE -ne 0) {
  Fail @"
Docker is installed but not running. Start Docker Desktop from the Start menu,
wait for the whale icon in the system tray to turn solid (about 60 seconds),
then re-run install.bat.
"@
}
Ok "Docker Desktop is running"

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail @"
Node.js is not installed.
Download and install the LTS version (24.x or newer):
  https://nodejs.org/
Then re-run install.bat.
"@
}
$nodeVer = (node -v) -replace 'v',''
$major = [int]($nodeVer.Split('.')[0])
if ($major -lt 24) {
  Fail "Node.js $nodeVer is too old. Install Node 24 LTS or newer from https://nodejs.org/"
}
Ok "Node.js v$nodeVer"

# npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail "npm is not in PATH (re-install Node.js)." }
Ok "npm is available"

# LibreOffice (optional)
$loCandidates = @(
  "C:\Program Files\LibreOffice\program\soffice.exe",
  "C:\Program Files (x86)\LibreOffice\program\soffice.exe"
)
$loFound = $false
foreach ($p in $loCandidates) { if (Test-Path $p) { $loFound = $true; break } }
if (-not $loFound) {
  Warn "LibreOffice not found (optional). DOCX invoices will work but DOCX -> PDF conversion will not."
  Info "    To enable, install LibreOffice from https://www.libreoffice.org/download/"
} else {
  Ok "LibreOffice detected"
}

# ─── 2. .env file ──────────────────────────────────────────────────────────
Section "Configuring environment"
$envPath = Join-Path $repoRoot ".env"
$envExamplePath = Join-Path $repoRoot ".env.example"

function New-HexKey([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ($b | ForEach-Object { $_.ToString('x2') }) -join ''
}
function New-UrlSafe([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $base64 = [Convert]::ToBase64String($b)
  return ($base64 -replace '\+','-' -replace '/','_' -replace '=','')
}

if (Test-Path $envPath) {
  Info ".env already exists - keeping current values"
} else {
  if (-not (Test-Path $envExamplePath)) {
    Fail "Neither .env nor .env.example exists. Repository is incomplete."
  }
  $storageRoot = (Join-Path $repoRoot "storage") -replace '\\','/'
  $sessionSecret = New-HexKey 32
  $smtpKey = New-HexKey 32
  $tunnelKey = New-HexKey 32
  $uploadToken = New-UrlSafe 18
  $content = @"
DATABASE_URL=postgres://postgres:postgres@localhost:5432/darrow_ti
REDIS_URL=redis://localhost:6379
SESSION_SECRET=$sessionSecret
STORAGE_ROOT=$storageRoot
APP_BASE_URL=http://localhost:5173
NODE_ENV=development
LOG_LEVEL=info
PORT=4000
SMTP_ENC_KEY=$smtpKey
TUNNEL_ENC_KEY=$tunnelKey
PUBLIC_UPLOAD_TOKEN=$uploadToken
"@
  if ($loFound) {
    $loPath = ($loCandidates | Where-Object { Test-Path $_ })[0] -replace '\\','/'
    $content += "`nLIBREOFFICE_BIN=$loPath`n"
  }
  $content | Out-File -FilePath $envPath -Encoding utf8 -NoNewline
  Ok "Generated .env with secure random secrets"
}

# Ensure storage tree exists
$storageDir = Join-Path $repoRoot "storage"
foreach ($sub in @("", "branding", "invoices", "invoice-summaries", "expenses", "inbox", "backups", "imports")) {
  $p = if ($sub -eq "") { $storageDir } else { Join-Path $storageDir $sub }
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
Ok "Storage directory ready"

# ─── 3. Docker containers ──────────────────────────────────────────────────
Section "Starting Postgres and Redis (Docker)"
$composeFile = Join-Path $repoRoot "docker\docker-compose.yml"
if (-not (Test-Path $composeFile)) { Fail "docker/docker-compose.yml is missing." }
# docker compose emits orphan-container warnings to stderr on installs that
# have other compose projects in this folder; --remove-orphans silences them
# without harming our containers (orphans here are *other* projects' work).
docker compose -f $composeFile up -d 2>$null
if ($LASTEXITCODE -ne 0) {
  # Try once more with --remove-orphans in case the warning was the cause.
  docker compose -f $composeFile up -d --remove-orphans 2>$null
}
if ($LASTEXITCODE -ne 0) { Fail "Failed to start Docker services. Open Docker Desktop and check the logs." }

Info "Waiting for Postgres to become healthy..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  # Just try a one-shot connection through docker exec; pg_isready exits 0 when ready.
  docker exec docker-postgres-1 pg_isready -U postgres 2>$null *>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { Warn "Postgres health check timed out - continuing anyway" } else { Ok "Postgres is up" }

# ─── 4. npm install + build ────────────────────────────────────────────────
Section "Installing npm packages (this can take a few minutes the first time)"
if (-not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  & npm install --no-audit --no-fund 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed. Check the messages above." }
  Ok "Dependencies installed"
} else {
  Info "node_modules already exists - skipping install (delete node_modules to force a clean install)"
}

# ─── 5. Database migrations ────────────────────────────────────────────────
Section "Setting up the database"
& npx --no-install tsx --env-file=.env packages/db/src/migrate.ts 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Fail "Database migration failed. Check the messages above." }
Ok "Database migrations applied"

# ─── 6. Bootstrap admin user ───────────────────────────────────────────────
Section "Creating the first admin user"
$firstRunPath = Join-Path $repoRoot "docs\FIRST_RUN.md"
& npx --no-install tsx --env-file=.env scripts/bootstrap-admin.ts 2>&1 | ForEach-Object {
  # Filter the "already exists" message into something friendly
  if ($_ -match 'admin user already exists') {
    Info "Admin user already exists - skipping (use the existing username/password)"
  } else {
    Write-Host "  $_"
  }
}
if (Test-Path $firstRunPath) {
  Ok "Admin credentials saved to docs\FIRST_RUN.md"
}

# ─── 7. Done ───────────────────────────────────────────────────────────────
Section "Install complete"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Double-click start.bat to launch the application."
Write-Host "  2. Open http://localhost:5173 in your browser."
if (Test-Path $firstRunPath) {
  Write-Host "  3. Log in with the credentials in docs\FIRST_RUN.md."
  Write-Host "     IMPORTANT: change the password from your user menu, then delete docs\FIRST_RUN.md."
} else {
  Write-Host "  3. Log in with the username and password you set up earlier."
}
Write-Host ""
Write-Host "To make a backup later, open Settings -> Backup ^& restore inside the app."
Write-Host ""
exit 0
