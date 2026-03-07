/**
 * Claude subprocess bridge — one-shot helper + operation lock.
 *
 * One-shot helper: `runOneShot()` for generate/theme/create-theme operations.
 *
 * Operation lock: global mutex preventing concurrent claude operations.
 *
 * NOTE: A persistent bridge (long-lived `claude --print --input-format stream-json`)
 * is planned for future persistent session support but not yet implemented.
 */

import { buildClaudeArgs, cleanEnv } from '../lib/claude-subprocess.js';
import { createStreamParser } from '../lib/stream-parser.js';
import { sanitizeAppJsx } from './post-process.ts';
import type { ServerContext } from './config.ts';

// --- Types ---

export type EventCallback = (event: any) => void;

interface OperationLock {
  type: 'chat' | 'generate' | 'theme' | 'create-theme';
  cancel: () => void;
}

// --- Operation Lock (exported for testing) ---

let currentOp: OperationLock | null = null;

export function acquireLock(type: string, cancelFn: () => void): boolean {
  if (currentOp) return false;
  currentOp = { type, cancel: cancelFn } as OperationLock;
  return true;
}

export function releaseLock(): void {
  currentOp = null;
}

export function cancelCurrent(): boolean {
  if (!currentOp) return false;
  currentOp.cancel();
  currentOp = null;
  return true;
}

export function isLocked(): boolean {
  return currentOp !== null;
}

// --- Progress calculation ---

/**
 * Compute progress percentage and stage label from elapsed time and tool usage.
 * Exported for reuse by one-shot calcProgressLocal and tests.
 */
export function calcProgressFromCounters(
  elapsedSec: number,
  toolsUsed: number,
  hasEdited: boolean,
  floorProgress = 0,
): { progress: number; stage: string } {
  const timePct = Math.round(80 * (1 - Math.exp(-elapsedSec / 40)));
  const toolPct = hasEdited ? 85 : toolsUsed >= 3 ? 75 : toolsUsed >= 1 ? 50 : 0;
  const progress = Math.min(Math.max(timePct, toolPct, floorProgress), 95);

  const stage = hasEdited ? 'Finishing up...' :
                toolsUsed >= 3 ? 'Writing changes...' :
                toolsUsed >= 1 ? 'Reading & analyzing...' :
                elapsedSec > 10 ? 'Thinking about design...' :
                elapsedSec > 3 ? 'Loading context...' : 'Starting Claude...';

  return { progress, stage };
}

function summarizeInput(block: any): string {
  const toolName = block.name || '';
  const input = block.input || {};
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') return input.file_path || '';
  if (toolName === 'Glob') return input.pattern || '';
  if (toolName === 'Grep') return input.pattern || '';
  if (toolName === 'Bash') return (input.command || '').slice(0, 80);
  return '';
}

// --- One-Shot Helper ---

export interface OneShotOpts {
  maxTurns?: number;
  model?: string;
  tools?: string;
  cwd?: string;
  skipChat?: boolean;
  permissionMode?: string;
  /** Called with a cancel function once the subprocess is spawned. Wire to acquireLock. */
  onCancel?: (cancelFn: () => void) => void;
}

