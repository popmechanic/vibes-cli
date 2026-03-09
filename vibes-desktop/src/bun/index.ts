import Electrobun, {
	BrowserWindow,
	BrowserView,
	ApplicationMenu,
	Updater,
	Tray,
} from "electrobun/bun";
import type { VibesDesktopRPC } from "../shared/rpc-types.ts";
import {
	checkClaudeInstalled,
	checkClaudeAuth,
	triggerClaudeLogin,
	checkPocketIdAuth,
} from "./auth.ts";
import {
	discoverVibesPlugin,
	type PluginPaths,
} from "./plugin-discovery.ts";
import { loadConfig, setConfigModules, type AppConfig } from "./config.ts";
import { startPreviewServer } from "./preview-server.ts";
import { abortTask, cancelCurrent, setSharedModules } from "./claude-manager.ts";
import { handleGenerate } from "./handlers/generate.ts";
import { handleChat } from "./handlers/chat.ts";
import { handleSwitchTheme, setThemeModules } from "./handlers/theme.ts";
import { handleDeploy } from "./handlers/deploy.ts";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	rmSync,
	cpSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

// --- Plugin utilities (loaded eagerly during init) ---
let stripForTemplate:
	| ((code: string, opts?: any) => string)
	| null = null;
let APP_PLACEHOLDER: string | null = null;
let populateConnectConfig:
	| ((html: string, config: Record<string, string>) => string)
	| null = null;

// --- App State ---
let pluginPaths: PluginPaths | null = null;
let config: AppConfig | null = null;
let currentApp: string | null = null;

const PREVIEW_PORT = 3333;
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// --- Startup ---
async function init() {
	pluginPaths = await discoverVibesPlugin();
	if (pluginPaths) {
		// Load plugin shared modules BEFORE loadConfig
		const configMod = await import(
			join(pluginPaths.root, "scripts", "server", "config.ts")
		);
		setConfigModules({
			parseThemeColors: configMod.parseThemeColors,
		});

		config = loadConfig(pluginPaths);
		mkdirSync(config.appsDir, { recursive: true });

		// Load assembly utilities
		const stripMod = await import(
			join(pluginPaths.root, "scripts", "lib", "strip-code.js")
		);
		stripForTemplate = stripMod.stripForTemplate;
		const asmMod = await import(
			join(pluginPaths.root, "scripts", "lib", "assembly-utils.js")
		);
		APP_PLACEHOLDER = asmMod.APP_PLACEHOLDER;
		const envMod = await import(
			join(pluginPaths.root, "scripts", "lib", "env-utils.js")
		);
		populateConnectConfig = envMod.populateConnectConfig;

		// Load post-processing
		const postMod = await import(
			join(pluginPaths.root, "scripts", "server", "post-process.ts")
		);

		// Load Claude subprocess utilities from the plugin
		const subprocMod = await import(
			join(
				pluginPaths.root,
				"scripts",
				"lib",
				"claude-subprocess.js",
			)
		);
		const parserMod = await import(
			join(pluginPaths.root, "scripts", "lib", "stream-parser.js")
		);
		setSharedModules({
			buildClaudeArgs: subprocMod.buildClaudeArgs,
			createStreamParser: parserMod.createStreamParser,
			sanitizeAppJsx: postMod.sanitizeAppJsx,
		});

		// Load theme-related shared modules for two-pass theme switching
		const themeSections = await import(
			join(pluginPaths.root, "scripts", "lib", "theme-sections.js")
		);
		const backupMod = await import(
			join(pluginPaths.root, "scripts", "lib", "backup.js")
		);
		setThemeModules({
			parseThemeColors: configMod.parseThemeColors,
			extractPass2ThemeContext: configMod.extractPass2ThemeContext,
			hasThemeMarkers: themeSections.hasThemeMarkers,
			replaceThemeSection: themeSections.replaceThemeSection,
			extractNonThemeSections: themeSections.extractNonThemeSections,
			moveVisualCSSToSurfaces:
				themeSections.moveVisualCSSToSurfaces,
			createBackup: backupMod.createBackup,
			restoreFromBackup: backupMod.restoreFromBackup,
		});

		console.log(
			`[vibes-desktop] Plugin loaded from ${pluginPaths.root}`,
		);
		console.log(
			`[vibes-desktop] ${config.themes.length} themes, ${config.animations.length} animations, ${config.skills.length} skills`,
		);
	} else {
		console.warn(
			"[vibes-desktop] Vibes plugin not found — limited functionality",
		);
	}

	// Start preview server
	if (pluginPaths) {
		startPreviewServer({
			pluginPaths,
			getAssembledHtml: () => assembleCurrentApp(),
			port: PREVIEW_PORT,
		});
	}
}

