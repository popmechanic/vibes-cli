// vibes-desktop/src/bun/plugin-installer.ts
//
// Installs plugin files into ~/.vibes/plugins/vibes/{version}/.
// Does NOT touch ~/.claude/plugins/ — avoids corrupting the user's
// existing Claude plugin registry.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface PluginInstallResult {
	installed: boolean;
	pluginRoot: string;
	version: string;
	skipped?: boolean; // true if already at correct version
}

/**
 * Copy plugin files from the .app bundle into ~/.vibes/plugins/vibes/{version}/.
 *
 * This is a self-contained copy — no shared state is modified. The desktop app's
 * plugin-discovery.ts reads from this directory directly.
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
	const vibesPluginsDir = join(h, ".vibes", "plugins", "vibes");
	const cacheDir = join(vibesPluginsDir, version);

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
	if (existsSync(vibesPluginsDir)) {
		try {
			const oldVersions = readdirSync(vibesPluginsDir).filter(v => !v.startsWith(".") && v !== version);
			for (const oldVersion of oldVersions) {
				rmSync(join(vibesPluginsDir, oldVersion), { recursive: true, force: true });
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

	return { installed: true, pluginRoot: cacheDir, version };
}
