#!/usr/bin/env bash
# Build Connect Worker bundles from upstream Fireproof source
# Run from vibes-skill root: bash deploy-api/scripts/build-connect-bundles.sh

set -euo pipefail

REPO_DIR="${HOME}/.vibes/upstream/fireproof"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../bundles"
mkdir -p "$OUT_DIR"

# Ensure upstream repo exists
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Error: upstream fireproof repo not found at $REPO_DIR"
  echo "Run a deploy first to trigger sparse checkout, or clone manually."
  exit 1
fi

# Cloud backend — single Worker with Durable Object
echo "Building cloud-backend bundle..."
cd "$REPO_DIR"
npx esbuild cloud/backend/cf-d1/server.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --conditions=workerd,worker,browser \
  --external:cloudflare:workers \
  --external:node:* \
  --outfile="$OUT_DIR/cloud-backend.txt" \
  --minify

# Dashboard backend — Worker with static assets
echo "Building dashboard backend..."
npx esbuild dashboard/backend/cf-serve.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --conditions=workerd,worker,browser \
  --external:cloudflare:workers \
  --external:node:* \
  --external:@cloudflare/workers-types \
  --outfile="$OUT_DIR/dashboard-core.js" \
  --minify

# Embed dashboard frontend assets into a combined bundle
echo "Embedding dashboard frontend assets..."
node "$SCRIPT_DIR/embed-dashboard-assets.js" \
  "$OUT_DIR/dashboard-core.js" \
  "$REPO_DIR/dashboard/frontend/dist/static/client" \
  "$OUT_DIR/dashboard.txt"

# Clean up intermediate file
rm -f "$OUT_DIR/dashboard-core.js"

echo "Bundles written to $OUT_DIR/"
ls -la "$OUT_DIR/cloud-backend.txt" "$OUT_DIR/dashboard.txt"
