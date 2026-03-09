import { CLAUDE_BIN, cleanEnv } from "./auth.ts";

// --- Shared Module Injection ---
// Loaded from the plugin's shared modules during init() (index.ts)
let _buildClaudeArgs: ((config?: any) => string[]) | null = null;
let _createStreamParser:
	| ((onEvent: (event: any) => void) => (chunk: any) => void)
	| null = null;
let _sanitizeAppJsx: ((projectRoot: string) => void) | null = null;

export function setSharedModules(mods: {
	buildClaudeArgs: typeof _buildClaudeArgs;
	createStreamParser: typeof _createStreamParser;
	sanitizeAppJsx: typeof _sanitizeAppJsx;
}) {
	_buildClaudeArgs = mods.buildClaudeArgs;
	_createStreamParser = mods.createStreamParser;
	_sanitizeAppJsx = mods.sanitizeAppJsx;
}

// --- Progress Calculation ---

export function calcProgressFromCounters(
	elapsedSec: number,
	toolsUsed: number,
	hasEdited: boolean,
	floorProgress = 0,
): { progress: number; stage: string } {
	let progress = 5;
	let stage = "Starting Claude...";

	if (elapsedSec > 2) {
		progress = 10;
		stage = "Loading context...";
	}
	if (elapsedSec > 8) {
		progress = 20;
		stage = "Analyzing request...";
	}
	if (toolsUsed > 0) {
		progress = 30 + Math.min(toolsUsed * 5, 30);
		stage = "Reading & analyzing...";
	}
	if (hasEdited) {
		progress = Math.max(progress, 70);
		stage = "Writing changes...";
	}
	if (elapsedSec > 60) {
		progress = Math.max(progress, 80);
		stage = "Finishing up...";
	}

	progress = Math.max(progress, floorProgress);
	progress = Math.min(progress, 95);

	return { progress, stage };
}

// --- Operation Lock ---

let currentLock: { type: string; cancelFn: () => void } | null = null;

export function acquireLock(type: string, cancelFn: () => void): boolean {
	if (currentLock) return false;
	currentLock = { type, cancelFn };
	return true;
}

export function releaseLock(): void {
	currentLock = null;
}

export function cancelCurrent(): boolean {
	if (!currentLock) return false;
	currentLock.cancelFn();
	releaseLock();
	return true;
}

export function isLocked(): boolean {
	return currentLock !== null;
}

// --- Active Tasks ---

const activeTasks = new Map<
	string,
	{
		proc: ReturnType<typeof Bun.spawn>;
		heartbeat: ReturnType<typeof setInterval>;
	}
>();

// --- Spawn Claude ---

export interface SpawnOpts {
	maxTurns?: number;
	model?: string;
	tools?: string;
	cwd?: string;
	permissionMode?: string;
}

