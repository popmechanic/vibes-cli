// vibes-desktop/src/bun/plugin-installer.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from "fs";
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
	const vibesBundledDir = join(pluginsDir, "cache", "vibes-bundled", "vibes");
	const cacheDir = join(vibesBundledDir, version);

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

	// Clean up old version directories before installing new one
	if (existsSync(vibesBundledDir)) {
		try {
			const oldVersions = readdirSync(vibesBundledDir).filter(v => !v.startsWith(".") && v !== version);
			for (const oldVersion of oldVersions) {
				rmSync(join(vibesBundledDir, oldVersion), { recursive: true, force: true });
			}
		} catch {}
	}

	// Copy plugin files via rsync (preserves structure, fast delta)
	mkdirSync(dirname(cacheDir), { recursive: true });
	const rsync = Bun.spawnSync([
		"rsync", "-a", "--delete",
		"--exclude=.env", "--exclude=.env.*",
		"--exclude=.connect", "--exclude=.wrangler",
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
