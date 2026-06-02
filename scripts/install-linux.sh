#!/usr/bin/env bash
# Darrow Time & Invoicing — one-shot installer for Linux servers.
#
# Designed for non-technical operators. Detects/installs Docker if missing,
# downloads the production compose file, generates a .env with secure random
# secrets, pulls the GHCR image, brings up the stack, waits for health, and
# bootstraps the first admin user.
#
# Usage (on a fresh Ubuntu/Debian box):
#   curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Job-Proposals/main/scripts/install-linux.sh -o install-darrow.sh
#   sudo bash install-darrow.sh
#
# Or one-shot (read first if you're cautious — it's good practice):
#   curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Job-Proposals/main/scripts/install-linux.sh | sudo bash
#
# Safe to re-run — every step is idempotent.

set -euo pipefail

REPO="KisaesDevLab/Vibe-Job-Proposals"
INSTALL_DIR="${INSTALL_DIR:-/opt/darrow}"
SERVICE_USER="${SERVICE_USER:-darrow}"
COMPOSE_RAW="https://raw.githubusercontent.com/${REPO}/main/docker/docker-compose.prod.yml"
IMAGE="ghcr.io/kisaesdevlab/vibe-job-proposals:latest"

# ─── helpers ──────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YEL='\033[0;33m'; NC='\033[0m'
section() { echo; echo -e "${CYAN}=== $* ===${NC}"; }
ok()      { echo -e "  ${GREEN}[OK]${NC} $*"; }
info()    { echo "  $*"; }
warn()    { echo -e "  ${YEL}[!]${NC} $*"; }
fail()    { echo; echo -e "${RED}[X] $*${NC}"; echo "Install cannot continue. Fix the issue and re-run."; exit 1; }
have()    { command -v "$1" >/dev/null 2>&1; }

echo
echo -e "${CYAN}Darrow Time & Invoicing — Linux Installer${NC}"
echo "Target directory: $INSTALL_DIR"
echo

# ─── 0. Sanity ────────────────────────────────────────────────────────────
section "Checking environment"
if [ "$(id -u)" -ne 0 ]; then
  fail "Run as root (use \`sudo bash install-darrow.sh\`)."
fi
ok "Running as root"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ok "Architecture: x86_64";;
  aarch64|arm64) ok "Architecture: arm64";;
  *) fail "Unsupported architecture: $ARCH (need x86_64 or arm64)";;
esac

if [ -f /etc/os-release ]; then . /etc/os-release; ok "OS: ${PRETTY_NAME:-unknown}"; else warn "Could not detect OS"; fi

# ─── 1. Docker ────────────────────────────────────────────────────────────
section "Installing Docker (if missing)"
if have docker && docker compose version >/dev/null 2>&1; then
  ok "Docker + Compose already present ($(docker --version | head -1))"
else
  info "Docker not found — installing via get.docker.com…"
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  systemctl enable --now docker
  ok "Docker installed and enabled"
fi

# ─── 2. Service user + directory ──────────────────────────────────────────
section "Preparing $INSTALL_DIR"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" "$SERVICE_USER" || true
fi
usermod -aG docker "$SERVICE_USER" 2>/dev/null || true
mkdir -p "$INSTALL_DIR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
cd "$INSTALL_DIR"
ok "Working directory ready"

# ─── 3. Compose file ──────────────────────────────────────────────────────
section "Fetching docker-compose.yml"
curl -fsSL "$COMPOSE_RAW" -o docker-compose.yml
chown "$SERVICE_USER":"$SERVICE_USER" docker-compose.yml
ok "Compose file written"

# ─── 4. .env with secure secrets ──────────────────────────────────────────
section "Generating .env"
if [ -f .env ]; then
  ok ".env already exists — keeping current secrets"
else
  hex32() { openssl rand -hex 32; }
  b64()   { openssl rand -base64 18 | tr -d '=+/' ; }
  # Pick the first non-loopback IPv4 the box has; fallback to localhost.
  IP=$(hostname -I 2>/dev/null | awk '{print $1}'); IP=${IP:-localhost}
  # Detect the docker group GID so the api container's non-root user can
  # access /var/run/docker.sock (needed by the Settings → Remote access
  # tunnel workflow). Falls back to 999 — the stock get-docker.com GID.
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo 999)
  cat > .env <<EOF
SESSION_SECRET=$(hex32)
SMTP_ENC_KEY=$(hex32)
TUNNEL_ENC_KEY=$(hex32)
PUBLIC_UPLOAD_TOKEN=$(b64)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
APP_BASE_URL=http://${IP}:3000
DOCKER_GID=${DOCKER_GID}
EOF
  chmod 600 .env
  chown "$SERVICE_USER":"$SERVICE_USER" .env
  ok "Generated .env with secure random secrets ($(stat -c '%a %U' .env))"
fi

# ─── 5. Pull + start ──────────────────────────────────────────────────────
section "Pulling $IMAGE"
docker compose pull
ok "Image pulled"

section "Starting the stack"
docker compose up -d
ok "Containers started"

# ─── 6. Wait for health ───────────────────────────────────────────────────
section "Waiting for the app to become healthy"
TRIES=0
while [ $TRIES -lt 60 ]; do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then break; fi
  sleep 2
  TRIES=$((TRIES + 1))
done
if [ $TRIES -ge 60 ]; then
  warn "Health check did not pass within 2 minutes."
  warn "Run \`cd $INSTALL_DIR && docker compose logs app\` to investigate."
else
  ok "App is healthy"
fi

# ─── 7. Bootstrap admin ───────────────────────────────────────────────────
section "Creating the first admin user"
# bootstrap-admin.ts is idempotent — it errors if an admin already exists,
# which is fine on re-runs.
BOOT_OUT=$(docker compose exec -T app npx tsx scripts/bootstrap-admin.ts 2>&1 || true)
echo "$BOOT_OUT" | sed 's/^/    /'
if echo "$BOOT_OUT" | grep -q 'admin user already exists'; then
  ok "Admin user already exists — keeping the existing credentials"
fi

# ─── 8. Summary ───────────────────────────────────────────────────────────
section "Install complete"
IP=$(hostname -I 2>/dev/null | awk '{print $1}'); IP=${IP:-localhost}
echo
echo "Open the app in a browser:"
echo -e "  ${GREEN}http://${IP}:3000${NC}"
echo
if [ -f docs/FIRST_RUN.md ] 2>/dev/null; then
  echo "Initial admin credentials are saved at:"
  echo "  $INSTALL_DIR/docs/FIRST_RUN.md"
  echo "Log in, change the password, then delete that file."
else
  echo "Admin credentials were printed above. Change the password on first login."
fi
echo
echo "Useful commands (run from $INSTALL_DIR):"
echo "  docker compose logs -f app   # tail the API logs"
echo "  docker compose ps            # see container status"
echo "  docker compose pull && docker compose up -d   # update to the latest image"
echo "  docker compose stop          # stop everything (data preserved)"
echo
