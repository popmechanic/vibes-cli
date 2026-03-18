---
name: upload-dmg
description: Upload the latest desktop DMG and update artifacts to install.vibesos.com. Use when the user says "upload the DMG", "update install link", "push new DMG", or "release desktop app".
license: MIT
allowed-tools: Bash, Read
metadata:
  author: "Marcus Estes"
---

## Upload DMG and Update Artifacts to install.vibesos.com

Upload the latest built DMG and auto-updater artifacts to the install worker's R2 bucket.

### Steps

1. Read the version from plugin.json:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
VERSION=$(jq -r .version "$VIBES_ROOT/.claude-plugin/plugin.json")
echo "Version: $VERSION"
```

2. Verify the DMG and update artifacts exist:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
ARTIFACTS="$VIBES_ROOT/vibes-desktop/artifacts"
DMG_PATH="$ARTIFACTS/stable-macos-arm64-VibesOS.dmg"
if [ ! -f "$DMG_PATH" ]; then
  echo "ERROR: DMG not found at $DMG_PATH — run 'bash scripts/build-desktop.sh' first"
  exit 1
fi
ls -lh "$DMG_PATH"

# Check for update artifacts (optional — first build with baseUrl won't have them)
UPDATE_JSON="$ARTIFACTS/stable-macos-arm64-update.json"
UPDATE_TAR="$ARTIFACTS/stable-macos-arm64-VibesOS.app.tar.zst"
[ -f "$UPDATE_JSON" ] && echo "Found: $(basename $UPDATE_JSON)" || echo "No update.json (first build?)"
[ -f "$UPDATE_TAR" ] && echo "Found: $(basename $UPDATE_TAR) ($(ls -lh "$UPDATE_TAR" | awk '{print $5}'))" || echo "No .tar.zst (first build?)"
PATCH_COUNT=$(ls "$ARTIFACTS"/*.patch 2>/dev/null | wc -l | tr -d ' ')
echo "Patch files: $PATCH_COUNT"
```

3. Upload the DMG:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
VERSION=$(jq -r .version "$VIBES_ROOT/.claude-plugin/plugin.json")
DMG_PATH="$VIBES_ROOT/vibes-desktop/artifacts/stable-macos-arm64-VibesOS.dmg"
UPLOAD_KEY=$(grep INSTALL_UPLOAD_KEY "$VIBES_ROOT/.env" | cut -d= -f2)

curl -X PUT "https://install.vibesos.com/upload?filename=VibesOS-${VERSION}.dmg" \
  -H "X-Upload-Key: ${UPLOAD_KEY}" \
  --data-binary "@${DMG_PATH}" \
  --progress-bar -w "\nHTTP %{http_code}\n"
```

4. Upload update artifacts (update.json and .tar.zst):

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
ARTIFACTS="$VIBES_ROOT/vibes-desktop/artifacts"
UPLOAD_KEY=$(grep INSTALL_UPLOAD_KEY "$VIBES_ROOT/.env" | cut -d= -f2)

UPDATE_JSON="$ARTIFACTS/stable-macos-arm64-update.json"
UPDATE_TAR="$ARTIFACTS/stable-macos-arm64-VibesOS.app.tar.zst"

if [ -f "$UPDATE_JSON" ]; then
  echo "Uploading update.json..."
  curl -X PUT "https://install.vibesos.com/upload?filename=updates/stable-macos-arm64-update.json" \
    -H "X-Upload-Key: ${UPLOAD_KEY}" \
    --data-binary "@${UPDATE_JSON}" \
    -s -w "HTTP %{http_code}\n"
else
  echo "Skipping update.json (not found)"
fi

if [ -f "$UPDATE_TAR" ]; then
  echo "Uploading .tar.zst..."
  curl -X PUT "https://install.vibesos.com/upload?filename=updates/stable-macos-arm64-VibesOS.app.tar.zst" \
    -H "X-Upload-Key: ${UPLOAD_KEY}" \
    --data-binary "@${UPDATE_TAR}" \
    --progress-bar -w "\nHTTP %{http_code}\n"
else
  echo "Skipping .tar.zst (not found)"
fi
```

5. Upload patch files (if any):

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
ARTIFACTS="$VIBES_ROOT/vibes-desktop/artifacts"
UPLOAD_KEY=$(grep INSTALL_UPLOAD_KEY "$VIBES_ROOT/.env" | cut -d= -f2)

PATCHES=$(ls "$ARTIFACTS"/*.patch 2>/dev/null)
if [ -n "$PATCHES" ]; then
  for PATCH in $PATCHES; do
    BASENAME=$(basename "$PATCH")
    echo "Uploading patch: $BASENAME..."
    curl -X PUT "https://install.vibesos.com/upload?filename=updates/${BASENAME}" \
      -H "X-Upload-Key: ${UPLOAD_KEY}" \
      --data-binary "@${PATCH}" \
      -s -w "HTTP %{http_code}\n"
  done
else
  echo "No patch files to upload"
fi
```

6. Confirm the upload by reporting the version and download URL:

```
Uploaded VibesOS-{VERSION}.dmg + update artifacts
Download: https://install.vibesos.com
Update check: https://install.vibesos.com/updates/stable-macos-arm64-update.json
```
