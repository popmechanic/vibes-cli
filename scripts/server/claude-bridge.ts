/**
 * Persistent bidirectional Claude bridge.
 *
 * Keeps a single Claude process alive with stdin open for multi-turn
 * conversation via stream-json input/output format.
 *
 * Also re-exports one-shot helpers and legacy symbols so existing
 * imports from this module continue to work.
 */

import { basename } from 'path';
import { createStreamParser } from '../lib/stream-parser.js';
import { buildPersistentArgs, resolveClaudeBin, cleanEnv } from '../lib/claude-subprocess.js';
import { createStreamTranslator } from './event-translator.ts';
import { validateAppJsx } from '../lib/validate-app-jsx.ts';

// --- Types ---

export type BridgeState = 'idle' | 'streaming' | 'interrupted' | 'dead';
export type EventCallback = (event: any) => void;
export type TurnMode = 'generate' | 'chat' | null;
export type GenerationStage = 'reading_reference' | 'foundation' | 'interactions';

export interface PersistentBridge {
  state: BridgeState;
  sendMessage(prompt: string): void;
  interrupt(): void;
  reset(): void;
  kill(): void;
  /**
   * Configure the per-turn mode used by the stream parser to decide whether
   * to emit generate-specific events (generation_stage, preview_reload,
   * preview_reload_failed). Must be called before each `sendMessage` on a
   * reused bridge, since a single bridge carries chat and generate turns
   * across its lifetime.
   *
   * - `'generate'` with `initialStage` — emit the full staged-preview
   *   sequence. `initialStage` is typically 'reading_reference' for
   *   reference-path generate and 'foundation' otherwise.
   * - `'chat'` — suppress all generate-mode emissions.
   * - `null` — explicitly clear turn state (rarely needed).
   */
  setTurnMode(mode: TurnMode, initialStage?: GenerationStage): void;
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

// --- Turn State (generate vs chat mode) ---

/**
 * Mutable per-turn state the bridge dispatcher uses to decide when to emit
 * generate-specific staged-preview events. A single bridge instance is
 * reused across many user turns, so this is reset by `setTurnMode`.
 */
export interface BridgeTurnState {
  mode: TurnMode;
  /** Count of Write/Edit tool_use events seen this turn. Drives the
   * generation_stage transition (reading_reference -> foundation, then
   * foundation -> interactions on the 2nd Write/Edit). */
  toolUseSeen: number;
  stage: GenerationStage | null;
  /**
   * Map of tool_use_id -> accumulated input JSON buffer. The bridge receives
   * tool_use via `content_block_start` (which has the tool name but no
   * completed input) and then streams `input_json_delta` chunks. When the
   * corresponding `tool_result` arrives we parse the buffered JSON to
   * extract `file_path`. Also tracks the tool name so we can filter to
   * Write/Edit on tool_result.
   */
  pendingTools: Map<string, { name: string; inputJsonBuf: string }>;
}

export function createBridgeTurnState(): BridgeTurnState {
  return {
    mode: null,
    toolUseSeen: 0,
    stage: null,
    pendingTools: new Map(),
  };
}

/**
 * Helpers the bridge dispatcher needs — injected so tests can provide
 * deterministic stubs (e.g. a stubbed `validateAppJsx`).
 */
export interface BridgeDispatchHelpers {
  validateAppJsx?: (path: string) => { ok: true } | { ok: false; error: string };
}

/**
 * Attempt to extract `file_path` from a buffered input_json_delta stream.
 * The buffer may be a complete JSON object, a partial object, or empty —
 * we prefer JSON.parse for safety and fall back to a targeted regex so a
 * still-streaming buffer can still yield the file_path field.
 */
function extractFilePath(inputJsonBuf: string): string {
  if (!inputJsonBuf) return '';
  try {
    const parsed = JSON.parse(inputJsonBuf);
    if (parsed && typeof parsed.file_path === 'string') return parsed.file_path;
  } catch {
    // Fall through to regex.
  }
  // Grab "file_path": "..." even from a partial/malformed stream.
  const m = inputJsonBuf.match(/"file_path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1];
    }
  }
  return '';
}

