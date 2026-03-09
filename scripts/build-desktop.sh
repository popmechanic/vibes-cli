#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$REPO_ROOT/vibes-desktop"
DYLIB_SRC="$DESKTOP_DIR/native/macos/window-controls.mm"
DYLIB_OUT="$DESKTOP_DIR/native/macos/build/libWindowControls.dylib"
PLUGIN_JSON="$REPO_ROOT/.claude-plugin/plugin.json"

APP_NAME="VibesOS"

echo "=== Vibes Desktop Build ==="

BUILD_DIR="$DESKTOP_DIR/build/stable-macos-arm64"
ARTIFACTS_DIR="$DESKTOP_DIR/artifacts"
ICNS="$BUILD_DIR/$APP_NAME.app/Contents/Resources/AppIcon.icns"
DMG_BG="$DESKTOP_DIR/dmg-background.png"
INSTALL_CMD="$REPO_ROOT/scripts/install-vibes.command"

# 1. Sync version from plugin.json → electrobun.config.ts
PLUGIN_VERSION=$(grep '"version"' "$PLUGIN_JSON" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "[1/4] Syncing version: $PLUGIN_VERSION"

# Use bun to update the version in electrobun.config.ts
bun -e "
  const fs = require('fs');
  const path = '$DESKTOP_DIR/electrobun.config.ts';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/version: \"[^\"]*\"/, 'version: \"$PLUGIN_VERSION\"');
  fs.writeFileSync(path, content);
"

# 2. Compile native dylib (if source is newer than output)
echo "[2/4] Compiling native dylib..."
if [ ! -f "$DYLIB_OUT" ] || [ "$DYLIB_SRC" -nt "$DYLIB_OUT" ]; then
  bash "$DESKTOP_DIR/native/macos/build-window-controls.sh"
else
  echo "  Dylib up to date, skipping."
fi

# 3. Build ElectroBun app
echo "[3/4] Building ElectroBun app..."
cd "$DESKTOP_DIR"
bunx electrobun build --env=stable

# 4. Create polished DMG with create-dmg
echo "[4/4] Creating DMG..."
ORIG_DMG="$ARTIFACTS_DIR/stable-macos-arm64-VibesOS.dmg"
rm -f "$ORIG_DMG"

if [ -f "$ICNS" ]; then
  # Stage files for create-dmg
  STAGE_DIR="/tmp/vibes-dmg-stage"
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR"
  cp -R "$BUILD_DIR/$APP_NAME.app" "$STAGE_DIR/"
  cp "$INSTALL_CMD" "$STAGE_DIR/Install Vibes CLI.command"
  chmod +x "$STAGE_DIR/Install Vibes CLI.command"
  ln -s /Applications "$STAGE_DIR/Applications"

  # Layout: .command (left) → VibesOS (center) → Applications (right)
  create-dmg \
    --volname "$APP_NAME" \
    --volicon "$ICNS" \
    --background "$DMG_BG" \
    --window-pos 200 100 \
    --window-size 1024 576 \
    --icon-size 120 \
    --icon "Install Vibes CLI.command" 200 270 \
    --icon "$APP_NAME.app" 512 270 \
    --icon "Applications" 824 270 \
    --no-internet-enable \
    "$ORIG_DMG" \
    "$STAGE_DIR" \
    2>&1

  rm -rf "$STAGE_DIR"

  # Replace Applications symlink with Finder alias + system icon
  # (symlinks can't hold custom icons, aliases can)
  RW_DMG="/tmp/VibesOS-rw.dmg"
  hdiutil convert "$ORIG_DMG" -format UDRW -o "$RW_DMG" -ov -quiet
  hdiutil attach "$RW_DMG" -readwrite -noverify -noautoopen -quiet

  # Extract system Applications icon and build icns
  swift -e '
import AppKit
let ws = NSWorkspace.shared
let icon = ws.icon(forFile: "/Applications")
icon.size = NSSize(width: 512, height: 512)
let tiff = icon.tiffRepresentation!
let rep = NSBitmapImageRep(data: tiff)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: "/tmp/applications-icon.png"))
  '
  mkdir -p /tmp/apps-icon.iconset
  for SIZE in 512 256 128 32 16; do
    sips -z $SIZE $SIZE /tmp/applications-icon.png --out "/tmp/apps-icon.iconset/icon_${SIZE}x${SIZE}.png" 2>/dev/null
  done
  iconutil -c icns /tmp/apps-icon.iconset -o /tmp/apps-folder.icns 2>/dev/null

  # Replace symlink with alias, set icon
  swift -e '
import AppKit
import Foundation
let path = "/Volumes/'"$APP_NAME"'/Applications"
let fm = FileManager.default
try? fm.removeItem(atPath: path)
let target = URL(fileURLWithPath: "/Applications")
let data = try target.bookmarkData(options: .suitableForBookmarkFile,
    includingResourceValuesForKeys: nil, relativeTo: nil)
try URL.writeBookmarkData(data, to: URL(fileURLWithPath: path))
if let icon = NSImage(contentsOfFile: "/tmp/apps-folder.icns") {
    NSWorkspace.shared.setIcon(icon, forFile: path)
}
  '

  sync
  hdiutil detach "/Volumes/$APP_NAME" 2>/dev/null || true
  sleep 1
  hdiutil convert "$RW_DMG" -format UDZO -o "$ORIG_DMG" -ov -quiet
  rm -f "$RW_DMG"
  echo "  DMG created: $ORIG_DMG"
else
  echo "  Skipping DMG (missing app icon)."
fi

echo ""
echo "=== Build complete ==="
echo "Output: $ARTIFACTS_DIR/"