init().catch(console.error);

// --- Assembly helper ---
function assembleCurrentApp(): string | null {
	if (!pluginPaths || !config || !currentApp) return null;
	if (!stripForTemplate || !APP_PLACEHOLDER || !populateConnectConfig)
		return null;
	const appDir = join(config.appsDir, currentApp);
	const appJsxPath = join(appDir, "app.jsx");
	if (!existsSync(appJsxPath)) return null;

	try {
		const templatePath = join(
			pluginPaths.root,
			"skills",
			"vibes",
			"templates",
			"index.html",
		);
		if (!existsSync(templatePath)) return null;
		let template = readFileSync(templatePath, "utf-8");

		const appCode = readFileSync(appJsxPath, "utf-8");

		if (!template.includes(APP_PLACEHOLDER)) {
			console.error(
				"[assembleCurrentApp] Template missing placeholder:",
				APP_PLACEHOLDER,
			);
			return null;
		}

		const strippedCode = stripForTemplate(appCode, {
			stripReactHooks: false,
		});
		template = template.replace(APP_PLACEHOLDER, strippedCode);

		// Preview mode: leave Connect URLs empty
		template = populateConnectConfig(template, {});

		return template;
	} catch (e) {
		console.error("[assembleCurrentApp]", e);
		return null;
	}
}

// --- HMR detection ---
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(
				`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`,
			);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// --- RPC ---