/**
 * Consume one parsed stream-json event for the persistent bridge. Mutates
 * `turn` in place and emits staged-preview events via `onEvent`, but only
 * when `turn.mode === 'generate'`. Chat turns pass through untouched.
 *
 * This is the bridge-path mirror of `dispatchStreamEvent` (which powers
 * `runOneShot`). Extracted as a pure function so it can be unit-tested
 * without spawning the Claude subprocess.
 */
export function dispatchBridgeEvent(
  rawEvent: any,
  turn: BridgeTurnState,
  onEvent: EventCallback,
  helpers: BridgeDispatchHelpers = {},
): void {
  if (turn.mode !== 'generate') return;
  const validate = helpers.validateAppJsx ?? validateAppJsx;

  // Track tool_use starts — `content_block_start` with content_block.type === 'tool_use'.
  if (rawEvent.type === 'stream_event' && rawEvent.event) {
    const inner = rawEvent.event;

    if (
      inner.type === 'content_block_start' &&
      inner.content_block?.type === 'tool_use' &&
      typeof inner.content_block.id === 'string'
    ) {
      const toolName: string = inner.content_block.name || '';
      turn.pendingTools.set(inner.content_block.id, { name: toolName, inputJsonBuf: '' });

      if (toolName === 'Write' || toolName === 'Edit') {
        turn.toolUseSeen++;
        if (turn.toolUseSeen === 1 && turn.stage === 'reading_reference') {
          turn.stage = 'foundation';
          onEvent({ type: 'generation_stage', stage: 'foundation' });
        } else if (turn.toolUseSeen === 2) {
          turn.stage = 'interactions';
          onEvent({ type: 'generation_stage', stage: 'interactions' });
        }
      }
      return;
    }

    // Accumulate input_json_delta chunks per tool_use_id. The content_block
    // lives inside a parent block whose index we don't track explicitly —
    // stream-json sends one tool_use per streaming section, so we use the
    // most recent one that's still open. In practice the inner event carries
    // the `index` matching content_block_start, and we map index back to id
    // via the insertion order of pendingTools.
    if (inner.type === 'content_block_delta' && inner.delta?.type === 'input_json_delta') {
      // Find the most-recent pending tool (the one still streaming input).
      // Tool use input deltas arrive in-order for the currently-open block,
      // and at most one content block is streaming input at a time in
      // practice, so taking the last-inserted pending entry is correct.
      const entries = Array.from(turn.pendingTools.entries());
      const last = entries[entries.length - 1];
      if (last) {
        last[1].inputJsonBuf += inner.delta.partial_json || '';
      }
      return;
    }
    return;
  }

  // tool_result: look up the pending tool, maybe emit preview_reload.
  if (rawEvent.type === 'tool_result') {
    const toolUseId = rawEvent.tool_use_id;
    if (!toolUseId) return;
    const pending = turn.pendingTools.get(toolUseId);
    if (!pending) return;
    turn.pendingTools.delete(toolUseId);

    const isWriteOrEdit = pending.name === 'Write' || pending.name === 'Edit';
    if (!isWriteOrEdit) return;
    if (rawEvent.is_error) return;

    const filePath = extractFilePath(pending.inputJsonBuf);
    if (!filePath) return;
    if (basename(filePath) !== 'app.jsx') return;

    const v = validate(filePath);
    if (v.ok) {
      onEvent({ type: 'preview_reload' });
    } else {
      onEvent({
        type: 'preview_reload_failed',
        stage: turn.stage === 'interactions' ? 'interactions' : 'foundation',
        error: v.error,
      });
    }
  }
}

// --- Persistent Bridge ---

