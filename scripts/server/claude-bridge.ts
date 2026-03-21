/**
 * Persistent bidirectional Claude bridge.
 *
 * Keeps a single Claude process alive with stdin open for multi-turn
 * conversation via stream-json input/output format.
 *
 * Also re-exports one-shot helpers and legacy symbols so existing
 * imports from this module continue to work.
 */

import { createStreamParser } from '../lib/stream-parser.js';
import { buildPersistentArgs, resolveClaudeBin, cleanEnv } from '../lib/claude-subprocess.js';
import { translateStreamEvent } from './event-translator.ts';

// --- Types ---

export type BridgeState = 'idle' | 'streaming' | 'interrupted' | 'dead';
export type EventCallback = (event: any) => void;

export interface PersistentBridge {
  state: BridgeState;
  sendMessage(prompt: string): void;
  interrupt(): void;
  reset(): void;
  kill(): void;
  onEvent: EventCallback | null;
  readonly appDir: string | null;
  readonly eventLog: readonly SequencedEvent[];
}

export interface SequencedEvent {
  seq: number;
  event: any;
}

// --- Ring Buffer ---

const RING_BUFFER_MAX = 1000;

class RingBuffer<T> {
  private items: T[] = [];
  private _maxSize: number;

  constructor(maxSize: number = RING_BUFFER_MAX) {
    this._maxSize = maxSize;
  }

  push(item: T): void {
    if (this.items.length >= this._maxSize) {
      this.items.shift();
    }
    this.items.push(item);
  }

  toArray(): readonly T[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }
}

// --- State Machine ---

/**
 * Pure state machine for bridge lifecycle.
 * Returns the new state given a current state and action, or null if the
 * transition is invalid.
 */
export type BridgeAction =
  | 'send_message'
  | 'result_received'
  | 'interrupt'
  | 'process_exit'
  | 'kill'
  | 'reset';

export function nextState(current: BridgeState, action: BridgeAction): BridgeState | null {
  switch (action) {
    case 'send_message':
      // idle or dead can start streaming (dead triggers respawn)
      if (current === 'idle' || current === 'dead') return 'streaming';
      return null;

    case 'result_received':
      if (current === 'streaming') return 'idle';
      return null;

    case 'interrupt':
      if (current === 'streaming') return 'interrupted';
      return null;

    case 'process_exit':
      // Unexpected exit from streaming = dead
      if (current === 'streaming') return 'dead';
      // Exit while interrupted = back to idle (expected after SIGINT)
      if (current === 'interrupted') return 'idle';
      return null;

    case 'kill':
      if (current === 'idle' || current === 'streaming' || current === 'interrupted') return 'dead';
      return null;

    case 'reset':
      if (current === 'idle' || current === 'streaming' || current === 'interrupted') return 'dead';
      return null;

    default:
      return null;
  }
}

// --- Persistent Bridge ---

