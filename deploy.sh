#!/usr/bin/env bash
set -euo pipefail

echo "==> Bumping version..."
npm version patch --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json
git commit -m "chore: bump version to $NEW_VERSION"
git push

ssh node10 bash << 'REMOTE'
  set -euo pipefail

  # Load nvm if available
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

  cd ~/budget-buddy

  echo "==> Pulling latest changes..."
  git stash --include-untracked
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
