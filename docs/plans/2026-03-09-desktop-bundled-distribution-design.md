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

Investigation of the codebase revealed that the Claude subprocess (`claude -p`) is used **purely as a raw AI completion engine**. Across all 6 spawn sites in `scripts/server/handlers/`:

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

| Step | What happens | User sees | Duration |
|------|-------------|-----------|----------|
| 1. Find Claude | Check known paths for working `claude` binary | "Checking for Claude Code..." | <1s |
| 2. Install Claude (if needed) | Run `curl -sSL https://cli.anthropic.com/install.sh \| sh` | "Installing Claude Code..." | 30-60s |
| 3. Install Plugin | Copy plugin files from .app bundle → ~/.claude/plugins/ | "Setting up Vibes plugin..." | <1s |
| 4. Authenticate | Check Keychain for existing credentials | "Checking authentication..." | <1s |
| 4b. Auth (if needed) | Run `claude login`, which opens browser for OAuth | "Please sign in with your Anthropic account" | User-dependent |
| 5. Done | Write marker file, start server.ts | "Ready!" → editor opens | <1s |

**User A experience:** Step 1 finds their binary, step 2 skipped, step 3 adds plugin, step 4 finds credentials. Total: ~2 seconds.

**User B experience:** All steps execute. Total: ~30-60 seconds + one browser interaction.

**Auth is a hard gate.** No skip option. The app does not function without credentials. The only alternative to signing in is quitting.

### Binary Resolution

Uses existing `auth.ts` resolution logic. Order:

1. Check known paths: `~/.claude/local/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`, `~/.local/bin/claude`, `zsh -lc "which claude"`
2. If none found → run Anthropic's official installer → installs to `~/.claude/local/claude`
3. Re-run resolution
4. Cache resolved path in `~/.vibes/claude-bin-path` for fast subsequent launches

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

`plugin-discovery.ts` gains a priority check for the bundled path:

```typescript
const bundledPath = join(h, ".claude", "plugins", "cache", "vibes-bundled", "vibes");
// Check bundled path first, then fall through to existing logic
```

Desktop app always finds its own version-matched copy, even if User A has an older version from the marketplace.

### Setup UI

A local HTML page loaded via ElectroBun's `views://` protocol or `html:` constructor property. Status updates pushed via `executeJavascript()` (same pattern as existing LINK_PRELOAD injection). Transition to editor via `webview.loadURL(SERVER_URL)` (same pattern as existing reload handler).

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
[3/5] Bundle plugin files into .app Resources                (NEW)
[4/5] Build ElectroBun app                                   (existing)
[5/5] Create DMG                                             (modified)
```

**Step 3 — Bundle plugin files:**

```bash
rsync -a --exclude='.git' --exclude='node_modules' --exclude='vibes-desktop' \
         --exclude='deploy-api' --exclude='.claude' --exclude='scripts/__tests__' \
         --exclude='docs/plans' "$REPO_ROOT/" "$DESKTOP_DIR/resources/vibes-plugin/"
```

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
| Large .app size from bundled plugin | Plugin tree is ~15MB; acceptable |