export function spawnClaude(
	taskId: string,
	prompt: string,
	opts: SpawnOpts,
	rpc: any,
): ReturnType<typeof Bun.spawn> | null {
	const cancelFn = () => abortTask(taskId);
	if (!acquireLock("claude", cancelFn)) {
		rpc.send.error({
			taskId,
			message: "Another operation is in progress",
		});
		return null;
	}

	let currentState:
		| "spawning"
		| "running"
		| "thinking"
		| "tool_use"
		| "idle" = "spawning";
	let lastToolName = "";
	let lastOutputTime = Date.now();
	let toolsUsed = 0;
	let hasEdited = false;
	let floorProgress = 0;
	const startTime = Date.now();

	if (!_buildClaudeArgs || !_createStreamParser) {
		rpc.send.error({
			taskId,
			message: "Plugin modules not loaded — wait for init to complete",
		});
		releaseLock();
		return null;
	}

	const args = _buildClaudeArgs({
		outputFormat: "stream-json",
		maxTurns: opts.maxTurns,
		model: opts.model,
		tools: opts.tools,
		permissionMode: opts.permissionMode,
	});

	// Spawn with stdin: 'pipe' — write prompt via stdin, not CLI args
	const proc = Bun.spawn([CLAUDE_BIN, ...args], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: cleanEnv(),
		cwd: opts.cwd,
	});

	// Write prompt to stdin and close
	proc.stdin.write(prompt);
	proc.stdin.end();

	// Heartbeat every 2s
	const heartbeat = setInterval(() => {
		const elapsedSec = (Date.now() - startTime) / 1000;
		const { progress, stage } = calcProgressFromCounters(
			elapsedSec,
			toolsUsed,
			hasEdited,
			floorProgress,
		);
		floorProgress = progress; // ratchet

		rpc.send.status({
			taskId,
			state: currentState,
			detail: currentState === "tool_use" ? lastToolName : undefined,
			elapsedMs: Date.now() - startTime,
			lastActivityMs: Date.now() - lastOutputTime,
			progress,
			stage,
		});

		// Silence timeout: 300s
		const silenceSec = (Date.now() - lastOutputTime) / 1000;
		if (silenceSec > 300) {
			console.warn(
				"[claude-manager] Silence timeout — killing subprocess",
			);
			proc.kill("SIGTERM");
		}
	}, 2000);

	activeTasks.set(taskId, { proc, heartbeat });

	// Collect stderr
	const stderrChunks: string[] = [];
	const stderrDecoder = new TextDecoder();
	(async () => {
		const reader = proc.stderr.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				stderrChunks.push(
					stderrDecoder.decode(value, { stream: true }),
				);
			}
		} catch {}
	})();

	function cleanup() {
		clearInterval(heartbeat);
		activeTasks.delete(taskId);
		currentState = "idle";
		releaseLock();
	}

	// Parse stdout using the shared stream parser from the plugin
	const parse = _createStreamParser!((event) => {
		lastOutputTime = Date.now();

		switch (event.type) {
			case "system":
				currentState = "running";
				break;

			case "assistant": {
				const msg = event.message;
				if (!msg?.content) break;
				for (const block of msg.content) {
					if (block.type === "text") {
						rpc.send.token({ taskId, text: block.text });
						currentState = "running";
					} else if (block.type === "tool_use") {
						rpc.send.toolUse({
							taskId,
							tool: block.name,
							input:
								typeof block.input === "string"
									? block.input
									: JSON.stringify(block.input),
						});
						currentState = "tool_use";
						lastToolName = block.name;
						toolsUsed++;
						if (
							block.name === "Edit" ||
							block.name === "Write"
						) {
							hasEdited = true;
						}
					}
				}
				break;
			}

			case "stream_event": {
				const delta = event.event?.delta;
				if (delta?.text) {
					rpc.send.token({ taskId, text: delta.text });
					currentState = "running";
				}
				break;
			}

			case "tool_result": {
				const content = event.content ?? event.message?.content;
				const text =
					typeof content === "string"
						? content
						: Array.isArray(content)
							? content
									.map((b: any) => b.text ?? "")
									.join("")
							: JSON.stringify(content);
				rpc.send.toolResult({
					taskId,
					tool: lastToolName,
					output: text.slice(0, 10000),
					isError: !!event.is_error,
				});
				currentState = "running";

				// Notify that app was updated if Write/Edit succeeded
				if (
					!event.is_error &&
					(lastToolName === "Write" || lastToolName === "Edit")
				) {
					rpc.send.appUpdated({ path: "app.jsx" });
				}
				break;
			}

			case "result":
				// Post-process: fix CSS unicode escapes and strip redeclared globals
				if (hasEdited && _sanitizeAppJsx && opts.cwd) {
					_sanitizeAppJsx(opts.cwd);
				}
				rpc.send.done({
					taskId,
					text: "",
					cost: event.total_cost_usd ?? 0,
					duration: event.duration_ms ?? 0,
					hasEdited,
				});
				cleanup();
				break;
		}
	});

	// Pump stdout
	(async () => {
		const reader = proc.stdout.getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				parse(value);
			}
		} catch {}

		const exitCode = await proc.exited;
		if (exitCode !== 0 && currentState !== "idle") {
			const stderr = stderrChunks.join("");
			rpc.send.error({
				taskId,
				message:
					stderr.trim() ||
					`Claude exited with code ${exitCode}`,
			});
		}
		cleanup();
	})();

	return proc;
}

export function abortTask(taskId: string): boolean {
	const task = activeTasks.get(taskId);
	if (!task) return false;

	task.proc.kill("SIGTERM");
	// Fallback to SIGKILL after 5s
	setTimeout(() => {
		try {
			task.proc.kill("SIGKILL");
		} catch {}
	}, 5000);

	clearInterval(task.heartbeat);
	activeTasks.delete(taskId);
	releaseLock();
	return true;
}
