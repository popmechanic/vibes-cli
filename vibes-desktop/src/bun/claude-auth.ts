// vibes-desktop/src/bun/claude-auth.ts
// Wraps Claude CLI auth commands for desktop app startup.

import { CLAUDE_BIN } from "./auth.ts";

export interface ClaudeAuthResult {
	loggedIn: boolean;
	email?: string;
	authMethod?: string;
}

/**
 * Clean environment for spawning Claude subprocesses.
 * Loom gotcha #1: Remove nesting guards but preserve CLAUDE_CODE_OAUTH_TOKEN.
 */
function cleanEnv(): Record<string, string | undefined> {
	const env = { ...process.env };
	delete env.CLAUDECODE;
	delete env.CLAUDE_CODE_ENTRYPOINT;
	// Deliberately keep CLAUDE_CODE_OAUTH_TOKEN
	return env;
}

/**
 * Check if Claude CLI has valid authentication.
 * Spawns `claude auth status` and parses the JSON output.
 */
export function checkClaudeAuth(): ClaudeAuthResult {
	try {
		const result = Bun.spawnSync([CLAUDE_BIN, "auth", "status"], {
			timeout: 10_000,
			env: cleanEnv(),
		});

		const stdout = result.stdout.toString().trim();
		if (!stdout) return { loggedIn: false };

		const status = JSON.parse(stdout);
		return {
			loggedIn: !!status.loggedIn,
			email: status.email,
			authMethod: status.authMethod,
		};
	} catch {
		return { loggedIn: false };
	}
}

/**
 * Start the Claude CLI login flow.
 * Spawns `claude auth login` which opens the system browser.
 * Non-blocking — returns the subprocess reference.
 */
export function startClaudeLogin(): ReturnType<typeof Bun.spawn> {
	return Bun.spawn([CLAUDE_BIN, "auth", "login"], {
		env: cleanEnv(),
		stdout: "ignore",
		stderr: "pipe",
	});
}

/**
 * Poll `claude auth status` until loggedIn is true or timeout.
 * @param timeoutMs - Maximum wait time (default 5 minutes)
 * @param pollIntervalMs - Time between polls (default 2 seconds)
 * @returns Auth result on success
 * @throws Error on timeout
 */
export async function waitForClaudeAuth(
	timeoutMs: number = 300_000,
	pollIntervalMs: number = 2_000,
): Promise<ClaudeAuthResult> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		await new Promise(r => setTimeout(r, pollIntervalMs));
		const result = checkClaudeAuth();
		if (result.loggedIn) return result;
	}

	throw new Error("Sign-in timed out — please try again");
}
