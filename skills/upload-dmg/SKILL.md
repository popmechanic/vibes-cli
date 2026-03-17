---
name: upload-dmg
description: Upload the latest desktop DMG to install.vibesos.com. Use when the user says "upload the DMG", "update install link", "push new DMG", or "release desktop app".
license: MIT
allowed-tools: Bash, Read
metadata:
  author: "Marcus Estes"
---

## Upload DMG to install.vibesos.com

Upload the latest built DMG to the install worker's R2 bucket.

### Steps

1. Read the version from plugin.json:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
VERSION=$(jq -r .version "$VIBES_ROOT/.claude-plugin/plugin.json")
echo "Version: $VERSION"
```

2. Verify the DMG exists:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
DMG_PATH="$VIBES_ROOT/vibes-desktop/artifacts/stable-macos-arm64-VibesOS.dmg"
if [ ! -f "$DMG_PATH" ]; then
  echo "ERROR: DMG not found at $DMG_PATH — run 'bash scripts/build-desktop.sh' first"
  exit 1
fi
ls -lh "$DMG_PATH"
```

3. Load the upload key from .env and upload:

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

4. Confirm the upload by reporting the version and download URL:

```
Uploaded VibesOS-{VERSION}.dmg
Download: https://install.vibesos.com
```
