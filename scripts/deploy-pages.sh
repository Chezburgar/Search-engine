#!/usr/bin/env bash
# Builds the static site and publishes dist/ to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE="$(git remote get-url origin)"
node scripts/build-pages.mjs "$@"
cd dist
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" \
  commit -q -m "Deploy Spark to GitHub Pages ($(git -C .. rev-parse --short HEAD))"
git push -q -f "$REMOTE" gh-pages
echo "Pushed to gh-pages."
