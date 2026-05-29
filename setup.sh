#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${CYAN}  →${RESET} $*"; }
success() { echo -e "${GREEN}  ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}  !${RESET} $*"; }
error()   { echo -e "${RED}  ✗${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ─── Check prerequisites ──────────────────────────────────────────────────────
header "Checking prerequisites"

if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js >= 22 from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  error "Node.js >= 22 required (node:sqlite). Found: $(node --version)"
  exit 1
fi
success "Node.js $(node --version)"

if ! command -v npm &>/dev/null; then
  error "npm not found."
  exit 1
fi
success "npm $(npm --version)"

if ! command -v pm2 &>/dev/null; then
  warn "pm2 not found — needed for production server mode. Install with: npm install -g pm2"
fi

# ─── Install dependencies ─────────────────────────────────────────────────────
header "Installing dependencies"
npm install
success "Dependencies installed"

# ─── Database directory ───────────────────────────────────────────────────────
header "Database"
mkdir -p data
success "data/ directory ready — SQLite DB will be created at data/budget-sync.db on first run"

# ─── Build ────────────────────────────────────────────────────────────────────
header "Building"
npm run build
success "Build complete → dist/"

# ─── Done ─────────────────────────────────────────────────────────────────────
header "All done"
echo ""
echo -e "  ${BOLD}Start dev server:${RESET}          npm run dev"
echo -e "  ${BOLD}Serve production build:${RESET}    npm run preview"
echo -e "  ${BOLD}Start with PM2:${RESET}            pm2 start ecosystem.config.json --env production"
echo ""
