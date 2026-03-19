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
DMG_ICON_PNG="$DESKTOP_DIR/dmg-icon.png"

# 1. Sync version from plugin.json → electrobun.config.ts
PLUGIN_VERSION=$(grep '"version"' "$PLUGIN_JSON" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "[1/5] Syncing version: $PLUGIN_VERSION"

# Use bun to update the version in electrobun.config.ts
bun -e "
  const fs = require('fs');
  const path = '$DESKTOP_DIR/electrobun.config.ts';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/version: \"[^\"]*\"/, 'version: \"$PLUGIN_VERSION\"');
  fs.writeFileSync(path, content);
"

# 2. Compile native dylib (if source is newer than output)
echo "[2/5] Compiling native dylib..."
if [ ! -f "$DYLIB_OUT" ] || [ "$DYLIB_SRC" -nt "$DYLIB_OUT" ]; then
  bash "$DESKTOP_DIR/native/macos/build-window-controls.sh"
else
  echo "  Dylib up to date, skipping."
fi

# 3. Pre-mask app icon PNGs with macOS squircle to prevent corner fringing.
#    macOS applies its own squircle mask to .icns icons at display time, but
#    anti-aliasing at the boundary of non-transparent content creates dark
#    corner artifacts. Pre-masking makes the corners transparent so macOS
#    clips only transparent pixels.
echo "[3/5] Pre-masking app icon..."
ICONSET_DIR="$DESKTOP_DIR/icon.iconset"
swift -e '
import AppKit
import CoreGraphics

let iconsetDir = "'"$ICONSET_DIR"'"
let fm = FileManager.default
let files = try! fm.contentsOfDirectory(atPath: iconsetDir).filter { $0.hasSuffix(".png") }

for file in files {
    let filePath = "\(iconsetDir)/\(file)"
    guard let dataProvider = CGDataProvider(filename: filePath),
          let cgImage = CGImage(pngDataProviderSource: dataProvider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    else { continue }

    let w = cgImage.width
    let h = cgImage.height

    // macOS icon mask is a continuous-corner (squircle) rounded rect at ~22.37%.
    // Use slightly larger radius to ensure our mask exceeds the system mask.
    let radius = CGFloat(w) * 0.23

    // Use CGPath with continuous corners (squircle) — matches macOS icon shape.
    // NSBezierPath uses circular arc corners which do NOT match the system mask.
    let rect = CGRect(x: 0, y: 0, width: w, height: h)
    let squirclePath = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: w, height: h,
                              bitsPerComponent: 8, bytesPerRow: 0,
                              space: colorSpace,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { continue }

    // Disable anti-aliasing on the clip to avoid semi-transparent edge pixels.
    // Semi-transparent gray pixels appear as a dark border when composited against
    // dark backgrounds. macOS applies its own anti-aliased mask at display time.
    ctx.setShouldAntialias(false)
    ctx.addPath(squirclePath)
    ctx.clip()
    ctx.setShouldAntialias(true)
    ctx.draw(cgImage, in: rect)

    guard let masked = ctx.makeImage() else { continue }

    let url = URL(fileURLWithPath: filePath) as CFURL
    guard let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else { continue }
    CGImageDestinationAddImage(dest, masked, nil)
    CGImageDestinationFinalize(dest)
}
print("  Masked \(files.count) icon PNGs")
'

# 4. Build ElectroBun app (clean build — ElectroBun caches compiled TS)
echo "[4/5] Building ElectroBun app (includes plugin bundling)..."
rm -rf "$DESKTOP_DIR/build"
cd "$DESKTOP_DIR"
# Patch generation may fail on first build with baseUrl (no previous version to diff).
# The build, signing, and notarization still succeed — allow non-zero exit.
bunx electrobun build --env=stable || echo "  (electrobun build exited non-zero — patch generation may have failed, continuing)"

# Extract .app from tar (ElectroBun packages it during notarize/staple)
if [ -f "$BUILD_DIR/$APP_NAME.app.tar" ] && [ ! -d "$BUILD_DIR/$APP_NAME.app" ]; then
  echo "  Extracting .app from tar..."
  cd "$BUILD_DIR" && tar xf "$APP_NAME.app.tar" && cd "$REPO_ROOT"
fi

# 5. Create polished DMG with create-dmg
# (Plugin files are bundled by postBuild/postWrap hooks before signing)
echo "[5/5] Creating DMG..."
ORIG_DMG="$ARTIFACTS_DIR/stable-macos-arm64-VibesOS.dmg"
rm -f "$ORIG_DMG"

if [ -f "$ICNS" ]; then
  # Stage files for create-dmg
  STAGE_DIR="/tmp/vibes-dmg-stage"
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR"
  cp -R "$BUILD_DIR/$APP_NAME.app" "$STAGE_DIR/"
  # Replace symlink with Finder alias + system icon in staging dir
  # (symlinks can't hold custom icons, aliases can)
  swift -e '
import AppKit
import Foundation
do {
    let stagePath = "'"$STAGE_DIR"'/Applications"
    let fm = FileManager.default
    try? fm.removeItem(atPath: stagePath)
    let target = URL(fileURLWithPath: "/Applications")
    let data = try target.bookmarkData(options: .suitableForBookmarkFile,
        includingResourceValuesForKeys: nil, relativeTo: nil)
    try URL.writeBookmarkData(data, to: URL(fileURLWithPath: stagePath))

    let icon = NSWorkspace.shared.icon(forFile: "/Applications")
    icon.size = NSSize(width: 512, height: 512)
    NSWorkspace.shared.setIcon(icon, forFile: stagePath)
    print("Finder alias created with icon")
} catch {
    print("Warning: alias failed, falling back to symlink: \(error)")
}
  '
  # Ensure Applications entry exists (symlink fallback if alias failed)
  if [ ! -e "$STAGE_DIR/Applications" ]; then
    ln -s /Applications "$STAGE_DIR/Applications"
  fi

  # Layout: VibesOS (left) → Applications (right)
  create-dmg \
    --volname "$APP_NAME" \
    --background "$DMG_BG" \
    --window-pos 200 100 \
    --window-size 1024 576 \
    --icon-size 120 \
    --icon "$APP_NAME.app" 350 285 \
    --icon "Applications" 700 285 \
    --no-internet-enable \
    "$ORIG_DMG" \
    "$STAGE_DIR" \
    2>&1

  rm -rf "$STAGE_DIR"

  # Set custom icon on the .dmg file itself (Finder display)
  if [ -f "$DMG_ICON_PNG" ]; then
    # Apply macOS squircle mask to the DMG icon — same CGPath continuous-corner
    # approach used for the app icon (step 3). Without this, the resource-fork
    # icon shows dark corner fringing because Finder doesn't auto-mask DMG icons.
    MASKED_PNG="/tmp/dmg-icon-masked.png"
    swift -e '
import CoreGraphics
import ImageIO
let size = 1024
let radius = CGFloat(size) * 0.23
let srcUrl = URL(fileURLWithPath: "'"$DMG_ICON_PNG"'")
guard let provider = CGDataProvider(url: srcUrl as CFURL),
      let srcImage = CGImage(pngDataProviderSource: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
else { exit(1) }
let rect = CGRect(x: 0, y: 0, width: size, height: size)
let squirclePath = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: size, height: size,
                          bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { exit(1) }
ctx.setShouldAntialias(false)
ctx.addPath(squirclePath)
ctx.clip()
ctx.setShouldAntialias(true)
ctx.draw(srcImage, in: rect)
guard let masked = ctx.makeImage() else { exit(1) }
let outUrl = URL(fileURLWithPath: "'"$MASKED_PNG"'") as CFURL
guard let dest = CGImageDestinationCreateWithURL(outUrl, "public.png" as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(dest, masked, nil)
CGImageDestinationFinalize(dest)
' 2>/dev/null && DMG_ICON_SRC="$MASKED_PNG" || DMG_ICON_SRC="$DMG_ICON_PNG"

    DMG_ICONSET="/tmp/dmg-icon.iconset"
    rm -rf "$DMG_ICONSET"
    mkdir -p "$DMG_ICONSET"
    sips -z 1024 1024 "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_512x512@2x.png" 2>/dev/null
    sips -z 512  512  "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_512x512.png"    2>/dev/null
    sips -z 512  512  "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_256x256@2x.png" 2>/dev/null
    sips -z 256  256  "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_256x256.png"    2>/dev/null
    sips -z 256  256  "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_128x128@2x.png" 2>/dev/null
    sips -z 128  128  "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_128x128.png"    2>/dev/null
    sips -z 64   64   "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_32x32@2x.png"   2>/dev/null
    sips -z 32   32   "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_32x32.png"      2>/dev/null
    sips -z 32   32   "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_16x16@2x.png"   2>/dev/null
    sips -z 16   16   "$DMG_ICON_SRC" --out "$DMG_ICONSET/icon_16x16.png"      2>/dev/null
    DMG_ICNS="/tmp/dmg-icon.icns"
    iconutil -c icns "$DMG_ICONSET" -o "$DMG_ICNS"
    sips -i "$DMG_ICNS" 2>/dev/null || true
    DeRez -only icns "$DMG_ICNS" > /tmp/dmg-icon.rsrc 2>/dev/null || true
    if [ -s /tmp/dmg-icon.rsrc ]; then
      Rez -append /tmp/dmg-icon.rsrc -o "$ORIG_DMG"
      SetFile -a C "$ORIG_DMG"
      rm -f /tmp/dmg-icon.rsrc
      echo "  DMG file icon set from dmg-icon.png"
    fi
    rm -rf "$DMG_ICONSET" "$DMG_ICNS" "$MASKED_PNG"
  fi

  echo "  DMG created: $ORIG_DMG"
else
  echo "  Skipping DMG (missing app icon)."
fi

echo ""
echo "=== Build complete ==="
echo "Output: $ARTIFACTS_DIR/"
