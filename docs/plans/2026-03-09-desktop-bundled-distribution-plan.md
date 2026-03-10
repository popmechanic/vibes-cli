# Desktop Bundled Distribution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle `.command` installer with an in-app first-launch setup flow that automatically installs Claude Code, registers the vibes plugin, and handles authentication — so both first-time users and existing Claude Code users get a drag-to-install DMG experience.

**Architecture:** The .app bundle ships plugin files in `Contents/Resources/vibes-plugin/`. On first launch, a setup module copies them to `~/.claude/plugins/`, installs the Claude binary via Anthropic's official installer if needed, and gates on authentication. A version-stamped marker file skips setup on subsequent launches.

**Tech Stack:** ElectroBun (Bun runtime), TypeScript, bash (build script)

**Spec:** `docs/plans/2026-03-09-desktop-bundled-distribution-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `vibes-desktop/src/bun/plugin-installer.ts` | NEW — Copy plugin files from .app bundle to `~/.claude/plugins/`, merge JSON registrations |
| `vibes-desktop/src/bun/setup.ts` | NEW — Orchestrate first-launch flow: find/install Claude, install plugin, auth gate |
| `vibes-desktop/src/bun/setup-html.ts` | NEW — Export inline HTML string for setup UI |
| `vibes-desktop/src/bun/auth.ts` | MODIFY — Add `installClaude()` function |
| `vibes-desktop/src/bun/plugin-discovery.ts` | MODIFY — Add bundled-path priority check after dev overrides |
| `vibes-desktop/src/bun/index.ts` | MODIFY — Check setup marker, show setup UI or start editor |
| `scripts/build-desktop.sh` | MODIFY — Add plugin bundling step, simplify DMG layout |
| `scripts/install-vibes.command` | DELETE — Replaced by in-app setup |

---

## Task 1: Plugin Installer Module

The core file-copying and JSON-merging logic, isolated for clarity and testability.

**Files:**
- Create: `vibes-desktop/src/bun/plugin-installer.ts`

- [ ] **Step 1: Create plugin-installer.ts with types and helpers**

```typescript
// vibes-desktop/src/bun/plugin-installer.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface PluginInstallResult {
	installed: boolean;
	pluginRoot: string;
	version: string;
	skipped?: boolean; // true if already at correct version
}

/**
 * Read a JSON file, returning fallback if missing or malformed.
 */
function readJsonSafe(path: string, fallback: any): any {
	try {
		if (!existsSync(path)) return fallback;
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return fallback;
	}
}

/**
 * Atomic write: write to temp file, then rename.
 * Prevents corruption if process crashes mid-write.
 */
function atomicWriteJson(path: string, data: any): void {
	const tmp = path + ".tmp." + Date.now();
	writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
	renameSync(tmp, path);
}
```

- [ ] **Step 2: Add the main installPlugin function**

Add to the same file, after the helpers:

```typescript
/**
 * Copy plugin files from the .app bundle into ~/.claude/plugins/
 * and register in installed_plugins.json + known_marketplaces.json.
 *
 * Safe for User A (existing plugins) — merges, never overwrites.
 */