export async function runOneShot(
  prompt: string,
  opts: OneShotOpts,
  onEvent: EventCallback,
  projectRoot: string,
): Promise<string | null> {
  onEvent({ type: 'progress', progress: 0, stage: 'Starting Claude...', elapsed: 0 });

  const args = buildClaudeArgs({
    outputFormat: 'stream-json',
    maxTurns: opts.maxTurns,
    model: opts.model,
    tools: opts.tools,
    permissionMode: opts.permissionMode,
  });

  console.log(`[OneShot] Spawning (prompt: ${(prompt.length / 1024).toFixed(1)}KB)...`);

  const proc = Bun.spawn({
    cmd: ['claude', ...args],
    cwd: opts.cwd || process.cwd(),
    env: cleanEnv(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(prompt);
  proc.stdin.end();

  // Register cancel callback so the operation lock can kill this subprocess
  if (opts.onCancel) {
    opts.onCancel(() => {
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
    });
  }

  let stderrBuffer = '';
  let resultText = '';
  let toolsUsed = 0;
  let hasEdited = false;
  let errorSent = false;
  const startTime = Date.now();
  let lastStdoutTime = Date.now();
  let killedByTimeout = false;
  const pendingTools = new Map<string, { name: string; filePath: string }>();

  function getElapsed() {
    return Math.round((Date.now() - startTime) / 1000);
  }

  let baseProgress = 0;

  function calcProgressLocal(): { progress: number; stage: string } {
    const result = calcProgressFromCounters(getElapsed(), toolsUsed, hasEdited, baseProgress);
    baseProgress = result.progress; // ratchet: progress never decreases in one-shot
    return result;
  }

  // Read stderr in background
  const stderrPromise = (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrBuffer += decoder.decode(value, { stream: true });
      }
    } catch {}
  })();

  // Silence timeout
  const SILENCE_HARD = 300_000;
  const silenceInterval = setInterval(() => {
    const silentFor = Date.now() - lastStdoutTime;
    if (silentFor >= SILENCE_HARD) {
      console.error(`[OneShot] No stdout for ${silentFor / 1000}s — killing subprocess`);
      killedByTimeout = true;
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
      return;
    }
    const elapsed = getElapsed();
    const silenceOverride = silentFor >= 90_000
      ? { stage: `No activity for ${Math.round(silentFor / 1000)}s — click Cancel to retry` }
      : silentFor >= 45_000
      ? { stage: 'Waiting for response...' }
      : {};
    onEvent({ type: 'progress', ...calcProgressLocal(), ...silenceOverride, elapsed });
  }, 1000);

  // Read stdout with stream parser
  const parse = createStreamParser((event: any) => {
    lastStdoutTime = Date.now();
    const elapsed = getElapsed();

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          toolsUsed++;
          const toolName = block.name || '';
          if (toolName === 'Edit' || toolName === 'Write') hasEdited = true;
          const inputSummary = summarizeInput(block);

          if (block.id) {
            pendingTools.set(block.id, { name: toolName, filePath: inputSummary });
          }

          onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
          onEvent({ type: 'progress', ...calcProgressLocal(), elapsed });
        }
        if (block.type === 'text' && block.text) {
          resultText = block.text;
          onEvent({ type: 'token', text: block.text });
        }
      }
    } else if (event.type === 'stream_event' && event.event?.delta?.text) {
      onEvent({ type: 'token', text: event.event.delta.text });
    } else if (event.type === 'tool_result') {
      const toolDetail = event.tool_use_id ? pendingTools.get(event.tool_use_id) : undefined;
      if (event.tool_use_id) pendingTools.delete(event.tool_use_id);

      onEvent({
        type: 'tool_result',
        name: event.tool_name || '',
        content: (typeof event.content === 'string' ? event.content : JSON.stringify(event.content || '')).slice(0, 500),
        is_error: !!event.is_error,
        elapsed,
        _filePath: toolDetail?.filePath || '',
        _toolName: toolDetail?.name || event.tool_name || '',
      });
    } else if (event.type === 'result') {
      if (event.is_error) {
        const errMsg = event.result || 'Claude flagged the run as failed';
        console.error(`[OneShot] Result is_error: ${errMsg}`);
        onEvent({ type: 'error', message: errMsg });
        errorSent = true;
      } else {
        resultText = event.result || resultText || 'Done.';
      }
    } else if (event.type === 'rate_limit_event') {
      onEvent({ type: 'progress', ...calcProgressLocal(), stage: 'Rate limited, waiting...', elapsed });
    }
  });

  const stdoutReader = proc.stdout.getReader();
  try {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      lastStdoutTime = Date.now();
      parse(value);
    }
  } catch {}

  clearInterval(silenceInterval);

  // Wait for process to exit
  const exitCode = await proc.exited;
  await stderrPromise;

  console.log(`[OneShot] Completed in ${getElapsed()}s (${toolsUsed} tools, code ${exitCode})`);

  if (killedByTimeout && !errorSent) {
    onEvent({ type: 'error', message: `Claude stopped responding after ${getElapsed()}s. Try again.` });
    return null;
  }

  if (exitCode !== 0 && exitCode !== null) {
    const isMaxTurns = stderrBuffer.includes('max_turns') || stderrBuffer.includes('maxTurns');
    if (isMaxTurns) {
      console.log(`[OneShot] Hit max_turns (hasEdited=${hasEdited}) — treating as success`);
    } else if (!errorSent) {
      onEvent({ type: 'error', message: stderrBuffer.slice(0, 500) || `Claude exited with code ${exitCode}` });
      return null;
    }
  }

  // Post-process
  if (hasEdited) {
    sanitizeAppJsx(projectRoot);
  }

  if (!errorSent) {
    onEvent({
      type: 'complete',
      text: resultText || 'Done.',
      toolsUsed,
      elapsed: getElapsed(),
      hasEdited,
      skipChat: opts.skipChat,
    });
  }

  return resultText || null;
}

// --- Bun script runner (for deploy subprocess spawning) ---
// Requires `bun` on PATH. This is intentional — the server runs on Bun and all
// scripts are invoked via `bun run` to drop the Node.js runtime dependency.

interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export async function runBunScript(
  script: string,
  args: string[],
  opts: SpawnOpts = {}
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', script, ...args],
    cwd: opts.cwd,
    env: (opts.env || { ...process.env }) as Record<string, string>,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr };
}
