import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const GCS_BUCKET = "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases";
const VIBES_BIN_DIR = join(homedir(), ".vibes", "bin");
const VIBES_CLAUDE_BIN = join(VIBES_BIN_DIR, "claude");

// macOS GUI apps inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// We still inherit the shell PATH for other tools (node, bun, etc.)
function inheritShellPath(): void {
	try {
		const result = Bun.spawnSync(["zsh", "-lc", "echo $PATH"], {
			timeout: 5000,
		});
		const shellPath = result.stdout.toString().trim();
		if ((result.exitCode === 0 || result.exitCode === undefined) && shellPath && shellPath.includes("/")) {
			process.env.PATH = shellPath;
			return;
		}
	} catch {}

	// Fallback: ensure a few common locations exist
	const home = process.env.HOME || "";
	const fallbacks = [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		`${home}/.bun/bin`,
	];
	const current = process.env.PATH || "";
	const dirs = new Set(current.split(":"));
	const missing = fallbacks.filter((p) => !dirs.has(p));
	if (missing.length > 0) {
		process.env.PATH = [...missing, current].join(":");
	}
}
inheritShellPath();

/**
 * Resolve the Claude binary path.
 * Always returns the explicit ~/.vibes/bin/claude path — never bare "claude".
 * This prevents collisions with the user's own Claude installation.
 */
export function resolveClaudePath(): string {
	const home = process.env.HOME || homedir() || "";
	const vibesBin = join(home, ".vibes", "bin", "claude");
	console.log(`[auth] resolveClaudePath: checking ${vibesBin}`);

	if (existsSync(vibesBin)) {
		console.log(`[auth] Found vibes-managed claude at ${vibesBin}`);
		return vibesBin;
	}

	// Not yet installed — return the target path anyway.
	// Callers check CLAUDE_BIN !== VIBES_CLAUDE_BIN before assuming it exists;
	// setup.ts will install if missing.
	console.log("[auth] Vibes-managed claude not found yet, returning target path");
	return vibesBin;
}

export let CLAUDE_BIN = resolveClaudePath();

/** Re-resolve after installing claude */
export function refreshClaudePath(): void {
	CLAUDE_BIN = resolveClaudePath();
}

/** Check if our managed binary exists on disk */
export function isClaudeInstalled(): boolean {
	return existsSync(CLAUDE_BIN);
}

/**
 * Detect platform for GCS download.
 * Returns the platform key used in the manifest (e.g. "darwin-arm64").
 */
function detectPlatform(): string {
	const os = process.platform === "darwin" ? "darwin" : "linux";
	let arch = process.arch === "x64" ? "x64" : "arm64";

	// Detect Rosetta 2: if running as x64 on ARM Mac, use native arm64
	if (os === "darwin" && arch === "x64") {
		try {
			const result = Bun.spawnSync(["sysctl", "-n", "sysctl.proc_translated"], { timeout: 3000 });
			if (result.stdout.toString().trim() === "1") {
				arch = "arm64";
			}
		} catch {}
	}

	return `${os}-${arch}`;
}

/**
 * Install Claude Code by downloading the native binary directly from Anthropic's GCS bucket.
 *
 * This replicates the download+verify logic from claude.ai/install.sh but skips
 * `claude install` — which would write to ~/.claude/local/ and modify the user's
 * shell PATH. Instead we place the binary at ~/.vibes/bin/claude, creating a
 * fully isolated installation that can't collide with the user's own Claude setup.
 *
 * The GCS bucket is Anthropic's public distribution endpoint — the same one their
 * official install script uses. We're fetching the same binary, just placing it
 * in our own directory.
 */
export async function installClaude(): Promise<string> {
	const platform = detectPlatform();
	console.log(`[auth] Installing Claude for platform: ${platform}`);

	// Step 1: Fetch latest version string
	const versionResult = Bun.spawnSync(
		["curl", "--fail", "-sSL", `${GCS_BUCKET}/latest`],
		{ timeout: 15_000 }
	);
	if (versionResult.exitCode !== 0) {
		throw new Error(`Failed to fetch latest version: ${versionResult.stderr.toString().trim() || "network error"}`);
	}
	const version = versionResult.stdout.toString().trim();
	if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
		throw new Error(`Invalid version string: ${version}`);
	}
	console.log(`[auth] Latest Claude version: ${version}`);

	// Step 2: Fetch manifest and extract checksum
	const manifestResult = Bun.spawnSync(
		["curl", "--fail", "-sSL", `${GCS_BUCKET}/${version}/manifest.json`],
		{ timeout: 15_000 }
	);
	if (manifestResult.exitCode !== 0) {
		throw new Error(`Failed to fetch manifest: ${manifestResult.stderr.toString().trim()}`);
	}

	let checksum: string;
	try {
		const manifest = JSON.parse(manifestResult.stdout.toString());
		checksum = manifest.platforms?.[platform]?.checksum;
		if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
			throw new Error(`Platform ${platform} not found in manifest`);
		}
	} catch (err: any) {
		if (err.message.includes("Platform")) throw err;
		throw new Error(`Failed to parse manifest: ${err.message}`);
	}
	console.log(`[auth] Expected checksum: ${checksum.slice(0, 16)}...`);

	// Step 3: Download the binary
	mkdirSync(VIBES_BIN_DIR, { recursive: true });
	const tmpPath = join(VIBES_BIN_DIR, `claude-downloading-${Date.now()}`);

	const downloadResult = Bun.spawnSync(
		["curl", "--fail", "-sSL", "-o", tmpPath, `${GCS_BUCKET}/${version}/${platform}/claude`],
		{ timeout: 300_000 }
	);
	if (downloadResult.exitCode !== 0) {
		try { require("fs").unlinkSync(tmpPath); } catch {}
		throw new Error(`Failed to download binary: ${downloadResult.stderr.toString().trim() || "network error"}`);
	}

	// Step 4: Verify checksum
	const shaResult = Bun.spawnSync(
		["shasum", "-a", "256", tmpPath],
		{ timeout: 10_000 }
	);
	const actual = shaResult.stdout.toString().trim().split(/\s+/)[0];
	if (actual !== checksum) {
		try { require("fs").unlinkSync(tmpPath); } catch {}
		throw new Error(`Checksum verification failed: expected ${checksum.slice(0, 16)}..., got ${actual?.slice(0, 16)}...`);
	}
	console.log(`[auth] Checksum verified`);

	// Step 5: Atomic move into place and make executable
	const { renameSync, chmodSync } = require("fs");
	chmodSync(tmpPath, 0o755);
	renameSync(tmpPath, VIBES_CLAUDE_BIN);

	console.log(`[auth] Claude installed at ${VIBES_CLAUDE_BIN}`);

	// Update the cached path
	CLAUDE_BIN = VIBES_CLAUDE_BIN;
	return VIBES_CLAUDE_BIN;
}