const rpc = BrowserView.defineRPC<VibesDesktopRPC>({
	handlers: {
		requests: {
			// Setup
			checkClaude: async () => checkClaudeInstalled(),
			checkAuth: async () => checkClaudeAuth(),
			triggerLogin: async () => triggerClaudeLogin(),
			checkPocketId: async () => checkPocketIdAuth(),
			triggerPocketIdLogin: async () => {
				if (!pluginPaths) return { success: false };
				try {
					const { loginWithBrowser } = await import(
						join(
							pluginPaths.root,
							"scripts",
							"lib",
							"cli-auth.js",
						)
					);
					const { OIDC_AUTHORITY, OIDC_CLIENT_ID } = await import(
						join(
							pluginPaths.root,
							"scripts",
							"lib",
							"auth-constants.js",
						)
					);
					await loginWithBrowser({
						authority: OIDC_AUTHORITY,
						clientId: OIDC_CLIENT_ID,
					});
					return { success: true };
				} catch {
					return { success: false };
				}
			},

			// Generate
			generate: async (params) => {
				if (!pluginPaths || !config)
					return { taskId: "error-no-plugin" };
				const taskId = handleGenerate(
					{
						pluginPaths,
						themes: config.themes,
						themeRootCss: config.themeRootCss,
						appsDir: config.appsDir,
						currentApp,
						setCurrentApp: (name) => {
							currentApp = name;
						},
					},
					rpc,
					params,
				);
				return { taskId };
			},

			// Chat
			chat: async (params) => {
				if (!pluginPaths || !config)
					return { taskId: "error-no-plugin" };
				const taskId = handleChat(
					{
						pluginPaths,
						appsDir: config.appsDir,
						currentApp,
					},
					rpc,
					params,
				);
				return { taskId };
			},

			// Abort — try by taskId first, fall back to cancelling current
			abort: async ({ taskId }) => ({
				success: taskId ? abortTask(taskId) : cancelCurrent(),
			}),

			// Theme
			switchTheme: async ({ themeId }) => {
				if (!pluginPaths || !config)
					return { taskId: "error-no-plugin" };
				const taskId = handleSwitchTheme(
					{
						pluginPaths,
						themes: config.themes,
						appsDir: config.appsDir,
						currentApp,
					},
					rpc,
					themeId,
				);
				return { taskId };
			},
			getThemes: async () => ({
				themes: config?.themes || [],
			}),
			getAnimations: async () => ({
				animations: config?.animations || [],
			}),

			// App Management
			saveApp: async ({ name }) => {
				if (!config || !currentApp) return { success: false };
				const src = join(config.appsDir, currentApp);
				const dst = join(config.appsDir, name);
				if (src !== dst) {
					mkdirSync(dst, { recursive: true });
					cpSync(src, dst, { recursive: true });
				}
				return { success: true };
			},
			loadApp: async ({ name }) => {
				if (!config) return { success: false };
				const appDir = join(config.appsDir, name);
				if (!existsSync(join(appDir, "app.jsx")))
					return { success: false };
				currentApp = name;
				return { success: true };
			},
			listApps: async () => {
				if (!config) return { apps: [] };
				if (!existsSync(config.appsDir)) return { apps: [] };
				const dirs = readdirSync(config.appsDir, {
					withFileTypes: true,
				})
					.filter(
						(d) =>
							d.isDirectory() &&
							existsSync(
								join(config!.appsDir, d.name, "app.jsx"),
							),
					)
					.map((d) => ({
						name: d.name,
						slug: d.name,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					}));
				return { apps: dirs };
			},
			deleteApp: async ({ name }) => {
				if (!config) return { success: false };
				const appDir = join(config.appsDir, name);
				if (!existsSync(appDir)) return { success: false };
				rmSync(appDir, { recursive: true });
				if (currentApp === name) currentApp = null;
				return { success: true };
			},
			saveScreenshot: async ({ name, dataUrl }) => {
				if (!config) return { success: false };
				const appDir = join(config.appsDir, name);
				mkdirSync(appDir, { recursive: true });
				const base64 = dataUrl.replace(
					/^data:image\/\w+;base64,/,
					"",
				);
				const buffer = Buffer.from(base64, "base64");
				writeFileSync(join(appDir, "thumbnail.png"), buffer);
				return { success: true };
			},

			// Deploy
			deploy: async ({ name }) => {
				if (!pluginPaths || !config)
					return { taskId: "error-no-plugin" };
				const taskId = await handleDeploy(
					{
						pluginPaths,
						appsDir: config.appsDir,
						currentApp,
					},
					rpc,
					name,
				);
				return { taskId };
			},

			// Config
			getSkills: async () => ({
				skills: config?.skills || [],
			}),
			getConfig: async () => ({
				pluginPath: pluginPaths?.root || "",
				appsDir: config?.appsDir || "",
				currentApp,
			}),
		},
		messages: {},
	},
});

// --- Window ---
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Vibes Editor",
	url,
	frame: { width: 1280, height: 820 },
	rpc,
});

// --- Native Menu ---
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
		label: "File",
		submenu: [
			{
				label: "New App",
				action: "new-app",
				accelerator: "n",
			},
			{ label: "Save", action: "save-app", accelerator: "s" },
			{ type: "separator" },
			{
				label: "Load App...",
				action: "load-app",
				accelerator: "o",
			},
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
]);

// --- System Tray ---
const tray = new Tray({
	title: "Vibes",
	template: true,
	width: 16,
	height: 16,
});

tray.setMenu([
	{ label: "Vibes Editor", enabled: false },
	{ type: "separator" },
	{ label: "Show Window", action: "show-window" },
	{ type: "separator" },
	{ label: "Quit", action: "quit-app" },
]);

tray.on("tray-clicked", () => {
	mainWindow.focus();
});

// --- Menu Event Handler (native menu + tray menu) ---
Electrobun.events.on("application-menu-clicked", (e) => {
	switch (e.data.action) {
		case "new-app":
			rpc.send.appUpdated({ path: "__new__" });
			break;
		case "save-app":
			break;
		case "load-app":
			break;
		case "show-window":
			mainWindow.focus();
			break;
		case "quit-app":
			process.exit(0);
			break;
	}
});

// Tray status helper — called from claude-manager heartbeats
export function updateTrayStatus(status: string | null) {
	if (status) {
		tray.setTitle(`Vibes - ${status}`);
	} else {
		tray.setTitle("Vibes");
	}
}

console.log("[vibes-desktop] App started");
