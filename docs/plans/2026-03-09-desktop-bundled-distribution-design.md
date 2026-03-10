# Desktop Bundled Distribution Design

**Date:** 2026-03-09
**Status:** Approved design, ready for implementation planning

## Problem

VibesOS desktop app has two brittle runtime dependencies:
1. Claude Code binary must be installed on the user's system
2. The vibes-skill plugin must be registered in Claude Code's plugin infrastructure

The current install flow requires users to double-click a `.command` file (a shell script) that attempts to install both. This breaks for users unfamiliar with terminals and fails silently in many edge cases.

## Goal

A standard Mac DMG install experience — drag to Applications, launch, everything works — for two user classes:

- **User A:** Already has Claude Code installed, but not the vibes plugin
- **User B:** Has neither Claude Code nor the plugin

No terminal interaction. No `.command` files. No understanding of developer tooling required.

## Key Discovery

Investigation of the codebase revealed that the Claude subprocess (`claude -p`) is used **purely as a raw AI completion engine**. Across 6 Claude subprocess call sites in 4 handler files (chat, generate, theme, create-theme):

- Zero `--plugin` or `--plugin-dir` flags
- Zero skill invocations in prompts
- Tools are explicitly restricted per handler
- `--disable-slash-commands` and `--disallowed-tools ToolSearch,Skill` added when tools are restricted
- SKILL.md content is inlined as plain text context

The server.ts is the orchestrator — it reads plugin files directly from disk via `plugin-discovery.ts`, builds prompts, and passes them to `claude -p -` on stdin. Claude Code never needs to know about the vibes plugin for subprocess calls.

However, the plugin files should still be installed in Claude Code's documented plugin path structure so that skills are available if the user also uses Claude Code interactively (terminal mode).

## Legal Constraint

Claude Code is proprietary software ("© Anthropic PBC. All rights reserved."). The Commercial Terms and Consumer Terms do not grant rights to bundle, redistribute, or embed the Claude Code binary inside another application. Therefore:

- **Cannot:** Ship the `claude` binary inside the DMG
- **Can:** Use Anthropic's official installer at runtime to install Claude Code
- **Can:** Ship our own plugin files (our code, our license) inside the DMG

This rules out a fully-offline "ship everything" approach. The first launch requires internet to download Claude Code (if not already installed).

## Architecture

### Components