export function createBridge(appDir: string, onEvent: EventCallback): PersistentBridge {
  let state: BridgeState = 'idle';
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let seq = 0;
  const eventLog = new RingBuffer<SequencedEvent>(RING_BUFFER_MAX);

  function transition(action: BridgeAction): boolean {
    const next = nextState(state, action);
    if (next === null) {
      console.warn(`[Bridge] Invalid transition: ${state} + ${action}`);
      return false;
    }
    console.log(`[Bridge] ${state} -> ${next} (${action})`);
    state = next;
    return true;
  }

  function emitEvent(event: any): void {
    const seqEvent: SequencedEvent = { seq: ++seq, event };
    eventLog.push(seqEvent);
    try {
      bridge.onEvent?.(event);
    } catch (err) {
      console.error('[Bridge] onEvent callback error:', err);
    }
  }

  function spawn(): void {
    const args = buildPersistentArgs({});
    const claudeBin = resolveClaudeBin();
    console.log(`[Bridge] Spawning persistent process (bin: ${claudeBin}, cwd: ${appDir})`);
    console.log(`[Bridge] Args: ${args.join(' ')}`);

    proc = Bun.spawn({
      cmd: [claudeBin, ...args],
      cwd: appDir,
      env: cleanEnv(),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    console.log(`[Bridge] PID ${proc.pid} spawned`);

    // Read stderr in background
    readStderr(proc);

    // Read stdout continuously via stream parser
    readStdout(proc);

    // Monitor for unexpected exit
    monitorExit(proc);
  }

  function readStderr(p: NonNullable<typeof proc>): void {
    (async () => {
      const reader = p.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          console.log(`[Bridge] PID ${p.pid} STDERR: ${chunk.slice(0, 500)}`);
        }
      } catch (e) {
        console.log(`[Bridge] PID ${p.pid} stderr reader error: ${e}`);
      }
    })();
  }

  function readStdout(p: NonNullable<typeof proc>): void {
    const parse = createStreamParser((rawEvent: any) => {
      // Translate raw stream-json event into UI-facing messages
      const translated = translateStreamEvent(rawEvent);
      for (const msg of translated) {
        emitEvent(msg);
      }

      // Detect result event to transition back to idle
      if (rawEvent.type === 'result') {
        transition('result_received');
      }
    });

    (async () => {
      const reader = p.stdout.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parse(value);
        }
      } catch (e) {
        console.log(`[Bridge] PID ${p.pid} stdout reader error: ${e}`);
      }
    })();
  }

  function monitorExit(p: NonNullable<typeof proc>): void {
    p.exited.then((exitCode) => {
      console.log(`[Bridge] PID ${p.pid} exited with code ${exitCode}`);
      // Only handle exit if this is still the active process
      if (proc !== p) return;
      proc = null;

      if (state === 'streaming') {
        transition('process_exit');
        emitEvent({
          type: 'error',
          message: `Claude process exited unexpectedly (code ${exitCode})`,
        });
      } else if (state === 'interrupted') {
        // Expected exit after SIGINT — transition to idle
        transition('process_exit');
      }
      // If state is already 'dead' (from kill/reset), nothing to do
    });
  }

  function killProc(): void {
    if (!proc) return;
    const p = proc;
    proc = null;
    try { p.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 5000);
  }

  const bridge: PersistentBridge = {
    get state() { return state; },
    get appDir() { return appDir; },
    get eventLog() { return eventLog.toArray(); },

    onEvent: onEvent,

    sendMessage(prompt: string): void {
      // Auto-respawn if dead
      if (state === 'dead' || (state === 'idle' && !proc)) {
        if (state === 'dead') {
          // Reset state to idle for the transition
          state = 'idle';
        }
        spawn();
      }

      if (!transition('send_message')) return;

      if (!proc) {
        console.error('[Bridge] No process after spawn — cannot send message');
        state = 'dead';
        emitEvent({ type: 'error', message: 'Failed to spawn Claude process' });
        return;
      }

      const stdinMsg = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: prompt },
      });
      try {
        proc.stdin.write(stdinMsg + '\n');
      } catch (err) {
        console.error('[Bridge] stdin write error:', err);
        state = 'dead';
        emitEvent({ type: 'error', message: 'Failed to write to Claude process' });
      }
    },

    interrupt(): void {
      if (!transition('interrupt')) return;
      if (proc) {
        try { proc.kill('SIGINT'); } catch {}
      }
      // After SIGINT, the process should send a result event or exit.
      // If it exits, monitorExit transitions interrupted -> idle.
      // Give it a moment, then force-transition to idle if still interrupted.
      setTimeout(() => {
        if (state === 'interrupted') {
          console.log('[Bridge] Force-transitioning interrupted -> idle after timeout');
          state = 'idle';
        }
      }, 5000);
    },

    reset(): void {
      transition('reset');
      killProc();
      eventLog.clear();
      seq = 0;
    },

    kill(): void {
      transition('kill');
      killProc();
    },
  };

  return bridge;
}

// --- Operation Lock (kept for backward compatibility) ---

interface OperationLock {
  type: 'chat' | 'generate' | 'theme' | 'create-theme';
  cancel: () => void;
}

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

// --- Progress calculation (kept for one-shot operations) ---

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

// --- One-Shot Helper (kept for generate/theme/create-theme) ---

import { buildClaudeArgs } from '../lib/claude-subprocess.js';
import { sanitizeAppJsx } from './post-process.ts';

function summarizeInput(block: any): string {
  const toolName = block.name || '';
  const input = block.input || {};
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') return input.file_path || '';
  if (toolName === 'Glob') return input.pattern || '';
  if (toolName === 'Grep') return input.pattern || '';
  if (toolName === 'Bash') return (input.command || '').slice(0, 80);
  return '';
}

