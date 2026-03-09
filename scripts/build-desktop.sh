#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$REPO_ROOT/vibes-desktop"
DYLIB_SRC="$DESKTOP_DIR/native/macos/window-controls.mm"
DYLIB_OUT="$DESKTOP_DIR/native/macos/build/libWindowControls.dylib"
PLUGIN_JSON="$REPO_ROOT/.claude-plugin/plugin.json"

echo "=== Vibes Desktop Build ==="

BUILD_DIR="$DESKTOP_DIR/build/stable-macos-arm64"
ARTIFACTS_DIR="$DESKTOP_DIR/artifacts"
ICNS="$BUILD_DIR/Vibes Editor.app/Contents/Resources/AppIcon.icns"

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

# 4. Rebuild DMG with volume icon and drag-to-Applications layout
echo "[4/4] Customizing DMG..."
ORIG_DMG="$ARTIFACTS_DIR/stable-macos-arm64-VibesEditor.dmg"
TMP_DMG="/tmp/VibesEditor-rw.dmg"

if [ -f "$ORIG_DMG" ] && [ -f "$ICNS" ]; then
  # Create writable DMG
  hdiutil create -size 400m -fs HFS+ -volname "Vibes Editor" "$TMP_DMG" -ov -quiet
  hdiutil attach "$TMP_DMG" -readwrite -noverify -noautoopen -quiet

  # Copy app and Applications symlink
  cp -R "$BUILD_DIR/Vibes Editor.app" "/Volumes/Vibes Editor/"
  ln -s /Applications "/Volumes/Vibes Editor/Applications"

  # Set volume icon
  cp "$ICNS" "/Volumes/Vibes Editor/.VolumeIcon.icns"
  SetFile -a C "/Volumes/Vibes Editor"

  # Configure Finder window layout
  osascript <<'APPLESCRIPT'
tell application "Finder"
    tell disk "Vibes Editor"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {400, 100, 920, 440}
        set theViewOptions to icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to 80
        set position of item "Vibes Editor.app" of container window to {130, 180}
        set position of item "Applications" of container window to {390, 180}
        close
    end tell
end tell
APPLESCRIPT

  # Convert to compressed read-only DMG
  sync
  hdiutil detach /dev/disk4 2>/dev/null || hdiutil detach "/Volumes/Vibes Editor" 2>/dev/null || true
  sleep 1
  hdiutil convert "$TMP_DMG" -format UDZO -o "$ORIG_DMG" -ov -quiet
  rm -f "$TMP_DMG"
  echo "  DMG customized with volume icon and layout."
else
  echo "  Skipping DMG customization (missing DMG or icon)."
fi

echo ""
echo "=== Build complete ==="
echo "Output: $ARTIFACTS_DIR/"
