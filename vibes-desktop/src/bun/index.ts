/**
 * Vibes Desktop — Thin native shell
 *
 * Starts the existing Vibes server (scripts/server.ts) and opens it
 * in a native ElectroBun window. RPC is reserved for native-only
 * features: menus, tray, file dialogs, notifications.
 */
import Electrobun, {
	BrowserWindow,
	ApplicationMenu,
	Tray,
	Utils,
} from "electrobun/bun";
import { join } from "path";
import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { discoverVibesPlugin } from "./plugin-discovery.ts";
import { CLAUDE_BIN, refreshClaudePath } from "./auth.ts";
import { hideZoomButton } from "./window-controls.ts";
import { isSetupComplete, runSetup, getBundledPluginPath } from "./setup.ts";
import { SETUP_HTML } from "./setup-html.ts";
import { checkClaudeAuth, startClaudeLogin, waitForClaudeAuth, jsStr, type ClaudeAuthResult } from "./claude-auth.ts";
import { waitForSetupAction, stopSetupIpc } from "./setup-ipc.ts";

// --- Debug logging (~/Library/Logs/VibesOS/desktop.log) ---
const LOG_DIR = join(homedir(), "Library", "Logs", "VibesOS");
const LOG_FILE = join(LOG_DIR, "desktop.log");
try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const _origLog = console.log;
const _origErr = console.error;

