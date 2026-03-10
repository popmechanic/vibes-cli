// vibes-desktop/src/bun/setup.ts
// First-launch setup orchestrator.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BrowserWindow } from "electrobun/bun";
import { SETUP_HTML } from "./setup-html.ts";
import { CLAUDE_BIN, refreshClaudePath, installClaude, isClaudeInstalled } from "./auth.ts";
import { installPlugin } from "./plugin-installer.ts";
import { checkClaudeAuth, startClaudeLogin, waitForClaudeAuth, jsStr } from "./claude-auth.ts";
import { waitForSetupAction } from "./setup-ipc.ts";

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
		join(import.meta.dir, "..", "..", "vibes-plugin"),    // production .app
		join(import.meta.dir, "..", "..", "..", ".."),         // dev mode (vibes-skill root)
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
 *   3. Authenticate via Claude CLI OAuth
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
			const labelArg = label ? `, ${jsStr(label)}` : "";
			mainWindow.webview.executeJavascript(`updateStep(${jsStr(id)}, ${jsStr(state)}${labelArg})`);
		},
		showAuth: (show: boolean) =>
			mainWindow.webview.executeJavascript(`showAuthButton(${show})`),
		showRetry: (show: boolean) =>
			mainWindow.webview.executeJavascript(`showRetryButton(${show})`),
		showError: (msg: string) =>
			mainWindow.webview.executeJavascript(`showError(${jsStr(msg)})`),
		ready: () =>
			mainWindow.webview.executeJavascript(`showReady()`),
		waitingForAuth: () =>
			mainWindow.webview.executeJavascript(`showWaitingForAuth()`),
		authSuccess: (email: string) =>
			mainWindow.webview.executeJavascript(`showAuthSuccess(${jsStr(email)})`),
		authError: (msg: string) =>
			mainWindow.webview.executeJavascript(`showAuthError(${jsStr(msg)})`),
		welcomeScreen: () =>
			mainWindow.webview.executeJavascript(`showWelcomeScreen()`),
		hideWelcomeScreen: () =>
			mainWindow.webview.executeJavascript(`hideWelcomeScreen()`),
	};

	// Small delay so the UI renders before we start work
	await new Promise(r => setTimeout(r, 300));

	// --- Step 1: Find or install Claude ---
	ui.step("claude", "active", "Checking for Claude Code...");
	log("[setup] Checking for Claude binary...");

	let claudeBin: string;
	refreshClaudePath();

	if (isClaudeInstalled()) {
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
	ui.step("auth", "active", "Checking authentication...");
	log("[setup] Checking Claude auth status...");

	let authResult = checkClaudeAuth();

	if (authResult.loggedIn) {
		log(`[setup] Already authenticated as ${authResult.email}`);
		ui.step("auth", "done", `Signed in as ${authResult.email || "authenticated"}`);
	} else {
		log("[setup] Not authenticated, showing welcome screen");
		// Transition to welcome screen with VibesOS branding
		await new Promise(r => setTimeout(r, 400));
		ui.welcomeScreen();

		// Wait for user to click "Sign in"
		await waitForSetupAction(["auth"]);

		// Start login and poll for completion
		ui.hideWelcomeScreen();
		ui.step("auth", "active", "Waiting for sign-in...");
		ui.waitingForAuth();
		log("[setup] Starting Claude auth login...");

		const loginProc = startClaudeLogin();

		try {
			authResult = await waitForClaudeAuth();
			log(`[setup] Auth successful: ${authResult.email}`);
			ui.authSuccess(authResult.email || "");
			ui.step("auth", "done", `Signed in as ${authResult.email || "authenticated"}`);
		} catch (err: any) {
			// Kill the login process if it's still running
			try { loginProc.kill(); } catch {}
			log(`[setup] Auth failed: ${err.message}`);
			ui.step("auth", "error", "Sign-in failed");
			ui.authError(err.message);

			// Wait for retry — reuse existing pattern
			authResult = await waitForRetry(mainWindow, async () => {
				ui.showRetry(false);
				ui.showError("");
				ui.step("auth", "active", "Waiting for sign-in...");
				ui.waitingForAuth();
				const retryProc = startClaudeLogin();
				try {
					const result = await waitForClaudeAuth();
					return result;
				} catch (retryErr) {
					try { retryProc.kill(); } catch {}
					throw retryErr;
				}
			}, log);
			ui.authSuccess(authResult.email || "");
			ui.step("auth", "done", `Signed in as ${authResult.email || "authenticated"}`);
		}
	}

	// --- Done ---
	ui.ready();
	log("[setup] Setup complete, waiting for user to click Continue");
	await waitForSetupAction(["continue"]);

	markSetupComplete(appVersion);

	return { claudeBin, pluginRoot: pluginResult.pluginRoot };
}

/**
 * Wait for a retry action from the setup UI, re-running the action until it succeeds.
 */
async function waitForRetry<T>(
	mainWindow: BrowserWindow,
	action: () => Promise<T>,
	log: (...args: any[]) => void,
): Promise<T> {
	while (true) {
		await waitForSetupAction(["retry"]);
		try {
			return await action();
		} catch (err: any) {
			log(`[setup] Retry failed: ${err.message}`);
			mainWindow.webview.executeJavascript(
				`showError(${jsStr(err.message)}); showRetryButton(true);`
			);
		}
	}
}
