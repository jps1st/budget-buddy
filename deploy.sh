#!/usr/bin/env bash
set -euo pipefail

# 1. Commit any unstaged source changes so they're never silently left behind
if ! git diff --cached --quiet || ! git diff --quiet -- src; then
  echo "==> Staging and committing source changes..."
  git add src/
  git commit -m "$(cat <<'MSG'
chore: pre-deploy source snapshot

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
MSG
)"
fi

# 2. Bump version + push
echo "==> Bumping version..."
npm version patch --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
git add package.json
git commit -m "chore: bump version to $NEW_VERSION"
git push

# 3. Build locally
echo "==> Building locally..."
npm run build

# 4. Upload dist/ to a staging directory on the server (live dist/ untouched during transfer)
echo "==> Uploading dist/ to server..."
rsync -az --delete dist/ node10:~/budget-buddy/dist.next/

# 5. Atomic-ish swap + graceful PM2 reload (no npm/git on server)
echo "==> Swapping dist and reloading PM2..."
ssh node10 '
  set -euo pipefail
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  cd ~/budget-buddy
  rm -rf dist.old
  [ -d dist ] && mv dist dist.old
  mv dist.next dist
  pm2 reload budget
  rm -rf dist.old
  echo "==> Done."
'