export interface OneShotOpts {
  maxTurns?: number;
  model?: string;
  tools?: string;
  cwd?: string;
  skipChat?: boolean;
  permissionMode?: string;
  /** Operation type for the lock (default: 'chat'). Set to false to skip auto-locking. */
  lockType?: string | false;
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

  const claudeBin = resolveClaudeBin();
  const spawnCwd = opts.cwd || process.cwd();
  console.log(`[OneShot] Spawning (prompt: ${(prompt.length / 1024).toFixed(1)}KB, bin: ${claudeBin}, cwd: ${spawnCwd})...`);
  console.log(`[OneShot] Args: ${args.join(' ')}`);

  const proc = Bun.spawn({
    cmd: [claudeBin, ...args],
    cwd: spawnCwd,
    env: cleanEnv(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  console.log(`[OneShot] PID ${proc.pid} spawned`);
  proc.stdin.write(prompt);
  proc.stdin.end();
  console.log(`[OneShot] PID ${proc.pid} stdin written and closed`);

  // Auto-acquire operation lock so cancelCurrent() can kill this subprocess.
  const useLock = opts.lockType !== false;
  if (useLock) {
    const lockType = (typeof opts.lockType === 'string' ? opts.lockType : 'chat');
    acquireLock(lockType, () => {
      console.log(`[OneShot] Cancel requested — killing PID ${proc.pid}`);
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
        const chunk = decoder.decode(value, { stream: true });
        stderrBuffer += chunk;
        console.log(`[OneShot] PID ${proc.pid} STDERR (${getElapsed()}s): ${chunk.slice(0, 500)}`);
      }
    } catch (e) {
      console.log(`[OneShot] PID ${proc.pid} stderr reader error: ${e}`);
    }
    console.log(`[OneShot] PID ${proc.pid} stderr stream ended (${getElapsed()}s)`);
  })();

  // Silence timeout
  const SILENCE_HARD = 600_000;
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
      ? { stage: 'Still working — complex apps take a moment to craft' }
      : silentFor >= 45_000
      ? { stage: 'Thinking hard about this one...' }
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
  let stdoutChunks = 0;
  let stdoutBytes = 0;
  console.log(`[OneShot] PID ${proc.pid} reading stdout...`);
  try {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) {
        console.log(`[OneShot] PID ${proc.pid} stdout DONE (${getElapsed()}s, ${stdoutChunks} chunks, ${stdoutBytes} bytes)`);
        break;
      }
      stdoutChunks++;
      stdoutBytes += value.length;
      if (stdoutChunks <= 3 || stdoutChunks % 50 === 0) {
        const preview = new TextDecoder().decode(value).slice(0, 200);
        console.log(`[OneShot] PID ${proc.pid} stdout chunk #${stdoutChunks} (${value.length}B, ${getElapsed()}s): ${preview}`);
      }
      lastStdoutTime = Date.now();
      parse(value);
    }
  } catch (e) {
    console.log(`[OneShot] PID ${proc.pid} stdout reader error (${getElapsed()}s): ${e}`);
  }

  clearInterval(silenceInterval);

  // Wait for process to exit
  const exitCode = await proc.exited;
  await stderrPromise;

  // Release the operation lock now that the subprocess has exited.
  if (useLock) releaseLock();

  console.log(`[OneShot] Completed in ${getElapsed()}s (${toolsUsed} tools, code ${exitCode})`);

  // SIGTERM exit: process was cancelled via cancelCurrent()
  if (exitCode === 143 || exitCode === 137) {
    console.log(`[OneShot] Process was cancelled (signal ${exitCode === 143 ? 'TERM' : 'KILL'})`);
    onEvent({ type: 'cancelled' });
    return null;
  }

  if (killedByTimeout && !errorSent) {
    onEvent({ type: 'error', message: `Claude stopped responding after ${getElapsed()}s. Try again.` });
    return null;
  }

  if (exitCode !== 0 && exitCode !== null) {
    const isMaxTurns = stderrBuffer.includes('max_turns') || stderrBuffer.includes('maxTurns');
    if (isMaxTurns) {
      console.log(`[OneShot] Hit max_turns (hasEdited=${hasEdited}) — treating as success`);
      resultText = (resultText || '') + '\n\n*[Ran out of turns — send another message to continue where I left off]*';
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

// --- Re-exports from legacy module ---

export { runBunScript } from './claude-bridge-legacy.ts';
