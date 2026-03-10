import { existsSync } from "fs";

// macOS GUI apps inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// Claude's npm shim uses #!/usr/bin/env node — if node's dir isn't in
// PATH the spawn fails. Inherit the user's real shell PATH instead.
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
		`${home}/.claude/local`,
	];
	const current = process.env.PATH || "";
	const dirs = new Set(current.split(":"));
	const missing = fallbacks.filter((p) => !dirs.has(p));
	if (missing.length > 0) {
		process.env.PATH = [...missing, current].join(":");
	}
}
inheritShellPath();

export function resolveClaudePath(): string {
	for (const flags of ["-lic", "-lc", "-ic"] as const) {
		try {
			const result = Bun.spawnSync(["zsh", flags, "which claude"], {
				timeout: 5000,
			});
			const resolved = result.stdout.toString().trim();
			if (
				resolved &&
				(result.exitCode === 0 || result.exitCode === undefined) &&
				!resolved.includes("not found")
			) {
				return resolved;
			}
		} catch {}
	}

	const home = process.env.HOME || "";
	const candidates = [
		`${home}/.claude/local/claude`,
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
		`${home}/.local/bin/claude`,
		`${home}/.npm-global/bin/claude`,
	];

	for (const p of candidates) {
		if (existsSync(p)) return p;
	}

	return "claude";
}

export let CLAUDE_BIN = resolveClaudePath();

/** Re-resolve after user installs claude between retries */
export function refreshClaudePath(): void {
	CLAUDE_BIN = resolveClaudePath();
}

/**
 * Install Claude Code via Anthropic's official installer.
 * Downloads the script first (so we can detect curl failures),
 * then runs it. Returns the resolved path to the installed binary.
 * Throws if installation fails.
 */
export async function installClaude(): Promise<string> {
	const tmpScript = "/tmp/claude-install.sh";

	// Step 1: Download installer script (--fail returns non-zero on HTTP errors)
	const download = Bun.spawnSync(
		["curl", "--fail", "-sSL", "https://claude.ai/install.sh", "-o", tmpScript],
		{ timeout: 30_000 }
	);

	if (download.exitCode !== 0) {
		const stderr = download.stderr.toString().trim();
		throw new Error(`Failed to download installer: ${stderr || "network error"}`);
	}

	// Step 2: Run the installer (official docs use bash, not sh)
	const install = Bun.spawnSync(
		["bash", tmpScript],
		{ timeout: 300_000, stderr: "pipe", stdout: "pipe" }
	);

	const stdout = install.stdout.toString().trim();
	const stderr = install.stderr.toString().trim();

	if (install.exitCode === null) {
		throw new Error("Claude installation timed out — please check your internet connection and try again");
	}

	if (install.exitCode !== 0) {
		throw new Error(`Claude installation failed (exit ${install.exitCode}): ${stderr || stdout || "unknown error"}`);
	}

	// Step 3: Find the binary — check known locations directly
	refreshClaudePath();
	if (CLAUDE_BIN !== "claude") {
		return CLAUDE_BIN;
	}

	// If resolveClaudePath didn't find it, check installer output for hints
	// and do one more scan of likely locations
	const home = process.env.HOME || "";
	const postInstallPaths = [
		`${home}/.claude/local/claude`,
		`${home}/.local/bin/claude`,
		"/usr/local/bin/claude",
	];

	for (const p of postInstallPaths) {
		if (existsSync(p)) {
			CLAUDE_BIN = p;
			return p;
		}
	}

	throw new Error(
		`Installer completed but Claude binary not found. ` +
		`Output: ${stdout.slice(0, 200)}${stderr ? ` | ${stderr.slice(0, 200)}` : ""}`
	);
}
