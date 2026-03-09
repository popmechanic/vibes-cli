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