function log(...args: any[]) {
	const msg = `[${new Date().toISOString()}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
	try { appendFileSync(LOG_FILE, msg); } catch {}
	_origLog(...args);
}

// Capture ALL console output (including server module) to the log file
console.log = (...args: any[]) => log(...args);
console.error = (...args: any[]) => log("[ERROR]", ...args);

// --- Constants ---
const PORT = 3333;
const SERVER_URL = `http://localhost:${PORT}`;
const BUILD_ID = "build-2026-03-10-v8-ipc-fix";

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

/**
 * Show the login screen in the given window and wait for auth completion.
 * Used both during first-launch setup and on normal startup when credentials expire.
 * Includes retry loop — never throws, keeps showing login until the user succeeds.
 */
async function showLoginAndWait(
	mainWindow: BrowserWindow,
	subtitle: string,
): Promise<ClaudeAuthResult> {
	// Load setup HTML and switch to login-only view
	mainWindow.webview.loadHTML(SETUP_HTML);
	await new Promise(r => setTimeout(r, 300));
	mainWindow.webview.executeJavascript(`showLoginScreen(${jsStr(subtitle)})`);

	while (true) {
		// Wait for button click (auth or retry) via setup IPC server
		await waitForSetupAction(["auth", "retry"]);

		// Start login and poll
		mainWindow.webview.executeJavascript(`showWaitingForAuth()`);
		const loginProc = startClaudeLogin();

		try {
			const result = await waitForClaudeAuth();
			mainWindow.webview.executeJavascript(`showAuthSuccess(${jsStr(result.email || "")})`);
			await new Promise(r => setTimeout(r, 1000));
			return result;
		} catch (err: any) {
			try { loginProc.kill(); } catch {}
			log(`[vibes-desktop] Auth failed: ${err.message}`);
			mainWindow.webview.executeJavascript(`showAuthError(${jsStr(err.message)})`);
			// Loop back — retry button click will re-enter the while loop
		}
	}
}

// Inline preload — uses __electrobunSendToHost (host-message channel) for reliable
// preload→Bun communication. Raw bridge messages have FFI race conditions.
const LINK_PRELOAD = `
(function() {
  function openExternal(url) {
    if (window.__electrobunSendToHost) {
      window.__electrobunSendToHost({ type: "open-external", url: url });
    } else {
      console.warn('[vibes-preload] __electrobunSendToHost not available for:', url);
    }
  }

  // Intercept external link clicks
  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.href;
    if (!href || href.startsWith('javascript:')) return;
    try {
      if (new URL(href, location.origin).origin === location.origin) return;
    } catch(ex) { return; }
    e.preventDefault();
    e.stopPropagation();
    openExternal(href);
  }, true);

  // Override window.open to route through host-message
  window.open = function(url) {
    if (url) { openExternal(String(url)); }
    return null;
  };
})();
`;

// --- Startup ---
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

	// Register will-navigate early — active for setup HTML pages AND editor.
	// Handles vibes://setup/* actions from setup buttons, and opens external
	// HTTP URLs in the system browser (same mechanism as link preload).
	mainWindow.webview.on("will-navigate", (event) => {
		const detail = event.data?.detail;
		log(`[will-navigate] detail:`, JSON.stringify(detail));
		let url: string | undefined;
		if (typeof detail === "string") {
			try { url = JSON.parse(detail)?.url || detail; } catch { url = detail; }
		}
		if (url && (url.startsWith("http://") || url.startsWith("https://")) && !url.startsWith(`http://localhost:${PORT}`)) {
			log(`[will-navigate] Opening externally: ${url}`);
			Utils.openExternal(url);
		}
	});

	let claudeBin: string;
	let pluginPaths: any;

	if (needsSetup) {
		// Run first-launch setup — shows UI in the window
		const setupResult = await runSetup(mainWindow, appVersion, log);
		claudeBin = setupResult.claudeBin;

		// Re-discover plugin from the newly installed location
		const { discoverVibesPlugin: discover } = await import("./plugin-discovery.ts");
		pluginPaths = await discover();
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

	// --- Auth check (both paths) ---
	log("[vibes-desktop] Checking Claude auth...");
	const authCheck = checkClaudeAuth();
	if (!authCheck.loggedIn) {
		log("[vibes-desktop] Not authenticated, showing login screen");
		await showLoginAndWait(mainWindow, needsSetup ? "Setting up your environment" : "Welcome back");
	} else {
		log(`[vibes-desktop] Authenticated as ${authCheck.email}`);
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

	// Setup is done — shut down the IPC server
	stopSetupIpc();

	// Load the editor in the window (transition from setup UI or blank page)
	mainWindow.webview.loadURL(SERVER_URL);

	// Inject preload via executeJavascript on dom-ready (preload option doesn't work)
	mainWindow.webview.on("dom-ready", () => {
		log("[dom-ready] Injecting link preload script");
		mainWindow.webview.executeJavascript(LINK_PRELOAD);
	});

	// 4b. Navigation rules — allow local server only, block everything else
	mainWindow.webview.setNavigationRules([
		"^*",                        // Block everything by default
		`*://localhost:${PORT}/*`,   // Allow local server
		`*://localhost:${PORT}`,
	]);

	// Host messages from preload — open-external requests
	mainWindow.webview.on("host-message", (event) => {
		const msg = event.data?.detail;
		log(`[host-message] Received:`, JSON.stringify(msg));
		if (msg?.type === "open-external" && msg?.url) {
			log(`[host-message] Opening externally: ${msg.url}`);
			Utils.openExternal(msg.url);
		}
	});

	// 4c. Hide zoom button via native dylib (dispatch_async to main thread)
	// Close and minimize are already hidden by styleMask above
	setTimeout(() => hideZoomButton(), 500);

	// 4c. Wire up window control callbacks from the web UI
	ctx.onWindowControl = (action: string) => {
		switch (action) {
			case "close":
				shutdown();
				mainWindow.close();
				break;
			case "minimize":
				mainWindow.minimize();
				break;
			case "zoom":
				if (mainWindow.isMaximized()) {
					mainWindow.unmaximize();
				} else {
					mainWindow.maximize();
				}
				break;
		}
	};

	// 5. Native menu
	ApplicationMenu.setApplicationMenu([
		{
			label: "Vibes Editor",
			submenu: [
				{ label: "About Vibes Editor", role: "about" },
				{ type: "separator" },
				{ label: "Quit", role: "quit", accelerator: "Command+q" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ label: "Undo", role: "undo" },
				{ label: "Redo", role: "redo" },
				{ type: "separator" },
				{ label: "Cut", role: "cut" },
				{ label: "Copy", role: "copy" },
				{ label: "Paste", role: "paste" },
				{ label: "Select All", role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ label: "Reload", action: "reload", accelerator: "r" },
				{ label: "Developer Tools", action: "devtools", accelerator: "Option+Command+I" },
			],
		},
	]);

	// 6. System tray
	const tray = new Tray({ title: "Vibes", template: true, width: 16, height: 16 });
	tray.setMenu([
		{ label: "Vibes Editor", enabled: false },
		{ type: "separator" },
		{ label: "Show Window", action: "show-window" },
		{ type: "separator" },
		{ label: "Quit", action: "quit-app" },
	]);
	tray.on("tray-clicked", () => mainWindow.focus());

	// 7. Menu event handler
	Electrobun.events.on("application-menu-clicked", (e) => {
		switch (e.data.action) {
			case "show-window":
				mainWindow.focus();
				break;
			case "quit-app":
				shutdown();
				Utils.quit();
				break;
			case "reload":
				mainWindow.webview.loadURL(SERVER_URL);
				break;
			case "devtools":
				// Toggle dev tools (BrowserView method)
				break;
		}
	});

	// 8. Graceful shutdown
	Electrobun.events.on("before-quit", () => {
		shutdown();
	});

	log("[vibes-desktop] App started — log file:", LOG_FILE);
}

function checkClaude(): boolean {
	try {
		const result = Bun.spawnSync([CLAUDE_BIN, "--version"], { timeout: 5000 });
		const ok = result.exitCode === 0 || result.exitCode === undefined;
		return ok && result.stdout.toString().trim().length > 0;
	} catch {
		return false;
	}
}

main().catch((err) => {
	log("[vibes-desktop] Fatal error:", err);
	process.exit(1);
});
