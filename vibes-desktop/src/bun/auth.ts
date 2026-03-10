import { existsSync } from "fs";
import { homedir } from "os";

export function resolveClaudePath(): string {
	// In ElectroBun bundles, process.env.HOME may be unset — use os.homedir() as fallback
	const home = process.env.HOME || homedir() || "";
	console.log(`[auth] resolveClaudePath: HOME=${home}`);

	// Static candidates first (fast, no shell spawning)
	// Homebrew/npm-global first — they get the latest version
	const candidates = [
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
		`${home}/.npm-global/bin/claude`,
		`${home}/.nvm/versions/node/current/bin/claude`,
		`${home}/.claude/local/claude`,
		`${home}/.local/bin/claude`,
	];

	for (const p of candidates) {
		if (p && existsSync(p)) {
			console.log(`[auth] Found claude at candidate: ${p}`);
			return p;
		}
	}

	// Shell-based resolution as fallback
	for (const flags of ["-lic", "-lc", "-ic"] as const) {
		try {
			const result = Bun.spawnSync(["zsh", flags, "which claude"], {
				timeout: 5000,
				env: { ...process.env, HOME: home },
			});
			const resolved = result.stdout.toString().trim();
			if (
				resolved &&
				result.exitCode === 0 &&
				!resolved.includes("not found") &&
				existsSync(resolved)
			) {
				console.log(`[auth] Found claude via zsh ${flags}: ${resolved}`);
				return resolved;
			}
		} catch (e) {
			console.log(`[auth] zsh ${flags} failed: ${e}`);
		}
	}

	console.log("[auth] Could not find claude binary, falling back to 'claude'");
	return "claude";
}

export const CLAUDE_BIN = resolveClaudePath();
