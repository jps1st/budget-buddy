#!/usr/bin/env bash
set -euo pipefail

ssh node10 bash << 'REMOTE'
  set -euo pipefail
  cd ~/budget-buddy

  echo "==> Pulling latest changes..."
  git pull

  echo "==> Installing dependencies..."
  npm ci --prefer-offline

  echo "==> Building..."
  npm run build

  echo "==> Reloading pm2 process..."
  pm2 reload budget

  echo "==> Done."
REMOTE
