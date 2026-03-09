# Desktop Build Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge the desktop branch into main and create a one-command build script that produces a `.app` from the current codebase.

**Architecture:** `vibes-desktop/` lives in the repo as a subdirectory. Shared file changes (`server.ts`, `editor.html`) are backward-compatible. A single build script compiles the native dylib and runs the ElectroBun build.

**Tech Stack:** Bash, ElectroBun, xcrun/clang++ (ObjC++ dylib), Bun

---

### Task 1: Clean up the desktop branch for merge

The desktop branch carries 17 commits including early design docs and a massive implementation plan (4016 lines) that are no longer relevant — the actual implementation diverged significantly. Clean these up before merging.

**Files:**
- Delete: `docs/plans/2026-03-08-vibes-desktop-editor-design.md` (354 lines, superseded by thin-shell approach)
- Delete: `docs/plans/2026-03-08-vibes-desktop-editor-plan.md` (4016 lines, superseded — original parallel UI plan)
- Keep: `docs/plans/2026-03-08-vibes-desktop-thin-shell.md` (the actual plan we executed)
- Keep: `docs/plans/2026-03-09-desktop-build-pipeline-design.md` (current design)
- Delete: `vibes-desktop/README.md` (61 lines, written for the old parallel UI architecture)
- Delete: `vibes-desktop/llms.txt` (24 lines, written for the old architecture)

**Step 1: Delete obsolete planning docs and old README**

```bash
git rm docs/plans/2026-03-08-vibes-desktop-editor-design.md
git rm docs/plans/2026-03-08-vibes-desktop-editor-plan.md
git rm vibes-desktop/README.md
git rm vibes-desktop/llms.txt
```

**Step 2: Verify no references to deleted files**

```bash
grep -r "vibes-desktop-editor-design" docs/ || echo "No references"
grep -r "vibes-desktop-editor-plan" docs/ || echo "No references"
```

Expected: "No references" for both.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete desktop planning docs and old README"
```

---

### Task 2: Create the build script

**Files:**
- Create: `scripts/build-desktop.sh`

**Step 1: Write the build script**

```bash
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
```

**Step 2: Make it executable**

```bash
chmod +x scripts/build-desktop.sh
```

**Step 3: Test the script runs through step 1 (version sync)**

```bash
bash scripts/build-desktop.sh
```

Verify that `vibes-desktop/electrobun.config.ts` now shows the version from `.claude-plugin/plugin.json` (currently `0.1.79`).

**Step 4: Commit**

```bash
git add scripts/build-desktop.sh
git commit -m "feat: add one-command desktop build script"
```

---

### Task 3: Add native dylib build output to .gitignore

The compiled `.dylib` should not be committed — it's a build artifact that `build-desktop.sh` compiles from source.

**Files:**
- Modify: `vibes-desktop/.gitignore`

**Step 1: Check if dylib is currently tracked**

```bash
git ls-files vibes-desktop/native/macos/build/
```

If it shows files, untrack them:

```bash
git rm --cached vibes-desktop/native/macos/build/libWindowControls.dylib 2>/dev/null || true
```

**Step 2: Add native build output to .gitignore**

Add `native/macos/build/` to `vibes-desktop/.gitignore`. The existing `.gitignore` already has `build/` which covers `vibes-desktop/build/` (ElectroBun output), but `native/macos/build/` needs its own entry since it's in a subdirectory.

Verify: After adding, run `git status` and confirm the dylib no longer shows as tracked.

**Step 3: Commit**

```bash
git add vibes-desktop/.gitignore
git commit -m "chore: gitignore native dylib build output"
```

---

### Task 4: Merge desktop branch into main

**Step 1: Verify the branch is clean**

```bash
git status
git log main..desktop --oneline
```

**Step 2: Switch to main and merge**

```bash
git checkout main
git merge desktop --no-ff -m "feat: add vibes-desktop thin native shell with one-command build

Adds ElectroBun desktop app that embeds the existing web editor.
Shared file changes (server.ts, editor.html) are backward-compatible.
Build with: bun scripts/build-desktop.sh"
```

**Step 3: Verify merge**

```bash
git log --oneline -5
ls vibes-desktop/src/bun/
cat scripts/build-desktop.sh | head -5
```

Expected: merge commit visible, desktop files present, build script exists.

**Step 4: Verify plugin still works standalone**

```bash
bun scripts/server.ts --mode=editor &
sleep 3
curl -s http://localhost:3333 | head -5
kill %1
```

Expected: Server starts normally, serves editor HTML. The `import.meta.main` guard and `startServer()` changes don't affect CLI usage.

---

### Task 5: Test the full build pipeline

**Step 1: Run the build script**

```bash
bun scripts/build-desktop.sh
```

Expected output:
```
=== Vibes Desktop Build ===
[1/3] Syncing version: 0.1.79
[2/3] Compiling native dylib...
[3/3] Building ElectroBun app...
...
=== Build complete ===
Output: vibes-desktop/dist/
```

**Step 2: Verify the output**

```bash
ls vibes-desktop/dist/
```

Expected: A `.app` bundle or ElectroBun output directory.

**Step 3: Launch the built app and verify**

- Window opens without traffic light buttons
- Header is draggable (including to second monitor)
- Text input works in all fields
- App generates/edits apps via Claude
- Cmd+Q quits cleanly

---

### Task 6: Clean up the desktop branch

After successful merge, the desktop branch can be deleted.

**Step 1: Delete local branch**

```bash
git branch -d desktop
```

**Step 2: Verify main has everything**

```bash
git log --oneline -10
ls vibes-desktop/
```
