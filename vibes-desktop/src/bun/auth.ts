import { existsSync } from "fs";

export function resolveClaudePath(): string {
	for (const flags of ["-lic", "-lc", "-ic"] as const) {
		try {
			const result = Bun.spawnSync(["zsh", flags, "which claude"], {
				timeout: 5000,
			});
			const resolved = result.stdout.toString().trim();
			if (
				resolved &&
				result.exitCode === 0 &&
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

export const CLAUDE_BIN = resolveClaudePath();
