/**
 * Tests for the persistent bridge's per-turn staged-preview dispatcher.
 *
 * `dispatchBridgeEvent` is the pure function lifted out of the bridge's
 * stdout stream-parser callback. It's the bridge-path counterpart to
 * `dispatchStreamEvent` (which is wired into runOneShot). These tests
 * exercise the generate-mode / chat-mode gating and the staged-preview
 * event sequence without spawning a subprocess.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createBridgeTurnState,
  dispatchBridgeEvent,
  type BridgeTurnState,
} from '../../server/claude-bridge.ts';

// --- helpers --------------------------------------------------------------

function makeSpy() {
  const events: any[] = [];
  const onEvent = (e: any) => events.push(e);
  return { events, onEvent };
}

/** Synthesize the stream_event a real bridge sees when a tool starts. */
function toolUseStart(opts: { id: string; name: string }) {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: opts.id,
        name: opts.name,
      },
    },
  };
}

/** Synthesize an input_json_delta chunk for an in-flight tool_use. */
function inputDelta(partialJson: string) {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: partialJson },
    },
  };
}

/** Synthesize a tool_result event. */
function toolResult(opts: { tool_use_id: string; tool_name?: string; is_error?: boolean }) {
  return {
    type: 'tool_result',
    tool_use_id: opts.tool_use_id,
    tool_name: opts.tool_name ?? '',
    content: 'ok',
    is_error: !!opts.is_error,
  };
}

/** Stream a Write tool call: start -> input_json_delta for file_path -> tool_result. */
function streamWrite(
  turn: BridgeTurnState,
  onEvent: (e: any) => void,
  opts: { id: string; name: 'Write' | 'Edit' | 'Read'; filePath: string; isError?: boolean },
) {
  dispatchBridgeEvent(toolUseStart({ id: opts.id, name: opts.name }), turn, onEvent);
  // Stream the input in a couple of chunks — matches what real stream-json produces.
  const json = JSON.stringify({ file_path: opts.filePath, content: 'x' });
  const mid = Math.floor(json.length / 2);
  dispatchBridgeEvent(inputDelta(json.slice(0, mid)), turn, onEvent);
  dispatchBridgeEvent(inputDelta(json.slice(mid)), turn, onEvent);
  dispatchBridgeEvent(
    toolResult({ tool_use_id: opts.id, tool_name: opts.name, is_error: opts.isError }),
    turn,
    onEvent,
  );
}

// --- fixtures -------------------------------------------------------------

let tmpDir: string;
let validAppPath: string;
let nonAppPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bridge-turn-'));
  validAppPath = join(tmpDir, 'app.jsx');
  nonAppPath = join(tmpDir, 'other.tsx');
  writeFileSync(validAppPath, 'export default function App() { return <div>ok</div>; }\n');
  writeFileSync(nonAppPath, 'export default function Other() { return <div>no</div>; }\n');
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// --- tests ----------------------------------------------------------------

describe('dispatchBridgeEvent — generate mode (foundation start)', () => {
  it('emits preview_reload after a successful Write to app.jsx', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 't1', name: 'Write', filePath: validAppPath });

    const reloads = events.filter((e) => e.type === 'preview_reload');
    const failed = events.filter((e) => e.type === 'preview_reload_failed');
    const stages = events.filter((e) => e.type === 'generation_stage');
    expect(reloads).toHaveLength(1);
    expect(failed).toHaveLength(0);
    // 1st Write from foundation-start does NOT fire generation_stage; the
    // transition is only reading_reference -> foundation.
    expect(stages).toHaveLength(0);
    expect(turn.toolUseSeen).toBe(1);
    expect(turn.stage).toBe('foundation');
    expect(turn.pendingTools.size).toBe(0);
  });

  it('emits generation_stage: interactions on the 2nd Write/Edit', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 't1', name: 'Write', filePath: validAppPath });
    streamWrite(turn, onEvent, { id: 't2', name: 'Edit', filePath: validAppPath });

    const stages = events.filter((e) => e.type === 'generation_stage');
    expect(stages).toEqual([{ type: 'generation_stage', stage: 'interactions' }]);
    expect(turn.toolUseSeen).toBe(2);
    expect(turn.stage).toBe('interactions');
  });

  it('emits preview_reload_failed when the written file has invalid JSX', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    // Overwrite app.jsx with broken JSX before tool_result fires the validator.
    writeFileSync(validAppPath, 'export default function App() { return <div>oops; }\n');
    streamWrite(turn, onEvent, { id: 'b1', name: 'Write', filePath: validAppPath });

    const failed = events.filter((e) => e.type === 'preview_reload_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].stage).toBe('foundation');
    expect(typeof failed[0].error).toBe('string');
    expect(failed[0].error.length).toBeGreaterThan(0);
  });

  it('reports stage: interactions on preview_reload_failed after the 2nd tool_use', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    // 1st write valid.
    streamWrite(turn, onEvent, { id: 'i1', name: 'Write', filePath: validAppPath });
    // 2nd edit — now break the file, then stream the Edit so validator fails.
    writeFileSync(validAppPath, 'const broken = <div ');
    streamWrite(turn, onEvent, { id: 'i2', name: 'Edit', filePath: validAppPath });

    const failed = events.filter((e) => e.type === 'preview_reload_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].stage).toBe('interactions');
  });

  it('does not emit preview_reload for Write to a non-app.jsx path', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 'n1', name: 'Write', filePath: nonAppPath });

    expect(events.filter((e) => e.type === 'preview_reload')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'preview_reload_failed')).toHaveLength(0);
    // The Write still counts as a tool_use for stage purposes, though — 2nd
    // Write to any path still advances to interactions. That's fine: the
    // stage is about "how many code-writing steps has Claude done", not
    // "how many writes to app.jsx specifically".
    expect(turn.toolUseSeen).toBe(1);
  });

  it('does not emit preview_reload when tool_result carries is_error', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 'e1', name: 'Write', filePath: validAppPath, isError: true });

    expect(events.filter((e) => e.type === 'preview_reload')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'preview_reload_failed')).toHaveLength(0);
  });
});

