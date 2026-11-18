#!/usr/bin/env bash
# Build and publish the live site (Cloudflare Pages project "quex" -> quex.jamwheeler.com).
# Deploys only committed, pushed code so the site always matches a commit on main.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! git diff --quiet HEAD || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Uncommitted changes: commit (and push) before deploying." >&2; exit 1
fi
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "HEAD is not origin/main: push first (CI applies DB migrations on push)." >&2; exit 1
fi
npm run build
npx wrangler pages deploy dist --project-name quex --branch main \
  --commit-hash "$(git rev-parse --short HEAD)" --commit-message "$(git log -1 --format=%s)"
