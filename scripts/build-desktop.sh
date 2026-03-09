#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$REPO_ROOT/vibes-desktop"
DYLIB_SRC="$DESKTOP_DIR/native/macos/window-controls.mm"
DYLIB_OUT="$DESKTOP_DIR/native/macos/build/libWindowControls.dylib"
PLUGIN_JSON="$REPO_ROOT/.claude-plugin/plugin.json"

echo "=== Vibes Desktop Build ==="

# 1. Sync version from plugin.json → electrobun.config.ts
PLUGIN_VERSION=$(grep '"version"' "$PLUGIN_JSON" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "[1/3] Syncing version: $PLUGIN_VERSION"

# Use bun to update the version in electrobun.config.ts
bun -e "
  const fs = require('fs');
  const path = '$DESKTOP_DIR/electrobun.config.ts';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/version: \"[^\"]*\"/, 'version: \"$PLUGIN_VERSION\"');
  fs.writeFileSync(path, content);
"

# 2. Compile native dylib (if source is newer than output)
echo "[2/3] Compiling native dylib..."
if [ ! -f "$DYLIB_OUT" ] || [ "$DYLIB_SRC" -nt "$DYLIB_OUT" ]; then
  bash "$DESKTOP_DIR/native/macos/build-window-controls.sh"
else
  echo "  Dylib up to date, skipping."
fi

# 3. Build ElectroBun app
echo "[3/3] Building ElectroBun app..."
cd "$DESKTOP_DIR"
bunx electrobun build --env=stable

echo ""
echo "=== Build complete ==="
echo "Output: $DESKTOP_DIR/dist/"
