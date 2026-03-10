// ElectroBun postBuild hook — runs after app bundle is built, before code signing.
// 1. Copies libWindowControls.dylib into the app bundle
// 2. Bundles plugin files into Contents/Resources/vibes-plugin/
// Both must happen BEFORE signing so the code signature covers everything.
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";

const cwd = process.cwd();
const repoRoot = dirname(cwd); // vibes-desktop/ → vibes-skill/
const appBase = join(cwd, "build", "stable-macos-arm64", "VibesOS.app");
const appResources = join(appBase, "Contents", "Resources");
const appBun = join(appResources, "app", "bun");

// --- 1. Copy native dylib ---
const dylib = join(cwd, "native", "macos", "build", "libWindowControls.dylib");

if (!existsSync(dylib)) {
	console.error("  postBuild: libWindowControls.dylib not found at", dylib);
	process.exit(1);
}

if (!existsSync(appBun)) {
	console.error("  postBuild: app/bun dir not found at", appBun);
	process.exit(1);
}

const dylibDest = join(appBun, "libWindowControls.dylib");
cpSync(dylib, dylibDest);

// Sign dylib with Developer ID (ElectroBun only signs Contents/MacOS/ binaries)
const devId = process.env.ELECTROBUN_DEVELOPER_ID;
if (devId) {
	const id = devId.includes("Developer ID") ? devId : `Developer ID Application: ${devId}`;
	const result = Bun.spawnSync([
		"codesign", "--force", "--timestamp", "--sign", id,
		"--options", "runtime", dylibDest
	]);
	if (result.exitCode !== 0) {
		console.error("  postBuild: codesign failed:", result.stderr.toString());
		process.exit(1);
	}
	console.log("  postBuild: signed and copied libWindowControls.dylib");
} else {
	console.log("  postBuild: copied libWindowControls.dylib (unsigned — no ELECTROBUN_DEVELOPER_ID)");
}

// --- 2. Bundle plugin files ---
const pluginDest = join(appResources, "vibes-plugin");
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
	console.error("  postBuild: rsync failed:", rsyncResult.stderr.toString());
	process.exit(1);
}

// Get bundle size
const duResult = Bun.spawnSync(["du", "-sh", pluginDest]);
const bundleSize = duResult.stdout.toString().split("\t")[0];
console.log(`  postBuild: plugin bundled (${bundleSize})`);

