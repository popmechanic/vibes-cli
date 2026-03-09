import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface PluginPaths {
	root: string;
	assembleScript: string;
	themeDir: string;
	animationDir: string;
	baseTemplate: string;
	bundlesDir: string;
	stylePrompt: string;
	skillsDir: string;
}

export function resolvePluginPaths(pluginRoot: string): PluginPaths {
	return {
		root: pluginRoot,
		assembleScript: join(pluginRoot, "scripts", "assemble.js"),
		themeDir: join(pluginRoot, "skills", "vibes", "themes"),
		animationDir: join(pluginRoot, "skills", "vibes", "animations"),
		baseTemplate: join(
			pluginRoot,
			"source-templates",
			"base",
			"template.html",
		),
		bundlesDir: join(pluginRoot, "bundles"),
		stylePrompt: join(
			pluginRoot,
			"skills",
			"vibes",
			"defaults",
			"style-prompt.txt",
		),
		skillsDir: join(pluginRoot, "skills"),
	};
}

export async function discoverVibesPlugin(
	home?: string,
): Promise<PluginPaths | null> {
	// Dev override: env var or ~/.vibes/dev-plugin-root file
	// File-based override works from Finder (no shell env); can't be overwritten by plugin cache
	const envRoot = process.env.VIBES_PLUGIN_ROOT;
	const fileOverridePath = join(home || homedir(), ".vibes", "dev-plugin-root");
	const devOverride = envRoot || (existsSync(fileOverridePath)
		? readFileSync(fileOverridePath, "utf-8").trim()
		: null);
	if (devOverride) {
		if (!devOverride.startsWith("/")) {
			console.warn(`[plugin-discovery] Dev override path is not absolute, ignoring: ${devOverride}`);
		} else if (!existsSync(devOverride)) {
			console.warn(`[plugin-discovery] Dev override path does not exist: ${devOverride}`);
		} else {
			const overrideResult = validateAndReturn(devOverride);
			if (overrideResult) {
				console.log(`[plugin-discovery] Dev override: ${devOverride}`);
				return overrideResult;
			}
		}
	}

	// Dev mode: walk up from main script to find plugin root
	// In dev builds, process.argv[1] is inside vibes-desktop/build/... which is inside vibes-skill/
	const mainScript = process.argv[1] || "";
	if (mainScript) {
		const devRoot = findPluginRootUpward(dirname(mainScript));
		if (devRoot) {
			const devResult = validateAndReturn(devRoot);
			if (devResult) {
				console.log(`[plugin-discovery] Dev mode: using ${devRoot}`);
				return devResult;
			}
		}
	}

	const h = home || homedir();
	const installedPath = join(h, ".claude", "plugins", "installed_plugins.json");

	if (!existsSync(installedPath)) return null;

	try {
		const data = JSON.parse(await Bun.file(installedPath).text());

		// Handle version 2 format: { version: 2, plugins: { "vibes@marketplace": [...] } }
		const plugins = data.plugins || data;
		if (typeof plugins !== "object" || Array.isArray(plugins)) return null;

		// Find vibes plugin entry — keys are "pluginName@marketplace"
		let installPath: string | null = null;
		for (const [key, value] of Object.entries(plugins)) {
			if (!key.startsWith("vibes@")) continue;
			// pluginData is an array in v2 format
			const pluginEntry = Array.isArray(value)
				? (value as any[])[0]
				: value;
			if (
				pluginEntry?.installPath &&
				existsSync(pluginEntry.installPath)
			) {
				installPath = pluginEntry.installPath;
				break;
			}
		}

		if (!installPath) {
			// Fallback: scan cache directories
			const cacheDir = join(h, ".claude", "plugins", "cache");
			if (!existsSync(cacheDir)) return null;

			for (const market of readdirSync(cacheDir)) {
				const vibesDir = join(cacheDir, market, "vibes");
				if (existsSync(vibesDir)) {
					const versions = readdirSync(vibesDir).filter(
						(v) => !v.startsWith("."),
					);
					if (versions.length > 0) {
						const latestVersion = versions.sort().pop()!;
						const pluginRoot = join(vibesDir, latestVersion);
						return validateAndReturn(pluginRoot);
					}
				}
			}
			return null;
		}

		return validateAndReturn(installPath);
	} catch {
		return null;
	}
}

function findPluginRootUpward(startDir: string): string | null {
	let dir = startDir;
	for (let i = 0; i < 10; i++) {
		if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function validateAndReturn(pluginRoot: string): PluginPaths | null {
	const paths = resolvePluginPaths(pluginRoot);

	// Verify critical files exist
	const required = [paths.themeDir, paths.assembleScript];
	for (const p of required) {
		if (!existsSync(p)) {
			console.warn(`[plugin-discovery] Missing required path: ${p}`);
			return null;
		}
	}

	return paths;
}