export async function installPlugin(bundledPluginPath: string): Promise<PluginInstallResult> {
	// Read version from bundled plugin.json
	const pluginJsonPath = join(bundledPluginPath, ".claude-plugin", "plugin.json");
	if (!existsSync(pluginJsonPath)) {
		throw new Error(`Bundled plugin.json not found at ${pluginJsonPath}`);
	}
	const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
	const version: string = pluginJson.version;

	const h = homedir();
	const pluginsDir = join(h, ".claude", "plugins");
	const cacheDir = join(pluginsDir, "cache", "vibes-bundled", "vibes", version);

	// Check if already installed at this version
	const existingPluginJson = join(cacheDir, ".claude-plugin", "plugin.json");
	if (existsSync(existingPluginJson)) {
		try {
			const existing = JSON.parse(readFileSync(existingPluginJson, "utf-8"));
			if (existing.version === version) {
				return { installed: true, pluginRoot: cacheDir, version, skipped: true };
			}
		} catch {}
	}

	// Copy plugin files via rsync (preserves structure, fast delta)
	mkdirSync(dirname(cacheDir), { recursive: true });
	const rsync = Bun.spawnSync([
		"rsync", "-a", "--delete",
		bundledPluginPath + "/",
		cacheDir + "/",
	], { timeout: 30_000 });

	if (rsync.exitCode !== 0) {
		throw new Error(`rsync failed: ${rsync.stderr.toString()}`);
	}

	// Merge into installed_plugins.json
	const installedPath = join(pluginsDir, "installed_plugins.json");
	const installed = readJsonSafe(installedPath, { version: 2, plugins: {} });

	// Normalize to v2 format
	if (!installed.version || !installed.plugins) {
		const oldPlugins = { ...installed };
		delete oldPlugins.version;
		installed.version = 2;
		installed.plugins = oldPlugins;
	}

	installed.plugins["vibes@vibes-bundled"] = [{
		name: "vibes",
		marketplace: "vibes-bundled",
		version,
		installPath: cacheDir,
		enabled: true,
	}];

	mkdirSync(pluginsDir, { recursive: true });
	atomicWriteJson(installedPath, installed);

	// Merge into known_marketplaces.json
	const marketplacesPath = join(pluginsDir, "known_marketplaces.json");
	const marketplaces = readJsonSafe(marketplacesPath, {});

	marketplaces["vibes-bundled"] = {
		name: "vibes-bundled",
		source: { source: "local", path: "bundled-with-vibes-desktop" },
		lastUpdated: Date.now(),
	};

	atomicWriteJson(marketplacesPath, marketplaces);

	return { installed: true, pluginRoot: cacheDir, version };
}
```

- [ ] **Step 3: Verify the module compiles**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/plugin-installer.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add vibes-desktop/src/bun/plugin-installer.ts
git commit -m "feat(desktop): add plugin installer module for first-launch setup"
```

---

## Task 2: Claude Binary Installer

Add an `installClaude()` function to the existing `auth.ts` that runs Anthropic's official installer.

**Files:**
- Modify: `vibes-desktop/src/bun/auth.ts`

- [ ] **Step 1: Add installClaude function to auth.ts**

Add after the `refreshClaudePath` function (after line 73):

```typescript
/**
 * Install Claude Code via Anthropic's official installer.
 * Returns the resolved path to the installed binary.
 * Throws if installation fails.
 */
export async function installClaude(): Promise<string> {
	const result = Bun.spawnSync(
		["sh", "-c", "curl -sSL https://cli.anthropic.com/install.sh | sh"],
		{ timeout: 120_000 }
	);

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		throw new Error(`Claude installation failed: ${stderr || "unknown error"}`);
	}

	// Re-resolve — installer puts binary at ~/.claude/local/claude
	refreshClaudePath();
	if (CLAUDE_BIN === "claude") {
		throw new Error("Claude installed but binary not found on PATH");
	}
	return CLAUDE_BIN;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/auth.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add vibes-desktop/src/bun/auth.ts
git commit -m "feat(desktop): add installClaude() for first-launch binary setup"
```

---

## Task 3: Plugin Discovery — Bundled Path Priority

Add a check for the `vibes-bundled` cache path after dev overrides but before the `installed_plugins.json` lookup.

**Files:**
- Modify: `vibes-desktop/src/bun/plugin-discovery.ts:76-78`

- [ ] **Step 1: Add bundled-path check between dev overrides and JSON lookup**

After the dev-mode walk-up block (line 76, after the closing `}`) and before `const h = home || homedir();` (line 78), insert:

