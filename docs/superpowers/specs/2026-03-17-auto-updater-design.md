# ElectroBun Auto-Updater

## Problem

Users must manually download and reinstall the DMG to get new versions of VibesOS. There's no in-app update mechanism. ElectroBun has a built-in Updater API that supports incremental patches and full downloads, but it's completely unwired in our app.

## Design

### Update Hosting

The existing install worker at `install.vibesos.com` (backed by the `vibesos-releases` R2 bucket) serves update artifacts under an `/updates/` path prefix. ElectroBun's build produces `stable-macos-arm64-update.json` (version manifest with hash) and `stable-macos-arm64-VibesOS.app.tar.zst` (compressed app bundle). These are uploaded to R2 alongside the DMG.

The install worker gains a new route: `GET /updates/*` serves files from the `updates/` prefix in R2. The worker detects Content-Type from file extension: `.json` → `application/json`, `.tar.zst` → `application/octet-stream`, `.patch` → `application/octet-stream`. ElectroBun's updater constructs URLs as `{baseUrl}/{platformPrefix}-update.json`, so with `baseUrl` set to `https://install.vibesos.com/updates`, it fetches `https://install.vibesos.com/updates/stable-macos-arm64-update.json`.

`electrobun.config.ts` gets a `release` section with `baseUrl`:

```typescript
release: {
    baseUrl: "https://install.vibesos.com/updates",
},
```

**Bootstrap note:** The first version built with `baseUrl` configured must be manually installed (via DMG). Only apps built with `baseUrl` know where to check for updates. Older installed versions without `baseUrl` will not self-update.

### Update Check Flow

On every launch, after the setup-complete check and auth verification but **before** starting the server and loading the editor:

1. Call `Updater.checkForUpdate()` to fetch remote `update.json` and compare hashes
2. If error or no update available → proceed to editor normally
3. If update available → check skip tracking (see below), then show update prompt

The check is wrapped in a 5-second timeout via `Promise.race`. If the network is down, slow, or the server is unreachable, the app proceeds to the editor silently. Updates are optional, never gating.

### Update UI

Reuse the setup screen's terminal-styled component (`setup-html.ts`). Add new hidden DOM elements to the existing HTML (same pattern as the welcome screen's `showLoginScreen()`) with a JS function `showUpdateScreen(currentVersion, newVersion)` to display them.

The screen shows: current version, available version, and two buttons: **Update Now** and **Skip**.

- **Update Now**: Calls `Updater.downloadUpdate()`. Wire `Updater.onStatusChange()` to the terminal UI's progress bar — this callback emits `download-progress` events with `{ bytesDownloaded, totalBytes, progress }` since `downloadUpdate()` itself does not return progress. On completion, calls `Updater.applyUpdate()` which quits the app, replaces binaries, and relaunches automatically.
- **Skip**: Proceeds directly to the editor. The user is not prompted again until a newer version is available.

Button handling uses the existing setup IPC pattern (`waitForSetupAction` / `setup-ipc.ts`). **Important:** `stopSetupIpc()` (currently called on line 240 of index.ts after setup completes) must be deferred until after both the setup AND update flows complete, so the IPC server remains available for the update UI.

### Skip Tracking

When the user clicks Skip, store the skipped update's **hash** (not version string) in `~/.vibes/skipped-update.json` (`{ "hash": "3go85s6b9cmk" }`). On next launch, if `checkForUpdate()` returns an update whose hash matches the skipped hash, proceed silently. If a different hash is available (new build, even at the same version), prompt again. This prevents stale skips across rebuilds at the same version.

### Upload Pipeline

Extend the existing `/vibes:upload-dmg` skill to upload update artifacts alongside the DMG. After uploading the DMG, the skill:

1. Uploads `stable-macos-arm64-update.json` to R2 at `updates/stable-macos-arm64-update.json`
2. Uploads `stable-macos-arm64-VibesOS.app.tar.zst` to R2 at `updates/stable-macos-arm64-VibesOS.app.tar.zst`
3. Globs for `*.patch` files in `vibes-desktop/artifacts/` and uploads each to R2 at `updates/{filename}` (ElectroBun generates patches against previous versions when `baseUrl` is configured; the first build won't have patches, subsequent builds will)

Same `INSTALL_UPLOAD_KEY` authentication, same `PUT /upload` endpoint with `?filename=updates/...` path parameter. The worker's upload handler must set `httpMetadata.contentType` based on file extension rather than hardcoding DMG content type.

### Error Handling

- **Network failure / timeout during check**: Log warning, proceed to editor. Never block app launch on update check. 5-second timeout.
- **Download failure**: Show error in the terminal UI ("Download failed — try again later"), offer Skip button to continue to editor.
- **Apply failure**: ElectroBun handles this internally — if patch application fails, it falls back to full download. If that also fails, the user continues with the current version.

## Files to Modify

| File | Change |
|------|--------|
| `vibes-desktop/electrobun.config.ts` | Add `release: { baseUrl: "https://install.vibesos.com/updates" }` section |
| `vibes-desktop/src/bun/update-check.ts` | **New file.** Update check logic: `checkForUpdate()` with timeout, skip tracking, download with progress via `onStatusChange`, apply. Follows pattern of `setup.ts`, `claude-auth.ts`. |
| `vibes-desktop/src/bun/index.ts` | Add update check between auth and server start; call `update-check.ts` functions; defer `stopSetupIpc()` until after update flow |
| `vibes-desktop/src/bun/setup-html.ts` | Add update prompt screen (`showUpdateScreen`, `showUpdateProgress`, `showUpdateError`) as hidden DOM elements in existing HTML, matching terminal style |
| `scripts/install-worker/worker.js` | Add `GET /updates/*` route; detect Content-Type from extension; set `httpMetadata.contentType` on upload based on extension |
| `skills/upload-dmg/SKILL.md` | Extend to upload `update.json`, `.tar.zst`, and `*.patch` files alongside DMG |

## Out of Scope

- Automatic background updates (user must approve)
- Multiple update channels (canary/beta) — stable only for now
- Windows/Linux builds — macOS arm64 only
- Rollback mechanism — ElectroBun doesn't support downgrading
