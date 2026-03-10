// vibes-desktop/src/bun/plugin-installer.ts
//
// Installs plugin files into ~/.vibes/plugins/vibes/{version}/.
// Does NOT touch ~/.claude/plugins/ — avoids corrupting the user's
// existing Claude plugin registry.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

export interface PluginInstallResult {
	installed: boolean;
	pluginRoot: string;
	version: string;
	skipped?: boolean; // true if content hash matches (code is identical)
}

/**
 * Compute a content fingerprint of key plugin files.
 * Uses a fast hash of files that change when code changes — not the entire
 * tree (which includes node_modules, build artifacts, etc.)
 */
function computePluginFingerprint(pluginRoot: string): string {
	const hash = createHash("sha256");

	// Hash plugin.json (version + metadata)
	const pluginJson = join(pluginRoot, ".claude-plugin", "plugin.json");
	if (existsSync(pluginJson)) hash.update(readFileSync(pluginJson));

	// Hash key code files that affect runtime behavior
	const keyFiles = [
		"scripts/server/handlers/deploy.ts",
		"scripts/lib/claude-subprocess.js",
		"scripts/deploy-cloudflare.js",
		"scripts/assemble.js",
		"scripts/server.ts",
	];

	for (const rel of keyFiles) {
		const p = join(pluginRoot, rel);
		if (existsSync(p)) {
			hash.update(rel); // include path so renames are detected
			hash.update(readFileSync(p));
		}
	}

	return hash.digest("hex").slice(0, 16);
}

/**
 * Copy plugin files from the .app bundle into ~/.vibes/plugins/vibes/{version}/.
 *
 * This is a self-contained copy — no shared state is modified. The desktop app's
 * plugin-discovery.ts reads from this directory directly.
 *
 * Skips installation only if the installed copy has an identical content fingerprint
 * (not just version match — same version can have different code between builds).
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

	// Check if already installed with identical content
	if (existsSync(join(cacheDir, ".claude-plugin", "plugin.json"))) {
		try {
			const bundledHash = computePluginFingerprint(bundledPluginPath);
			const installedHash = computePluginFingerprint(cacheDir);
			if (bundledHash === installedHash) {
				return { installed: true, pluginRoot: cacheDir, version, skipped: true };
			}
			console.log(`[plugin-installer] Content changed (${installedHash} → ${bundledHash}), reinstalling v${version}`);
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