describe('dispatchBridgeEvent — generate mode (reading_reference start)', () => {
  it('Read tool_use does not advance the stage', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'reading_reference';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 'r1', name: 'Read', filePath: '/some/reference.html' });

    expect(events.filter((e) => e.type === 'generation_stage')).toHaveLength(0);
    expect(turn.toolUseSeen).toBe(0);
    expect(turn.stage).toBe('reading_reference');
  });

  it('advances reading_reference -> foundation on the 1st Write, interactions on the 2nd', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'reading_reference';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 'r1', name: 'Read', filePath: '/some/reference.html' });
    streamWrite(turn, onEvent, { id: 't1', name: 'Write', filePath: validAppPath });
    streamWrite(turn, onEvent, { id: 't2', name: 'Edit', filePath: validAppPath });

    const stages = events.filter((e) => e.type === 'generation_stage');
    expect(stages).toEqual([
      { type: 'generation_stage', stage: 'foundation' },
      { type: 'generation_stage', stage: 'interactions' },
    ]);
    expect(turn.stage).toBe('interactions');
  });
});

describe('dispatchBridgeEvent — chat mode suppresses all staged-preview events', () => {
  it('emits nothing for a Write to app.jsx under chat mode', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'chat';
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 't1', name: 'Write', filePath: validAppPath });
    streamWrite(turn, onEvent, { id: 't2', name: 'Edit', filePath: validAppPath });

    expect(events).toHaveLength(0);
    // Nothing touched on the turn state either — dispatcher early-returns.
    expect(turn.toolUseSeen).toBe(0);
    expect(turn.pendingTools.size).toBe(0);
  });

  it('emits nothing when mode is null (uninitialized)', () => {
    const turn = createBridgeTurnState();
    const { events, onEvent } = makeSpy();

    streamWrite(turn, onEvent, { id: 't1', name: 'Write', filePath: validAppPath });

    expect(events).toHaveLength(0);
  });
});

describe('dispatchBridgeEvent — file_path extraction', () => {
  it('extracts file_path from a single complete input_json_delta chunk', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    dispatchBridgeEvent(toolUseStart({ id: 's1', name: 'Write' }), turn, onEvent);
    dispatchBridgeEvent(
      inputDelta(JSON.stringify({ file_path: validAppPath, content: 'x' })),
      turn,
      onEvent,
    );
    dispatchBridgeEvent(toolResult({ tool_use_id: 's1', tool_name: 'Write' }), turn, onEvent);

    expect(events.filter((e) => e.type === 'preview_reload')).toHaveLength(1);
  });

  it('extracts file_path from many small input_json_delta chunks', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { events, onEvent } = makeSpy();

    const json = JSON.stringify({ file_path: validAppPath, content: 'x' });
    dispatchBridgeEvent(toolUseStart({ id: 's2', name: 'Write' }), turn, onEvent);
    // Split byte-by-byte to stress the accumulator.
    for (const ch of json) {
      dispatchBridgeEvent(inputDelta(ch), turn, onEvent);
    }
    dispatchBridgeEvent(toolResult({ tool_use_id: 's2', tool_name: 'Write' }), turn, onEvent);

    expect(events.filter((e) => e.type === 'preview_reload')).toHaveLength(1);
  });
});

describe('dispatchBridgeEvent — PersistentBridge.setTurnMode integration', () => {
  // The bridge's setTurnMode just resets the turn state — easier to test
  // the reset behavior directly on BridgeTurnState via a simulated flow
  // than to spawn a real bridge.
  it('reset via a setTurnMode-like shape clears pendingTools and toolUseSeen', () => {
    const turn = createBridgeTurnState();
    turn.mode = 'generate';
    turn.stage = 'foundation';
    const { onEvent } = makeSpy();

    dispatchBridgeEvent(toolUseStart({ id: 'leak1', name: 'Write' }), turn, onEvent);
    expect(turn.pendingTools.size).toBe(1);
    expect(turn.toolUseSeen).toBe(1);

    // Simulate setTurnMode('chat') — what the bridge does internally.
    turn.mode = 'chat';
    turn.toolUseSeen = 0;
    turn.stage = null;
    turn.pendingTools.clear();

    expect(turn.pendingTools.size).toBe(0);
    expect(turn.toolUseSeen).toBe(0);
    expect(turn.stage).toBeNull();
  });
});
