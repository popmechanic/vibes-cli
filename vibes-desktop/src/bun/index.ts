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
import { discoverVibesPlugin } from "./plugin-discovery.ts";
import { CLAUDE_BIN, refreshClaudePath } from "./auth.ts";
import { hideZoomButton } from "./window-controls.ts";

// --- Constants ---
const PORT = 3333;
const SERVER_URL = `http://localhost:${PORT}`;

// --- Startup ---
async function main() {
	// 1. Check Claude CLI (retry loop — user may install between attempts)
	while (!checkClaude()) {
		const result = await Utils.showMessageBox({
			type: "warning",
			title: "Claude CLI Not Found",
			message: "Vibes Editor requires the Claude CLI.",
			detail: "Install it with:\n  npm install -g @anthropic-ai/claude-code\n\nThen click Retry.",
			buttons: ["Retry", "Quit"],
		});
		if (result !== 0) {
			Utils.quit();
			return;
		}
		refreshClaudePath();
	}

	// 2. Find plugin
	const pluginPaths = await discoverVibesPlugin();
	if (!pluginPaths) {
		await Utils.showMessageBox({
			type: "error",
			title: "Vibes Plugin Not Found",
			message: "Could not locate the Vibes plugin.",
			detail: "Make sure the vibes-skill plugin is installed in Claude Code.",
			buttons: ["Quit"],
		});
		Utils.quit();
		return;
	}

	// 3. Expose resolved Claude path for server subprocess spawning
	process.env.CLAUDE_BIN = CLAUDE_BIN;

	// 4. Start the existing server
	const serverModule = await import(join(pluginPaths.root, "scripts", "server.ts"));
	const { server, ctx, shutdown } = await serverModule.startServer({
		mode: "editor",
		port: PORT,
		managed: true, // We handle lifecycle
	});

	console.log(`[vibes-desktop] Server started at ${SERVER_URL}`);

	// 4. Create window pointing to the server
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
		url: SERVER_URL,
		frame: { width: 1280, height: 820 },
	});

	// 4b. Open external links in the system browser
	// Block navigation away from the local server; open external URLs in default browser
	mainWindow.webview.setNavigationRules([
		"^*",                        // Block everything by default
		`*://localhost:${PORT}/*`,   // Allow local server (last match wins)
		`*://localhost:${PORT}`,
	]);
	mainWindow.webview.on("will-navigate", (event) => {
		if (!event.data.allowed && event.data.url) {
			Utils.openExternal(event.data.url);
		}
	});
	// Catch window.open() calls (auth popups, target="_blank" links)
	mainWindow.webview.on("new-window-open", (event) => {
		const url = typeof event.detail === "object" ? event.detail.url : event.detail;
		if (url) {
			Utils.openExternal(url);
		}
	});

	// 4c. Hide zoom button via native dylib (dispatch_async to main thread)
	// Close and minimize are already hidden by styleMask above
	setTimeout(() => hideZoomButton(), 200);

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

	// 4e. Open external URLs from the web UI
	ctx.onOpenExternal = (url: string) => {
		Utils.openExternal(url);
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

	console.log("[vibes-desktop] App started");
}

function checkClaude(): boolean {
	try {
		const result = Bun.spawnSync([CLAUDE_BIN, "--version"], { timeout: 5000 });
		return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
	} catch {
		return false;
	}
}

main().catch((err) => {
	console.error("[vibes-desktop] Fatal error:", err);
	process.exit(1);
});