export function createBridge(appDir: string, onEvent: EventCallback, pluginRoot?: string): PersistentBridge {
  let state: BridgeState = 'idle';
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let seq = 0;
  const eventLog = new RingBuffer<SequencedEvent>(RING_BUFFER_MAX);
  const turn: BridgeTurnState = createBridgeTurnState();
  // Per-bridge stream translator — owns its own tool_input progress state
  // so it doesn't leak between turns or across concurrent tool_use calls.
  const translate = createStreamTranslator();

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
    const args = buildPersistentArgs({ pluginRoot });
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
      // Staged-preview events (only fire during generate turns)
      dispatchBridgeEvent(rawEvent, turn, emitEvent);

      // Translate raw stream-json event into UI-facing messages.
      // Each bridge instance uses its own translator so per-turn progress
      // state doesn't leak between turns.
      const translated = translate(rawEvent);
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
      // If SIGINT was ignored, the old code only flipped state to idle —
      // but proc was still alive and mid-turn, and the next sendMessage
      // would write to its stdin and interleave with the previous turn.
      // Now: also force-kill the process so the next sendMessage respawns
      // cleanly via the `state === 'idle' && !proc` branch.
      setTimeout(() => {
        if (state === 'interrupted') {
          console.log('[Bridge] SIGINT did not land within 5s — force-killing process');
          killProc();
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

    setTurnMode(mode: TurnMode, initialStage?: GenerationStage): void {
      turn.mode = mode;
      turn.toolUseSeen = 0;
      turn.stage = initialStage ?? null;
      turn.pendingTools.clear();
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
  /** Initial generation_stage, used by the tool_use counter to decide when
   * to emit the foundation → interactions transition. Only passed by the
   * generate handler; chat/theme paths leave it undefined. */
  initialStage?: 'reading_reference' | 'foundation';
}

// --- One-Shot Dispatch (extracted for testability) ---

/**
 * Mutable state accumulated across stream events in a single runOneShot call.
 * Every field the dispatcher reads or writes lives here — the dispatcher
 * closes over NO locals, so it's fully unit-testable with a synthetic state
 * object and a spy onEvent callback.
 */
export interface OneShotRunState {
  toolsUsed: number;
  hasEdited: boolean;
  hitMaxTokens: boolean;
  /** Count of Write/Edit tool_use events. Drives generation_stage transitions. */
  toolUseSeen: number;
  currentStage: 'reading_reference' | 'foundation' | 'interactions' | null;
  resultText: string;
  errorSent: boolean;
  /** tool_use_id -> {name, filePath}. Populated on tool_use, consumed on tool_result. */
  pendingTools: Map<string, { name: string; filePath: string }>;
  /** Monotonic floor for progress %. `calcProgress` ratchets this so progress
   * never rewinds within a run. */
  baseProgress: number;
}

export function createOneShotRunState(opts: { initialStage?: 'reading_reference' | 'foundation' } = {}): OneShotRunState {
  return {
    toolsUsed: 0,
    hasEdited: false,
    hitMaxTokens: false,
    toolUseSeen: 0,
    currentStage: opts.initialStage ?? null,
    resultText: '',
    errorSent: false,
    pendingTools: new Map(),
    baseProgress: 0,
  };
}

/**
 * Wall-clock and validator hooks the dispatcher needs. Injected so tests can
 * supply deterministic stubs (fixed elapsed, fixed progress, stubbed
 * validateAppJsx).
 */
export interface DispatchHelpers {
  getElapsed: () => number;
  /** Should return the current { progress, stage }. Implementations are
   * expected to ratchet state.baseProgress so progress never decreases. */
  calcProgress: (state: OneShotRunState) => { progress: number; stage: string };
  /** Parse-check a file. Returns { ok: true } on success, { ok: false, error }
   * on failure. Defaults to the real `validateAppJsx` — tests pass a stub. */
  validateAppJsx?: (path: string) => { ok: true } | { ok: false; error: string };
  /** PID for diagnostic logging only (max_tokens warning). Optional — tests
   * can omit it; runOneShot supplies the real subprocess pid. */
  processPid?: number;
}

/**
 * Consume one parsed stream-json event. Mutates `state` in place and emits
 * UI events via `onEvent`. This is the inner body of runOneShot's stream
 * parser callback, lifted out so it can be exercised by unit tests without
 * spawning a subprocess.
 *
 * Behavior is identical to the pre-refactor inline callback — every read and
 * write goes through `state.*` instead of closure locals, and wall-clock /
 * validator access happens via `helpers`.
 */
export function dispatchStreamEvent(
  event: any,
  state: OneShotRunState,
  onEvent: EventCallback,
  helpers: DispatchHelpers,
): void {
  const elapsed = helpers.getElapsed();
  const validate = helpers.validateAppJsx ?? validateAppJsx;

  if (event.type === 'assistant' && event.message?.content) {
    if (event.message.stop_reason === 'max_tokens') {
      state.hitMaxTokens = true;
      const pidLabel = helpers.processPid != null ? ` PID ${helpers.processPid}` : '';
      console.warn(`[OneShot]${pidLabel} hit max_tokens at ${elapsed}s (tools=${state.toolsUsed}, hasEdited=${state.hasEdited})`);
    }
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        state.toolsUsed++;
        const toolName = block.name || '';
        if (toolName === 'Edit' || toolName === 'Write') state.hasEdited = true;
        const inputSummary = summarizeInput(block);

        if (block.id) {
          state.pendingTools.set(block.id, { name: toolName, filePath: inputSummary });
        }

        // Advance the generation stage on Write/Edit boundaries. Read tool
        // uses don't count — they're setup, not a step boundary.
        if (toolName === 'Write' || toolName === 'Edit') {
          state.toolUseSeen++;
          if (state.toolUseSeen === 1 && state.currentStage === 'reading_reference') {
            state.currentStage = 'foundation';
            onEvent({ type: 'generation_stage', stage: 'foundation' });
          } else if (state.toolUseSeen === 2) {
            state.currentStage = 'interactions';
            onEvent({ type: 'generation_stage', stage: 'interactions' });
          }
        }

        onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
        onEvent({ type: 'progress', ...helpers.calcProgress(state), elapsed });
      }
      if (block.type === 'text' && block.text) {
        state.resultText = block.text;
        onEvent({ type: 'token', text: block.text });
      }
    }
  } else if (event.type === 'stream_event' && event.event?.delta?.text) {
    onEvent({ type: 'token', text: event.event.delta.text });
  } else if (event.type === 'tool_result') {
    const toolDetail = event.tool_use_id ? state.pendingTools.get(event.tool_use_id) : undefined;
    if (event.tool_use_id) state.pendingTools.delete(event.tool_use_id);

    onEvent({
      type: 'tool_result',
      name: event.tool_name || '',
      content: (typeof event.content === 'string' ? event.content : JSON.stringify(event.content || '')).slice(0, 500),
      is_error: !!event.is_error,
      elapsed,
      _filePath: toolDetail?.filePath || '',
      _toolName: toolDetail?.name || event.tool_name || '',
    });

    // After a successful Write/Edit to app.jsx, parse-check the file. If it
    // parses, signal the UI to refresh the preview iframe. If it fails,
    // surface the error without reloading — the last-known-good render stays.
    const wasWriteOrEdit = toolDetail?.name === 'Write' || toolDetail?.name === 'Edit';
    const targetedAppJsx = typeof toolDetail?.filePath === 'string' && basename(toolDetail.filePath) === 'app.jsx';
    if (wasWriteOrEdit && targetedAppJsx && !event.is_error) {
      const v = validate(toolDetail!.filePath);
      if (v.ok) {
        onEvent({ type: 'preview_reload' });
      } else {
        onEvent({
          type: 'preview_reload_failed',
          stage: state.currentStage === 'interactions' ? 'interactions' : 'foundation',
          error: v.error,
        });
      }
    }
  } else if (event.type === 'result') {
    if (event.is_error) {
      const errMsg = event.result || 'Claude flagged the run as failed';
      console.error(`[OneShot] Result is_error: ${errMsg}`);
      onEvent({ type: 'error', message: errMsg });
      state.errorSent = true;
    } else {
      state.resultText = event.result || state.resultText || 'Done.';
    }
  } else if (event.type === 'rate_limit_event') {
    onEvent({ type: 'progress', ...helpers.calcProgress(state), stage: 'Rate limited, waiting...', elapsed });
  }
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
    pluginRoot: projectRoot,
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
  const runState = createOneShotRunState({ initialStage: opts.initialStage });
  const startTime = Date.now();
  let lastStdoutTime = Date.now();
  let killedByTimeout = false;

  function getElapsed() {
    return Math.round((Date.now() - startTime) / 1000);
  }

  function calcProgressLocal(state: OneShotRunState = runState): { progress: number; stage: string } {
    const result = calcProgressFromCounters(getElapsed(), state.toolsUsed, state.hasEdited, state.baseProgress);
    state.baseProgress = result.progress; // ratchet: progress never decreases in one-shot
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
    dispatchStreamEvent(event, runState, onEvent, {
      getElapsed,
      calcProgress: calcProgressLocal,
      processPid: proc.pid,
    });
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

  console.log(`[OneShot] Completed in ${getElapsed()}s (${runState.toolsUsed} tools, code ${exitCode})`);

  // SIGTERM exit: process was cancelled via cancelCurrent()
  if (exitCode === 143 || exitCode === 137) {
    console.log(`[OneShot] Process was cancelled (signal ${exitCode === 143 ? 'TERM' : 'KILL'})`);
    onEvent({ type: 'cancelled' });
    return null;
  }

  if (killedByTimeout && !runState.errorSent) {
    onEvent({ type: 'error', message: `Claude stopped responding after ${getElapsed()}s. Try again.` });
    return null;
  }

  if (exitCode !== 0 && exitCode !== null) {
    const isMaxTurns = stderrBuffer.includes('max_turns') || stderrBuffer.includes('maxTurns');
    if (isMaxTurns) {
      console.log(`[OneShot] Hit max_turns (hasEdited=${runState.hasEdited}) — treating as success`);
      runState.resultText = (runState.resultText || '') + '\n\n*[Ran out of turns — send another message to continue where I left off]*';
    } else if (!runState.errorSent) {
      onEvent({ type: 'error', message: stderrBuffer.slice(0, 500) || `Claude exited with code ${exitCode}` });
      return null;
    }
  }

  // max_tokens handling: if the assistant message was truncated at the output
  // ceiling, surface it. When !hasEdited, the file likely never got written —
  // treat as a hard error. When hasEdited, the file was written but trailing
  // content (explanatory text, follow-up edits) may be missing — warn but
  // continue so the user at least sees a working app.
  if (runState.hitMaxTokens && !runState.errorSent) {
    if (!runState.hasEdited) {
      onEvent({
        type: 'error',
        message: 'Claude hit the output token limit before writing the file. Try a simpler prompt, or raise CLAUDE_CODE_MAX_OUTPUT_TOKENS.',
      });
      runState.errorSent = true;
      return null;
    }
    console.warn(`[OneShot] max_tokens after file written — trailing content may be truncated`);
    runState.resultText = (runState.resultText || '') + '\n\n*[Output was truncated at the token limit — the app was written but some follow-up content may be missing.]*';
  }

  // Post-process
  if (runState.hasEdited) {
    sanitizeAppJsx(projectRoot);
  }

  let appJsxValid: boolean | undefined = undefined;
  if (runState.hasEdited && opts.cwd) {
    const appPath = `${opts.cwd}/app.jsx`;
    try {
      appJsxValid = validateAppJsx(appPath).ok;
    } catch {
      appJsxValid = false;
    }
  }

  if (!runState.errorSent) {
    onEvent({
      type: 'complete',
      text: runState.resultText || 'Done.',
      toolsUsed: runState.toolsUsed,
      elapsed: getElapsed(),
      hasEdited: runState.hasEdited,
      skipChat: opts.skipChat,
      maxTokensHit: runState.hitMaxTokens,
      appJsxValid,
    });
  }

  return runState.resultText || null;
}

// --- Re-exports from legacy module ---

export { runBunScript } from './claude-bridge-legacy.ts';
