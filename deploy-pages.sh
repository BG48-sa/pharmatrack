#!/usr/bin/env bash
# Build PharmaTrack and publish it to the gh-pages branch (GitHub Pages).
# The live PWA is at https://bg48-sa.github.io/pharmatrack/
#
# Usage:  ./deploy-pages.sh
#
# Re-run this whenever you change the app. On the iPhone, fully close and
# reopen the home-screen app twice to pick up the new version (1st reopen
# updates the service worker, 2nd loads it).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Building (GitHub Pages base path)"
GH_PAGES=true npm run build

DIST="frontend/dist"
touch "$DIST/.nojekyll"   # stop GitHub from running Jekyll on the build output

# Reuse the remote URL (with token) already configured on origin.
REMOTE=$(git remote get-url origin)

echo "==> Publishing $DIST to gh-pages"
TMP=$(mktemp -d)
cp -R "$DIST"/. "$TMP"/
(
  cd "$TMP"
  git init -q -b gh-pages
  git add -A
  git -c user.name='Bernd Gansbacher' -c user.email='bernd.gansbacher@gmail.com' \
      commit -q -m "Deploy $(date '+%Y-%m-%d %H:%M')"
  git push -q -f "$REMOTE" gh-pages
)
rm -rf "$TMP"
echo "==> Done. Live in ~30-45s at https://bg48-sa.github.io/pharmatrack/"
