import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function resolveClaudePath(): string {
	// Try interactive login shell (sources .zprofile AND .zshrc)
	for (const flags of ["-lic", "-lc", "-ic"]) {
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

	// Direct path check — common install locations
	const home = process.env.HOME || "";
	const candidates = [
		`${home}/.claude/local/claude`,
		`/usr/local/bin/claude`,
		`/opt/homebrew/bin/claude`,
		`${home}/.local/bin/claude`,
		`${home}/.npm-global/bin/claude`,
	];

	for (const p of candidates) {
		try {
			const file = Bun.file(p);
			if (file.size > 0) return p;
		} catch {}
	}

	return "claude"; // fallback
}

export function cleanEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.CLAUDECODE;
	delete env.CLAUDE_CODE_ENTRYPOINT;
	if (env.CMUX_SURFACE_ID) {
		delete env.CMUX_SURFACE_ID;
		delete env.CMUX_PANEL_ID;
		delete env.CMUX_TAB_ID;
		delete env.CMUX_WORKSPACE_ID;
		delete env.CMUX_SOCKET_PATH;
	}

	// macOS GUI apps don't inherit shell environment variables.
	// Source Cloudflare API token from ~/.vibes/cloudflare-api-token if not already
	// in the environment.
	if (!env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_API_KEY) {
		const tokenPath = join(homedir(), ".vibes", "cloudflare-api-token");
		try {
			if (existsSync(tokenPath)) {
				env.CLOUDFLARE_API_TOKEN = readFileSync(tokenPath, "utf8").trim();
			}
		} catch {}
	}

	return env;
}

// Cached at startup
export const CLAUDE_BIN = resolveClaudePath();

export async function checkClaudeInstalled(): Promise<{
	installed: boolean;
	version?: string;
	path?: string;
}> {
	try {
		const result = Bun.spawnSync([CLAUDE_BIN, "--version"], {
			timeout: 10000,
			env: cleanEnv(),
		});
		const version = result.stdout.toString().trim();
		if (result.exitCode === 0 && version) {
			return { installed: true, version, path: CLAUDE_BIN };
		}
		return { installed: false };
	} catch {
		return { installed: false };
	}
}

export async function checkClaudeAuth(): Promise<{
	authenticated: boolean;
	account?: string;
}> {
	try {
		// Spawn a minimal Claude command to test auth
		const result = Bun.spawnSync(
			[
				CLAUDE_BIN,
				"-p",
				"--output-format",
				"json",
				"--max-turns",
				"1",
				"--permission-mode",
				"bypassPermissions",
				"--setting-sources",
				"",
				"Reply with exactly: AUTH_OK",
			],
			{
				timeout: 30000,
				env: cleanEnv(),
			},
		);

		const stdout = result.stdout.toString().trim();
		if (result.exitCode === 0 && stdout.includes("AUTH_OK")) {
			return { authenticated: true };
		}

		const stderr = result.stderr.toString();
		if (
			stderr.includes("not authenticated") ||
			stderr.includes("login") ||
			stderr.includes("unauthorized")
		) {
			return { authenticated: false };
		}

		// If it ran at all without auth error, auth is probably fine
		if (result.exitCode === 0) {
			return { authenticated: true };
		}

		return { authenticated: false };
	} catch {
		return { authenticated: false };
	}
}

export async function triggerClaudeLogin(): Promise<{
	success: boolean;
	error?: string;
}> {
	try {
		// claude login opens browser for OAuth
		const proc = Bun.spawn([CLAUDE_BIN, "login"], {
			stdout: "pipe",
			stderr: "pipe",
			env: cleanEnv(),
		});

		const exitCode = await proc.exited;
		if (exitCode === 0) {
			return { success: true };
		}

		const stderr = await new Response(proc.stderr).text();
		return { success: false, error: stderr.trim() };
	} catch (err) {
		return { success: false, error: String(err) };
	}
}

export async function checkPocketIdAuth(): Promise<{
	authenticated: boolean;
}> {
	const tokenPath = join(homedir(), ".vibes", "auth.json");
	if (!existsSync(tokenPath)) return { authenticated: false };

	try {
		const data = JSON.parse(await Bun.file(tokenPath).text());
		// Check if token exists and hasn't expired
		if (data.access_token && data.expires_at) {
			const expiresAt = new Date(data.expires_at).getTime();
			if (expiresAt > Date.now()) {
				return { authenticated: true };
			}
		}
		return { authenticated: false };
	} catch {
		return { authenticated: false };
	}
}
