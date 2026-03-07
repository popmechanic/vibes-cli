/**
 * Claude subprocess bridge — persistent session + one-shot helper.
 *
 * Persistent bridge: long-lived `claude --print --input-format stream-json --output-format stream-json`
 * process with stdin/stdout for chat. Detects response boundaries via `result` events.
 *
 * One-shot helper: `runOneShot()` for generate/theme/create-theme operations.
 *
 * Operation lock: global mutex preventing concurrent claude operations.
 */

import { join } from 'path';
import type { Subprocess } from 'bun';
import { buildClaudeArgs, cleanEnv } from '../lib/claude-subprocess.js';
import { createStreamParser } from '../lib/stream-parser.js';
import { sanitizeAppJsx } from './post-process.ts';
import type { ServerContext } from './config.ts';

// --- Types ---

export type EventCallback = (event: any) => void;

interface TurnState {
  resultText: string;
  toolsUsed: number;
  hasEdited: boolean;
  errorSent: boolean;
  startTime: number;
  skipChat: boolean;
  lastStdoutTime: number;
  pendingTools: Map<string, { name: string; filePath: string }>;
}

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

// --- Progress calculation (shared by persistent bridge and one-shot) ---

/**
 * Compute progress percentage and stage label from elapsed time and tool usage.
 * Exported for reuse by both the persistent bridge dispatchEvent and one-shot calcProgressLocal.
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

function calcProgress(turnState: TurnState): { progress: number; stage: string } {
  const elapsed = Math.round((Date.now() - turnState.startTime) / 1000);
  return calcProgressFromCounters(elapsed, turnState.toolsUsed, turnState.hasEdited);
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

// --- Persistent Bridge ---

export interface PersistentBridge {
  send: (message: string, opts?: { skipChat?: boolean }) => boolean;
  cancel: () => void;
  kill: () => void;
  isAlive: () => boolean;
}

export function createPersistentBridge(
  ctx: ServerContext,
  onEvent: EventCallback
): PersistentBridge {
  let proc: Subprocess | null = null;
  let alive = false;
  let turnState: TurnState | null = null;
  let stderrBuffer = '';
  let lastActivity = Date.now();
  let silenceInterval: Timer | null = null;

  const SILENCE_SOFT = 45_000;
  const SILENCE_WARN = 90_000;
  const SILENCE_HARD = 300_000;
  const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 min

  function spawn(): void {
    if (alive) return;

    const cmd = [
      'claude', '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Edit,Write,Glob,Grep',
    ];

    proc = Bun.spawn({
      cmd,
      cwd: ctx.projectRoot,
      env: cleanEnv(),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    alive = true;
    stderrBuffer = '';
    lastActivity = Date.now();

    console.log('[Bridge] Spawned persistent claude session');

    // Read stdout
    readStdout();

    // Read stderr
    readStderr();

    // Handle process exit
    proc!.exited.then((code) => {
      alive = false;
      const exitedProc = proc;
      proc = null;

      if (silenceInterval) {
        clearInterval(silenceInterval);
        silenceInterval = null;
      }

      if (turnState) {
        const elapsed = Math.round((Date.now() - turnState.startTime) / 1000);
        const isMaxTurns = stderrBuffer.includes('max_turns') || stderrBuffer.includes('maxTurns');

        if (isMaxTurns) {
          console.log(`[Bridge] Hit max_turns (hasEdited=${turnState.hasEdited}) — treating as success`);
          if (!turnState.errorSent) {
            onEvent({
              type: 'complete',
              text: turnState.resultText || 'Done.',
              toolsUsed: turnState.toolsUsed,
              elapsed,
              hasEdited: turnState.hasEdited,
              skipChat: turnState.skipChat,
            });
          }
        } else if (code !== 0) {
          onEvent({ type: 'error', message: stderrBuffer.slice(0, 500) || `Bridge exited with code ${code}` });
        }

        turnState = null;
        releaseLock();
      }

      onEvent({ type: 'session_end', exitCode: code });
      console.log(`[Bridge] Process exited with code ${code}`);
    });
  }

  async function readStdout(): Promise<void> {
    if (!proc) return;
    const reader = proc.stdout.getReader();
    const parse = createStreamParser(dispatchEvent);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (turnState) turnState.lastStdoutTime = Date.now();
        lastActivity = Date.now();
        parse(value);
      }
    } catch {
      // Stream closed
    }
  }

  async function readStderr(): Promise<void> {
    if (!proc) return;
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrBuffer += decoder.decode(value, { stream: true });
        // Cap stderr buffer at 10KB
        if (stderrBuffer.length > 10240) {
          stderrBuffer = stderrBuffer.slice(-5120);
        }
      }
    } catch {
      // Stream closed
    }
  }

  function dispatchEvent(parsed: any): void {
    if (!turnState) return;

    const elapsed = Math.round((Date.now() - turnState.startTime) / 1000);
    turnState.lastStdoutTime = Date.now();

    if (parsed.type === 'assistant' && parsed.message?.content) {
      for (const block of parsed.message.content) {
        if (block.type === 'tool_use') {
          turnState.toolsUsed++;
          const toolName = block.name || '';
          if (toolName === 'Edit' || toolName === 'Write') turnState.hasEdited = true;
          const inputSummary = summarizeInput(block);

          if (block.id) {
            turnState.pendingTools.set(block.id, { name: toolName, filePath: inputSummary });
          }

          onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
        }
        if (block.type === 'text' && block.text) {
          turnState.resultText = block.text;
          onEvent({ type: 'token', text: block.text });
        }
      }
      onEvent({ type: 'progress', ...calcProgress(turnState), elapsed });
    } else if (parsed.type === 'tool_result') {
      const toolDetail = parsed.tool_use_id ? turnState.pendingTools.get(parsed.tool_use_id) : undefined;
      if (parsed.tool_use_id) turnState.pendingTools.delete(parsed.tool_use_id);

      onEvent({
        type: 'tool_result',
        name: parsed.tool_name || '',
        content: (typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content || '')).slice(0, 500),
        is_error: !!parsed.is_error,
        elapsed,
        _filePath: toolDetail?.filePath || '',
        _toolName: toolDetail?.name || parsed.tool_name || '',
      });
    } else if (parsed.type === 'rate_limit_event') {
      onEvent({ type: 'progress', ...calcProgress(turnState), stage: 'Rate limited, waiting...', elapsed });
    } else if (parsed.type === 'result') {
      // *** RESPONSE BOUNDARY — turn is complete ***
      if (parsed.is_error) {
        onEvent({ type: 'error', message: parsed.result || 'Claude flagged the run as failed' });
        turnState.errorSent = true;
      } else {
        turnState.resultText = parsed.result || turnState.resultText || 'Done.';
      }

      if (turnState.hasEdited) {
        sanitizeAppJsx(ctx.projectRoot);
      }

      if (!turnState.errorSent) {
        onEvent({
          type: 'complete',
          text: turnState.resultText,
          toolsUsed: turnState.toolsUsed,
          elapsed,
          hasEdited: turnState.hasEdited,
          skipChat: turnState.skipChat,
        });
      }

      if (silenceInterval) {
        clearInterval(silenceInterval);
        silenceInterval = null;
      }

      turnState = null;
      releaseLock();
    } else if (parsed.type === 'stream_event' && parsed.event?.delta?.text) {
      onEvent({ type: 'token', text: parsed.event.delta.text });
    }
  }

  function send(message: string, opts: { skipChat?: boolean } = {}): boolean {
    if (!alive || !proc) {
      spawn();
    }

    if (!alive || !proc) return false;

    turnState = {
      resultText: '',
      toolsUsed: 0,
      hasEdited: false,
      errorSent: false,
      startTime: Date.now(),
      skipChat: opts.skipChat || false,
      lastStdoutTime: Date.now(),
      pendingTools: new Map(),
    };

    const jsonl = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: message }] },
    }) + '\n';

    try {
      proc.stdin.write(jsonl);
      proc.stdin.flush();
      lastActivity = Date.now();

      // Start silence monitoring
      if (silenceInterval) clearInterval(silenceInterval);
      silenceInterval = setInterval(() => {
        if (!turnState) {
          if (silenceInterval) clearInterval(silenceInterval);
          silenceInterval = null;
          return;
        }
        const silentFor = Date.now() - turnState.lastStdoutTime;
        const elapsed = Math.round((Date.now() - turnState.startTime) / 1000);

        if (silentFor >= SILENCE_HARD) {
          console.error(`[Bridge] No stdout for ${silentFor / 1000}s — killing bridge`);
          kill();
          return;
        }

        const overrides = silentFor >= SILENCE_WARN
          ? { stage: `No activity for ${Math.round(silentFor / 1000)}s — click Cancel to retry` }
          : silentFor >= SILENCE_SOFT
          ? { stage: 'Waiting for response...' }
          : {};

        onEvent({ type: 'progress', ...calcProgress(turnState!), ...overrides, elapsed });
      }, 1000);

      return true;
    } catch {
      return false;
    }
  }

  function cancel(): void {
    if (proc && alive) {
      proc.kill('SIGTERM');
    }
    if (turnState) {
      onEvent({ type: 'cancelled' });
      turnState = null;
    }
    if (silenceInterval) {
      clearInterval(silenceInterval);
      silenceInterval = null;
    }
  }

  function kill(): void {
    if (proc && alive) {
      proc.kill('SIGTERM');
      // Force kill after 5s
      setTimeout(() => {
        if (proc && alive) proc.kill('SIGKILL');
      }, 5000);
    }
    alive = false;
    if (turnState) {
      onEvent({ type: 'error', message: 'Claude stopped responding. Try again.' });
      turnState = null;
      releaseLock();
    }
    if (silenceInterval) {
      clearInterval(silenceInterval);
      silenceInterval = null;
    }
  }

  return {
    send,
    cancel,
    kill,
    isAlive: () => alive,
  };
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
  projectRoot?: string,
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

  if (exitCode !== 0 && exitCode !== null) {
    const isMaxTurns = stderrBuffer.includes('max_turns') || stderrBuffer.includes('maxTurns');
    if (isMaxTurns) {
      console.log(`[OneShot] Hit max_turns (hasEdited=${hasEdited}) — treating as success`);
    } else if (!errorSent) {
      if (exitCode === null && killedByTimeout) {
        onEvent({ type: 'error', message: `Claude stopped responding after ${getElapsed()}s. Try again.` });
      } else {
        onEvent({ type: 'error', message: stderrBuffer.slice(0, 500) || `Claude exited with code ${exitCode}` });
      }
      return null;
    }
  }

  // Post-process
  if (hasEdited && projectRoot) {
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