| Component | Ships in DMG? | Location on disk | Managed by |
|-----------|--------------|-----------------|------------|
| VibesOS.app | Yes | /Applications/VibesOS.app | User (drag to install) |
| Plugin files | Yes (inside .app) | ~/.claude/plugins/cache/vibes-bundled/vibes/{version}/ | First-launch setup |
| Claude binary | No | ~/.claude/local/claude (Anthropic's default) | Anthropic's installer |
| OAuth credentials | No | macOS Keychain | Claude Code login flow |
| Setup marker | No | ~/.vibes/setup-complete-{version} | Setup flow |

### First-Launch Setup Flow

Every launch checks for `~/.vibes/setup-complete-{version}`. If missing, the setup flow runs inside the native app window.

**Version upgrades vs first install:** The marker file encodes the app version. When a user upgrades the app, the old marker won't match the new version, triggering setup. But the setup flow is smart about it — step 1 will find the existing Claude binary (skip install), step 3 will update the plugin files (version comparison), and step 4 will find existing credentials (skip auth). A version upgrade runs the same flow but completes in ~2 seconds since only plugin files need copying.

| Step | What happens | User sees | Duration |
|------|-------------|-----------|----------|
| 1. Find Claude | Check known paths for working `claude` binary | "Checking for Claude Code..." | <1s |
| 2. Install Claude (if needed) | Run `curl -sSL https://cli.anthropic.com/install.sh \| sh` | "Installing Claude Code..." | 30-60s |
| 3. Install Plugin | Copy plugin files from .app bundle → ~/.claude/plugins/ | "Setting up Vibes plugin..." | <1s |
| 4. Authenticate | Run `claude auth status` (or `claude --version` + test invocation) to probe for valid credentials | "Checking authentication..." | <2s |
| 4b. Auth (if needed) | Run `claude login`, which opens browser for Anthropic OAuth | "Please sign in with your Anthropic account" | User-dependent |
| 5. Done | Write marker file, start server.ts | "Ready!" → editor opens | <1s |

**User A experience:** Step 1 finds their binary, step 2 skipped, step 3 adds plugin, step 4 finds credentials. Total: ~2 seconds.

**User B experience:** All steps execute. Total: ~30-60 seconds + one browser interaction.

**Auth is a hard gate.** No skip option. The app does not function without credentials. The only alternative to signing in is quitting.

### Binary Resolution

Uses existing `auth.ts` resolution logic. Order:

1. Try `zsh` with flags `-lic`, `-lc`, `-ic` to resolve via user's shell PATH
2. Check known paths: `~/.claude/local/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`, `~/.local/bin/claude`, `~/.npm-global/bin/claude`
3. If none found → run Anthropic's official installer → installs to `~/.claude/local/claude`
4. Re-run resolution
5. Cache resolved path in `~/.vibes/claude-bin-path` for fast subsequent launches

We do not install to a custom path. Anthropic's installer puts the binary where it puts it. We discover and remember.

### Plugin Installation Mechanics

**What ships inside the .app:**

```
VibesOS.app/Contents/Resources/
  vibes-plugin/
    .claude-plugin/
      plugin.json
      marketplace.json
    skills/
    scripts/
    bundles/
    source-templates/
    build/
    docs/
    ...
```

**Where it goes:**

```
~/.claude/plugins/
  cache/
    vibes-bundled/
      vibes/
        {version}/
          (full plugin tree)
  installed_plugins.json  ← merge, never overwrite
  known_marketplaces.json ← merge, never overwrite
```

**Merge logic for installed_plugins.json:**

Read existing file (or start with empty structure). Handle v2 format `{ version: 2, plugins: { ... } }`. Add or update key `"vibes@vibes-bundled"` with the install path and version. Write back with all other entries untouched. Use atomic write (temp file + rename).

**Merge logic for known_marketplaces.json:**

Read existing file (or start with empty structure). Add or update key `"vibes-bundled"` with `source: { source: "local", path: "bundled-with-vibes-desktop" }`. Write back with all other entries untouched.

**Safety rules:**
- Never overwrite entire files — always read-merge-write
- Never delete other plugins or marketplace entries
- If User A has `vibes@claude-plugins-official`, we install alongside as `vibes@vibes-bundled` — no conflict
- Atomic writes to prevent corruption

### Plugin Discovery Change

`plugin-discovery.ts` currently has a 4-stage discovery order: (1) dev override via env/file, (2) walk-up from main script, (3) `installed_plugins.json` lookup, (4) cache directory scan.

The bundled-path check inserts **after dev overrides (stages 1-2) but before the JSON/cache lookup (stages 3-4)**. This ensures the desktop app always finds its own version-matched copy while still allowing dev overrides for development:

```typescript
// After dev override checks (stages 1-2), before installed_plugins.json lookup:
const bundledPath = join(h, ".claude", "plugins", "cache", "vibes-bundled", "vibes");
// Find latest version dir, validate, return if found
// ...then fall through to existing stages 3-4
```

Desktop app always finds its own version-matched copy, even if User A has an older version from the marketplace.

### Setup UI

A local HTML page loaded via ElectroBun's `html:` constructor property (inline HTML string). This matches the existing pattern where LINK_PRELOAD is injected as an inline string. The `views://` protocol is an alternative but unused in the current codebase, so `html:` is preferred for consistency. Status updates pushed via `executeJavascript()` (same pattern as existing LINK_PRELOAD injection). Transition to editor via `webview.loadURL(SERVER_URL)` (same pattern as existing reload handler).

**Note on auth scope:** This setup handles Anthropic account authentication (for the Claude CLI to function). Pocket ID authentication (for deploy and sharing features) is a separate concern handled by the deploy handler at runtime — not part of the setup flow.

Visual: centered card, VibesOS logo, step indicators (✓ done, ● active, ○ pending). No percentages, no ETAs, no choices except the auth button.

**Failure handling:**

| Scenario | Behavior |
|----------|----------|
| Network failure during Claude install | Retry button + "Connect to internet and try again" |
| Auth cancelled / browser closed | "Sign-in not completed" + retry button |
| Install script fails | Link to manual install instructions + retry |
| Auth timeout | Re-prompt |

### Update Strategy

| Component | Update mechanism | Trigger |
|-----------|-----------------|---------|
| Claude binary | Anthropic's own updater | Not our concern |
| Plugin files | New VibesOS.app version | On launch: compare bundled vs installed version |
| VibesOS.app | New DMG download | User downloads from website |

Plugin version sync on every launch:
```
bundled_version = .app/Contents/Resources/vibes-plugin/plugin.json → version
installed_version = ~/.claude/plugins/cache/vibes-bundled/vibes/*/plugin.json → version
if mismatch: copy bundled → installed, update installed_plugins.json
```

## Build Pipeline Changes

`build-desktop.sh` updated steps:

```
[1/5] Sync version from plugin.json → electrobun.config.ts  (existing)
[2/5] Compile native dylib                                   (existing)
[3/5] Build ElectroBun app                                   (existing, was step 3)
[4/5] Bundle plugin files into .app Resources                (NEW — runs AFTER build)
[5/5] Create DMG                                             (modified)
```

**Step 4 — Bundle plugin files (post-build):**

Plugin files must be copied into the already-built `.app` bundle, not before the build. This follows the same pattern as `post-build.ts` which copies `libWindowControls.dylib` into the built app. The plugin bundling can be done either via the `postBuild` ElectroBun hook (extending `post-build.ts`) or in `build-desktop.sh` after `bunx electrobun build` completes.

Recommended: do it in `build-desktop.sh` after the build step, since it's a large rsync operation better suited to a shell script than a TypeScript hook.

```bash
APP_RESOURCES="$BUILD_DIR/$APP_NAME.app/Contents/Resources"
PLUGIN_DEST="$APP_RESOURCES/vibes-plugin"
rm -rf "$PLUGIN_DEST"
rsync -a \
  --exclude='.git' --exclude='.git-backup' --exclude='node_modules' \
  --exclude='vibes-desktop' --exclude='deploy-api' --exclude='.claude' \
  --exclude='scripts/__tests__' --exclude='scripts/coverage' \
  --exclude='docs/plans' --exclude='alchemy' \
  --exclude='skills/cloudflare/worker' --exclude='superpowers' \
  --exclude='.netlify-deploy' --exclude='*.bak.*' --exclude='*.bak.jsx' \
  "$REPO_ROOT/" "$PLUGIN_DEST/"
```

With these exclusions, the plugin tree is **~12MB** (verified by measurement). The full repo is 450MB+ due to `node_modules`, `.git-backup`, alchemy, and worker source — none of which are needed at runtime.

**Runtime path discovery:** `setup.ts` finds the bundled plugin at runtime via `import.meta.dir` (Bun's equivalent of `__dirname`), navigating up to `Contents/Resources/vibes-plugin/`. This matches how the existing `post-build.ts` uses `process.cwd()` relative paths.

**Step 5 — Simplified DMG:**

Two icons instead of three. The `.command` file is removed.

```
VibesOS.app (left) → Applications (right)
```

Standard drag-to-install. Nothing to explain.

## Files Changed

**New files:**

| File | Purpose |
|------|---------|
| `vibes-desktop/resources/setup.html` | First-launch setup UI |
| `vibes-desktop/src/bun/setup.ts` | Setup orchestration (install Claude, copy plugin, auth) |

**Modified files:**

| File | Change |
|------|--------|
| `vibes-desktop/src/bun/index.ts` | Check setup marker → run setup or start editor |
| `vibes-desktop/src/bun/plugin-discovery.ts` | Add bundled-path priority check |
| `vibes-desktop/src/bun/auth.ts` | Add `installClaude()` using official installer |
| `scripts/build-desktop.sh` | Add plugin bundling step, simplify DMG layout |

**Removed files:**

| File | Reason |
|------|--------|
| `scripts/install-vibes.command` | Replaced by in-app setup flow |

## Risks

| Risk | Mitigation |
|------|------------|
| Anthropic changes install script URL | Pin to known URL, fallback to npm install |
| Claude binary update breaks `claude -p` contract | Server already handles stream-json parsing; contract is stable |
| Keychain credential format changes | `claude login` handles this; we don't touch credentials directly |
| Plugin cache structure changes in Claude Code | Version marker triggers re-setup; merge logic is defensive |
| Large .app size from bundled plugin | Plugin tree is ~12MB with proper exclusions (verified); acceptable |
| macOS sandbox blocks `curl \| sh` installer | ElectroBun apps are NOT sandboxed (confirmed: no App Sandbox entitlements in config); the app runs as a normal macOS process with full filesystem/network access |
