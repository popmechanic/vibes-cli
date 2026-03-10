// ElectroBun postWrap hook — runs after self-extracting bundle is created, before code signing.
// 1. Copies libWindowControls.dylib into the wrapper's Resources
// 2. Bundles plugin files into the wrapper's Resources
// Both must happen BEFORE signing so the code signature covers everything.
import { cpSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";

const wrapperPath = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
if (!wrapperPath) {
	console.error("  postWrap: ELECTROBUN_WRAPPER_BUNDLE_PATH not set");
	process.exit(1);
}

const cwd = process.cwd();
const repoRoot = dirname(cwd);
const wrapperResources = join(wrapperPath, "Contents", "Resources");

// --- 1. Copy native dylib ---
const dylib = join(cwd, "native", "macos", "build", "libWindowControls.dylib");
const dylibDest = join(wrapperResources, "libWindowControls.dylib");

if (existsSync(dylib)) {
	cpSync(dylib, dylibDest);
	const devId = process.env.ELECTROBUN_DEVELOPER_ID;
	if (devId) {
		const id = devId.includes("Developer ID") ? devId : `Developer ID Application: ${devId}`;
		const result = Bun.spawnSync([
			"codesign", "--force", "--timestamp", "--sign", id,
			"--options", "runtime", dylibDest
		]);
		if (result.exitCode !== 0) {
			console.error("  postWrap: codesign failed:", result.stderr.toString());
			process.exit(1);
		}
		console.log("  postWrap: signed and bundled libWindowControls.dylib");
	} else {
		console.log("  postWrap: bundled libWindowControls.dylib (unsigned — no ELECTROBUN_DEVELOPER_ID)");
	}
} else {
	console.error("  postWrap: libWindowControls.dylib not found at", dylib);
	process.exit(1);
}

// --- 2. Bundle plugin files ---
const pluginDest = join(wrapperResources, "vibes-plugin");
if (existsSync(pluginDest)) {
	rmSync(pluginDest, { recursive: true });
}

const rsyncResult = Bun.spawnSync([
	"rsync", "-a",
	"--exclude=.git", "--exclude=.git-backup", "--exclude=node_modules",
	"--exclude=vibes-desktop", "--exclude=deploy-api", "--exclude=.claude",
	"--exclude=scripts/__tests__", "--exclude=scripts/coverage",
	"--exclude=docs/plans", "--exclude=alchemy",
	"--exclude=skills/cloudflare/worker", "--exclude=superpowers",
	"--exclude=.netlify-deploy", "--exclude=.env", "--exclude=.env.*",
	"--exclude=.connect", "--exclude=.wrangler", "--exclude=.DS_Store",
	"--exclude=.vibes-tmp", "--exclude=.worktrees",
	"--exclude=*.bak.*", "--exclude=*.bak.html", "--exclude=*.bak.jsx",
	"--exclude=ai-worker", "--exclude=designs", "--exclude=dist",
	"--exclude=examples", "--exclude=test-vibes",
	"--exclude=.superpowers", "--exclude=wrangler.jsonc",
	`${repoRoot}/`, `${pluginDest}/`
]);

if (rsyncResult.exitCode !== 0) {
	console.error("  postWrap: rsync failed:", rsyncResult.stderr.toString());
	process.exit(1);
}

const duResult = Bun.spawnSync(["du", "-sh", pluginDest]);
const bundleSize = duResult.stdout.toString().split("\t")[0];
console.log(`  postWrap: plugin bundled (${bundleSize})`);
