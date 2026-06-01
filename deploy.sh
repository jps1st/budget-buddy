#!/usr/bin/env bash
set -euo pipefail

ssh node10 bash << 'REMOTE'
  set -euo pipefail

  # Load nvm if available
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

  cd ~/budget-buddy

  echo "==> Pulling latest changes..."
  git pull

  node --version
  nvm use 22

  echo "==> Installing dependencies..."
  npm ci --prefer-offline

  echo "==> Building..."
  npm run build

  echo "==> Reloading pm2 process..."
  pm2 reload budget

  echo "==> Done."
REMOTE