```typescript
	// Desktop-bundled plugin: check vibes-bundled cache before installed_plugins.json
	const hBundled = home || homedir();
	const bundledCacheDir = join(hBundled, ".claude", "plugins", "cache", "vibes-bundled", "vibes");
	if (existsSync(bundledCacheDir)) {
		try {
			const versions = readdirSync(bundledCacheDir).filter(v => !v.startsWith("."));
			if (versions.length > 0) {
				const latestVersion = versions.sort().pop()!;
				const bundledRoot = join(bundledCacheDir, latestVersion);
				const bundledResult = validateAndReturn(bundledRoot);
				if (bundledResult) {
					console.log(`[plugin-discovery] Desktop-bundled: ${bundledRoot}`);
					return bundledResult;
				}
			}
		} catch {}
	}
```

- [ ] **Step 2: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/plugin-discovery.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add vibes-desktop/src/bun/plugin-discovery.ts
git commit -m "feat(desktop): prioritize bundled plugin in discovery order"
```

---

## Task 4: Setup UI HTML

An inline HTML string for the setup screen. Kept in its own file to avoid cluttering setup.ts.

**Files:**
- Create: `vibes-desktop/src/bun/setup-html.ts`

- [ ] **Step 1: Create setup-html.ts**

```typescript
// vibes-desktop/src/bun/setup-html.ts
// Inline HTML for the first-launch setup screen.
// Loaded via BrowserWindow({ html: ... }) — no external assets.

