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
import { resolveClaudePath, CLAUDE_BIN } from "./auth.ts";
import { hideZoomButton } from "./window-controls.ts";

// --- Constants ---
const PORT = 3333;
const SERVER_URL = `http://localhost:${PORT}`;

// --- Startup ---
async function main() {
	// 1. Check Claude CLI
	const claudeOk = checkClaude();
	if (!claudeOk) {
		await Utils.showMessageBox({
			type: "error",
			title: "Claude CLI Not Found",
			message: "Vibes Editor requires the Claude CLI.",
			detail: "Install it with: npm install -g @anthropic-ai/claude-code\n\nThen relaunch the app.",
			buttons: ["Quit"],
		});
		Utils.quit();
		return;
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

	// 3. Start the existing server
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
			Miniaturizable: false,
		},
		url: SERVER_URL,
		frame: { width: 1280, height: 820 },
	});

	// 4b. Hide zoom button via native dylib (dispatch_async to main thread)
	// Close and minimize are already hidden by styleMask above
	setTimeout(() => hideZoomButton(), 200);

	// 5. Native menu
	ApplicationMenu.setApplicationMenu([
		{
			label: "Vibes Editor",
			submenu: [
				{ label: "About Vibes Editor", role: "about" },
				{ type: "separator" },
				{ label: "Quit", role: "quit" },
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

	// 8. Native command channel — WebSocket for low-latency window ops
	const NATIVE_PORT = PORT + 1;
	Bun.serve({
		port: NATIVE_PORT,
		fetch(req, srv) {
			if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
				srv.upgrade(req);
				return undefined as any;
			}
			return new Response("", { status: 404 });
		},
		websocket: {
			message(_ws, msg) {
				try {
					const data = JSON.parse(String(msg));
					if (data.type === "move") {
						const pos = mainWindow.getPosition();
						mainWindow.setPosition(pos.x + data.dx, pos.y + data.dy);
					}
				} catch {}
			},
		},
	});
	console.log(`[vibes-desktop] Native command channel on port ${NATIVE_PORT}`);

	// 9. Graceful shutdown
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