export const SETUP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibesOS Setup</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
  }
  .card {
    text-align: center;
    max-width: 420px;
    padding: 48px 40px;
  }
  .logo {
    font-size: 48px;
    margin-bottom: 8px;
    letter-spacing: -1px;
    font-weight: 700;
    background: linear-gradient(135deg, #a78bfa, #60a5fa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 40px;
  }
  .steps {
    text-align: left;
    margin-bottom: 32px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    font-size: 15px;
    color: #666;
    transition: color 0.3s;
  }
  .step.active { color: #e0e0e0; }
  .step.done { color: #4ade80; }
  .step.error { color: #f87171; }
  .step-icon {
    width: 20px;
    text-align: center;
    font-size: 14px;
  }
  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid #444;
    border-top-color: #a78bfa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .auth-btn {
    -webkit-app-region: no-drag;
    background: linear-gradient(135deg, #7c3aed, #3b82f6);
    color: white;
    border: none;
    padding: 12px 32px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: none;
    margin: 0 auto;
    transition: opacity 0.2s;
  }
  .auth-btn:hover { opacity: 0.9; }
  .retry-btn {
    -webkit-app-region: no-drag;
    background: #333;
    color: #e0e0e0;
    border: 1px solid #555;
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    display: none;
    margin: 8px auto 0;
  }
  .retry-btn:hover { background: #444; }
  .error-detail {
    font-size: 13px;
    color: #f87171;
    margin-top: 12px;
    display: none;
    text-align: center;
  }
</style>
</head>
<body>
<div class="card">
  <div class="logo">VibesOS</div>
  <div class="subtitle">Setting up your environment</div>
  <div class="steps">
    <div class="step" id="step-claude">
      <span class="step-icon" id="icon-claude">○</span>
      <span id="label-claude">Checking for Claude Code...</span>
    </div>
    <div class="step" id="step-plugin">
      <span class="step-icon" id="icon-plugin">○</span>
      <span id="label-plugin">Setting up Vibes plugin...</span>
    </div>
    <div class="step" id="step-auth">
      <span class="step-icon" id="icon-auth">○</span>
      <span id="label-auth">Authentication</span>
    </div>
  </div>
  <button class="auth-btn" id="auth-btn" onclick="window.__electrobunSendToHost({type:'setup-action',action:'auth'})">
    Sign in with Anthropic
  </button>
  <button class="retry-btn" id="retry-btn" onclick="window.__electrobunSendToHost({type:'setup-action',action:'retry'})">
    Retry
  </button>
  <div class="error-detail" id="error-detail"></div>
</div>
<script>
function updateStep(id, state, label) {
  var step = document.getElementById('step-' + id);
  var icon = document.getElementById('icon-' + id);
  if (!step || !icon) return;
  step.className = 'step ' + state;
  if (state === 'done') icon.innerHTML = '✓';
  else if (state === 'active') icon.innerHTML = '<span class="spinner"></span>';
  else if (state === 'error') icon.innerHTML = '✗';
  else icon.innerHTML = '○';
  if (label) document.getElementById('label-' + id).textContent = label;
}
function showAuthButton(show) {
  document.getElementById('auth-btn').style.display = show ? 'block' : 'none';
}
function showRetryButton(show) {
  document.getElementById('retry-btn').style.display = show ? 'block' : 'none';
}
function showError(msg) {
  var el = document.getElementById('error-detail');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}
function showReady() {
  document.querySelector('.subtitle').textContent = 'Ready!';
  document.querySelector('.subtitle').style.color = '#4ade80';
}
</script>
</body>
</html>`;
```

- [ ] **Step 2: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/setup-html.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add vibes-desktop/src/bun/setup-html.ts
git commit -m "feat(desktop): add setup screen HTML for first-launch flow"
```

---

## Task 5: Setup Orchestrator

Ties together Claude installation, plugin installation, and auth. Auth is a **placeholder** pending further iteration with the Loom skill.

**Files:**
- Create: `vibes-desktop/src/bun/setup.ts`

- [ ] **Step 1: Create setup.ts**

```typescript
// vibes-desktop/src/bun/setup.ts
// First-launch setup orchestrator.
// Auth flow is a PLACEHOLDER — pending Loom skill integration for OAuth method.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { BrowserWindow } from "electrobun/bun";
import { SETUP_HTML } from "./setup-html.ts";
import { CLAUDE_BIN, refreshClaudePath, installClaude } from "./auth.ts";
import { installPlugin } from "./plugin-installer.ts";

const VIBES_DIR = join(homedir(), ".vibes");

export interface SetupResult {
	claudeBin: string;
	pluginRoot: string;
}

/**
 * Check if setup has already completed for this app version.
 */
export function isSetupComplete(appVersion: string): boolean {
	const marker = join(VIBES_DIR, `setup-complete-${appVersion}`);
	return existsSync(marker);
}

/**
 * Write the setup-complete marker for this version.
 */
function markSetupComplete(appVersion: string): void {
	mkdirSync(VIBES_DIR, { recursive: true });
	writeFileSync(join(VIBES_DIR, `setup-complete-${appVersion}`), new Date().toISOString());
}

/**
 * Resolve the path to the bundled plugin inside the .app bundle.
 * Uses import.meta.dir to find the bun source dir, then navigates
 * up to Contents/Resources/vibes-plugin/.
 *
 * Layout:
 *   VibesOS.app/Contents/Resources/app/bun/index.ts  (this file's dir)
 *   VibesOS.app/Contents/Resources/vibes-plugin/      (target)
 */
export function getBundledPluginPath(): string | null {
	// In production: import.meta.dir is inside Contents/Resources/app/bun/
	// Navigate: bun/ → app/ → Resources/ → vibes-plugin/
	const candidates = [
		join(dirname(import.meta.dir), "..", "vibes-plugin"),    // production .app
		join(dirname(import.meta.dir), "..", "..", ".."),         // dev mode (vibes-skill root)
	];

	for (const candidate of candidates) {
		const pluginJson = join(candidate, ".claude-plugin", "plugin.json");
		if (existsSync(pluginJson)) return candidate;
	}
	return null;
}

/**
 * Run the first-launch setup flow.
 * Shows a setup UI in the provided window and orchestrates:
 *   1. Find or install Claude Code binary
 *   2. Copy plugin files to ~/.claude/plugins/
 *   3. Authenticate (PENDING — Loom skill will provide OAuth method)
 *
 * Returns when setup is complete. Throws on unrecoverable failure.
 */
export async function runSetup(
	mainWindow: BrowserWindow,
	appVersion: string,
	log: (...args: any[]) => void,
): Promise<SetupResult> {
	// Show setup UI
	mainWindow.webview.loadHTML(SETUP_HTML);

	// Helper to push status updates to the UI
	const ui = {
		step: (id: string, state: string, label?: string) => {
			const labelArg = label ? `, "${label.replace(/"/g, '\\"')}"` : "";
			mainWindow.webview.executeJavascript(`updateStep("${id}", "${state}"${labelArg})`);
		},
		showAuth: (show: boolean) =>
			mainWindow.webview.executeJavascript(`showAuthButton(${show})`),
		showRetry: (show: boolean) =>
			mainWindow.webview.executeJavascript(`showRetryButton(${show})`),
		showError: (msg: string) =>
			mainWindow.webview.executeJavascript(`showError("${msg.replace(/"/g, '\\"')}")`),
		ready: () =>
			mainWindow.webview.executeJavascript(`showReady()`),
	};

	// Small delay so the UI renders before we start work
	await new Promise(r => setTimeout(r, 300));

	// --- Step 1: Find or install Claude ---
	ui.step("claude", "active", "Checking for Claude Code...");
	log("[setup] Checking for Claude binary...");

	let claudeBin: string;
	refreshClaudePath();

	if (CLAUDE_BIN !== "claude" && existsSync(CLAUDE_BIN)) {
		claudeBin = CLAUDE_BIN;
		log(`[setup] Claude found at ${claudeBin}`);
		ui.step("claude", "done", "Claude Code found");
	} else {
		ui.step("claude", "active", "Installing Claude Code...");
		log("[setup] Claude not found, installing...");
		try {
			claudeBin = await installClaude();
			log(`[setup] Claude installed at ${claudeBin}`);
			ui.step("claude", "done", "Claude Code installed");
		} catch (err: any) {
			log(`[setup] Claude installation failed: ${err.message}`);
			ui.step("claude", "error", "Installation failed");
			ui.showError(err.message);
			ui.showRetry(true);
			// Wait for retry action from UI
			claudeBin = await waitForRetry(mainWindow, async () => {
				ui.showRetry(false);
				ui.showError("");
				ui.step("claude", "active", "Installing Claude Code...");
				return await installClaude();
			}, log);
			ui.step("claude", "done", "Claude Code installed");
		}
	}

	// --- Step 2: Install plugin ---
	ui.step("plugin", "active", "Setting up Vibes plugin...");
	log("[setup] Installing plugin...");

	const bundledPath = getBundledPluginPath();
	if (!bundledPath) {
		throw new Error("Bundled plugin not found in app resources");
	}

	const pluginResult = await installPlugin(bundledPath);
	if (pluginResult.skipped) {
		log(`[setup] Plugin already at version ${pluginResult.version}, skipped`);
	} else {
		log(`[setup] Plugin installed: ${pluginResult.pluginRoot} (v${pluginResult.version})`);
	}
	ui.step("plugin", "done", pluginResult.skipped ? "Plugin up to date" : "Plugin installed");

	// --- Step 3: Authentication ---
	// PENDING: Auth flow will be implemented via Loom skill OAuth method.
	// For now, mark as done. The existing checkClaude() in index.ts verifies
	// the binary works, and auth failures will surface when claude -p is first called.
	ui.step("auth", "active", "Checking authentication...");
	log("[setup] Auth step — PENDING Loom skill integration");

	// TODO(loom): Replace this placeholder with Loom-provided OAuth flow.
	// The Loom skill will provide a method to:
	//   1. Check if valid credentials exist
	//   2. If not, trigger browser-based OAuth login
	//   3. Wait for completion and verify
	// Until then, we optimistically mark auth as done.
	// Auth failures will surface at first claude -p invocation.
	await new Promise(r => setTimeout(r, 500)); // Brief pause for visual consistency
	ui.step("auth", "done", "Authentication (pending setup)");

	// --- Done ---
	ui.ready();
	log("[setup] Setup complete");
	await new Promise(r => setTimeout(r, 800)); // Let user see "Ready!"

	markSetupComplete(appVersion);

	return { claudeBin, pluginRoot: pluginResult.pluginRoot };
}

/**
 * Wait for a retry action from the setup UI.
 * Listens for host-message events with type "setup-action" and action "retry".
 * Re-runs the provided action on each retry until it succeeds.
 */
async function waitForRetry<T>(
	mainWindow: BrowserWindow,
	action: () => Promise<T>,
	log: (...args: any[]) => void,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const handler = async (event: any) => {
			const msg = event.data?.detail;
			if (msg?.type !== "setup-action" || msg?.action !== "retry") return;
			try {
				const result = await action();
				mainWindow.webview.off("host-message", handler);
				resolve(result);
			} catch (err: any) {
				log(`[setup] Retry failed: ${err.message}`);
				mainWindow.webview.executeJavascript(
					`showError("${err.message.replace(/"/g, '\\"')}"); showRetryButton(true);`
				);
			}
		};
		mainWindow.webview.on("host-message", handler);
	});
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/setup.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors (may warn about electrobun import — that's fine, it's a runtime dep)

- [ ] **Step 3: Commit**

```bash
git add vibes-desktop/src/bun/setup.ts
git commit -m "feat(desktop): add setup orchestrator with auth placeholder for Loom skill"
```

---

## Task 6: Wire Setup into Entry Point

Modify `index.ts` to check the setup marker before starting the editor. If setup is needed, show the setup UI first, then transition to the editor.

**Files:**
- Modify: `vibes-desktop/src/bun/index.ts`

- [ ] **Step 1: Add setup imports**

At the top of `index.ts`, add to the imports (after line 19):

```typescript
import { isSetupComplete, runSetup, getBundledPluginPath } from "./setup.ts";
```

- [ ] **Step 2: Read app version for setup check**

After the `BUILD_ID` constant (line 42), add:

```typescript
// Read app version from plugin.json (synced from .claude-plugin/plugin.json at build time)
function getAppVersion(): string {
	try {
		const bundledPath = getBundledPluginPath();
		if (bundledPath) {
			const pj = JSON.parse(readFileSync(join(bundledPath, ".claude-plugin", "plugin.json"), "utf-8"));
			return pj.version || "unknown";
		}
	} catch {}
	return "unknown";
}
```

Add `readFileSync` to the `fs` import on line 15:

```typescript
import { appendFileSync, mkdirSync, readFileSync } from "fs";
```

- [ ] **Step 3: Replace the Claude check and plugin discovery with setup flow**

Replace the current `main()` function body from the Claude check through plugin discovery (lines 80-109) with setup-aware logic. The new `main()` should:

1. Create the window early (before setup or server start)
2. If setup needed → run setup UI → then load server
3. If setup done → load server directly (existing behavior)

Replace lines 79-138 (from `async function main()` through the `BrowserWindow` creation) with:

```typescript
async function main() {
	log(`[vibes-desktop] Starting ${BUILD_ID}`);

	const appVersion = getAppVersion();
	const needsSetup = !isSetupComplete(appVersion);
	log(`[vibes-desktop] Version: ${appVersion}, needsSetup: ${needsSetup}`);

	// Create window early — setup UI and editor both use it
	const mainWindow = new BrowserWindow({
		title: "Vibes Editor",
		titleBarStyle: "hiddenInset",
		styleMask: {
			Titled: true,
			FullSizeContentView: true,
			Resizable: true,
			Closable: false,
			Miniaturizable: true,
		},
		// Start with setup page or dark blank — server URL loaded after ready
		html: needsSetup
			? SETUP_HTML
			: "<html><body style='background:#0a0a0a'></body></html>",
		frame: { width: 1280, height: 820 },
	});

	let claudeBin: string;
	let pluginPaths: any;

	if (needsSetup) {
		// Run first-launch setup — shows UI in the window
		const setupResult = await runSetup(mainWindow, appVersion, log);
		claudeBin = setupResult.claudeBin;

		// Re-discover plugin from the newly installed location
		const { discoverVibesPlugin } = await import("./plugin-discovery.ts");
		pluginPaths = await discoverVibesPlugin();
		if (!pluginPaths) {
			throw new Error("Plugin not found after setup — this should not happen");
		}
	} else {
		// Normal startup — verify deps exist
		if (!checkClaude()) {
			// Claude disappeared — re-trigger setup
			log("[vibes-desktop] Claude binary missing, re-running setup");
			const setupResult = await runSetup(mainWindow, appVersion, log);
			claudeBin = setupResult.claudeBin;
		} else {
			claudeBin = CLAUDE_BIN;
		}

		pluginPaths = await discoverVibesPlugin();
		if (!pluginPaths) {
			log("[vibes-desktop] Plugin missing, re-running setup");
			const setupResult = await runSetup(mainWindow, appVersion, log);
			claudeBin = setupResult.claudeBin;
			pluginPaths = await discoverVibesPlugin();
			if (!pluginPaths) {
				throw new Error("Plugin not found after setup");
			}
		}
	}

	// Expose resolved Claude path for server subprocess spawning
	process.env.CLAUDE_BIN = claudeBin;

	// Start the server
	const serverModule = await import(join(pluginPaths.root, "scripts", "server.ts"));
	const { server, ctx, shutdown } = await serverModule.startServer({
		mode: "editor",
		port: PORT,
		managed: true,
	});

	log(`[vibes-desktop] Plugin root: ${pluginPaths.root}`);
	log(`[vibes-desktop] Server started at ${SERVER_URL}`);

	// Load the editor in the window (transition from setup UI or blank page)
	mainWindow.webview.loadURL(SERVER_URL);
```

The rest of `main()` (from the `dom-ready` handler through the end) stays exactly as-is. Only remove the old `discoverVibesPlugin` import from line 17 since we now import it dynamically.

- [ ] **Step 4: Keep existing imports, add new ones**

Keep the existing `discoverVibesPlugin` import (line 17) — it's still used in the `else` branch for normal startup. Keep `CLAUDE_BIN, refreshClaudePath` from `auth.ts` — used in `checkClaude()`. Add the `SETUP_HTML` import for the BrowserWindow constructor:

```typescript
import { SETUP_HTML } from "./setup-html.ts";
```

- [ ] **Step 5: Verify the app compiles**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/index.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add vibes-desktop/src/bun/index.ts
git commit -m "feat(desktop): wire first-launch setup into app entry point"
```

---

## Task 7: Build Pipeline — Bundle Plugin Files

Modify `build-desktop.sh` to copy plugin files into the built `.app` bundle and simplify the DMG.

**Files:**
- Modify: `scripts/build-desktop.sh`

- [ ] **Step 1: Update step count and remove .command file reference**

Change `INSTALL_CMD` line (line 20) — remove it entirely. Update step echo messages from `[N/4]` to `[N/5]`.

- [ ] **Step 2: Add plugin bundling step after ElectroBun build**

After `bunx electrobun build --env=stable` (line 46), add:

```bash
# 4. Bundle plugin files into .app Resources
echo "[4/5] Bundling plugin files..."
APP_RESOURCES="$BUILD_DIR/$APP_NAME.app/Contents/Resources"
PLUGIN_DEST="$APP_RESOURCES/vibes-plugin"
rm -rf "$PLUGIN_DEST"
rsync -a \
  --exclude='.git' --exclude='.git-backup' --exclude='node_modules' \
  --exclude='vibes-desktop' --exclude='deploy-api' --exclude='.claude' \
  --exclude='scripts/__tests__' --exclude='scripts/coverage' \
  --exclude='docs/plans' --exclude='alchemy' \
  --exclude='skills/cloudflare/worker' --exclude='superpowers' \
  --exclude='.netlify-deploy' --exclude='.env' --exclude='.env.*' \
  --exclude='.connect' --exclude='.wrangler' --exclude='.DS_Store' \
  --exclude='.vibes-tmp' --exclude='.worktrees' \
  --exclude='*.bak.*' --exclude='*.bak.html' --exclude='*.bak.jsx' \
  --exclude='ai-worker' --exclude='designs' --exclude='dist' \
  --exclude='examples' --exclude='test-vibes' \
  "$REPO_ROOT/" "$PLUGIN_DEST/"

BUNDLE_SIZE=$(du -sh "$PLUGIN_DEST" | cut -f1)
echo "  Plugin bundled: $BUNDLE_SIZE"
```

- [ ] **Step 3: Simplify DMG staging — remove .command, use 2-icon layout**

Replace the DMG staging block. Remove the `cp "$INSTALL_CMD"` line and `chmod` line. Change `create-dmg` to 2-icon layout:

```bash
  # Layout: VibesOS (left) → Applications (right)
  create-dmg \
    --volname "$APP_NAME" \
    --volicon "$ICNS" \
    --background "$DMG_BG" \
    --window-pos 200 100 \
    --window-size 1024 576 \
    --icon-size 120 \
    --icon "$APP_NAME.app" 360 270 \
    --icon "Applications" 664 270 \
    --no-internet-enable \
    "$ORIG_DMG" \
    "$STAGE_DIR" \
    2>&1
```

- [ ] **Step 4: Verify the build script syntax**

Run: `bash -n scripts/build-desktop.sh`
Expected: No errors (syntax check only, doesn't execute)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-desktop.sh
git commit -m "feat(desktop): bundle plugin in .app, simplify DMG to 2-icon layout"
```

---

## Task 8: Cleanup — Remove .command File

**Files:**
- Delete: `scripts/install-vibes.command`

- [ ] **Step 1: Remove the file**

```bash
git rm scripts/install-vibes.command
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove install-vibes.command, replaced by in-app setup"
```

---

## Task 9: Auth Flow — Claude CLI OAuth

> **Implemented.** See `docs/superpowers/specs/2026-03-09-desktop-claude-auth-design.md` for the design spec and `docs/superpowers/plans/2026-03-09-desktop-claude-auth.md` for the implementation plan.

**What was built:**
- `claude-auth.ts` — checkClaudeAuth, startClaudeLogin, waitForClaudeAuth functions
- Setup wizard Step 3 gates on `claude auth status`, shows "Login with Anthropic" button, spawns `claude auth login`, polls for completion
- Normal startup path runs silent auth check, shows login screen if credentials are missing/expired
- Unified login screen with four states: ready, waiting, success, error
- Pocket ID auth deferred to first deploy (handled by existing `cli-auth.js`)

---

## Verification

After all tasks are complete (except Task 9), verify the full flow:

- [ ] **Build the app:** `bash scripts/build-desktop.sh`
- [ ] **Verify plugin is bundled:** `ls /path/to/VibesOS.app/Contents/Resources/vibes-plugin/.claude-plugin/plugin.json`
- [ ] **Verify DMG has 2 icons** (no .command file)
- [ ] **Test first launch:** Delete `~/.vibes/setup-complete-*` and launch the app. Verify:
  - Setup UI appears
  - Claude binary is found or installed
  - Plugin files are copied to `~/.claude/plugins/cache/vibes-bundled/vibes/{version}/`
  - `installed_plugins.json` has `vibes@vibes-bundled` entry
  - Editor loads after setup completes
- [ ] **Test subsequent launch:** Launch again, verify setup is skipped (fast startup)
- [ ] **Test version upgrade:** Change version in `plugin.json`, rebuild, launch. Verify setup re-runs but completes quickly (Claude found, plugin updated, auth found)
- [ ] **Test User A:** With existing `~/.claude/plugins/installed_plugins.json`, verify other entries are preserved after setup
