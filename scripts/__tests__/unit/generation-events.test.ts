/**
 * Verify that `dispatchStreamEvent` emits the right sequence of
 * generation_stage, tool_detail, tool_result, preview_reload, and
 * preview_reload_failed events given synthetic stream-json input.
 *
 * SCOPE: `dispatchStreamEvent` is the one-shot path's translator, called
 * from `runOneShot`. That path powers theme switching, factory-assemble,
 * and riff — NOT the editor generate / chat flow. The editor flow runs
 * through the persistent bridge (`createBridge` in claude-bridge.ts) and
 * its translator is `translateStreamEvent` in event-translator.ts. If
 * you're verifying editor-side staged-preview behavior, look at
 * event-translator.test.ts and bridge-turn-mode.test.ts, not this file.
 *
 * This exercises the pure dispatcher lifted out of `runOneShot` — no
 * subprocess spawning, no real stdout piping. A spy `onEvent` captures
 * emissions and stub helpers supply deterministic elapsed / progress.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createOneShotRunState,
  dispatchStreamEvent,
  type OneShotRunState,
  type DispatchHelpers,
} from '../../server/claude-bridge.ts';

// --- test harness --------------------------------------------------------

/** Captures every event emitted by the dispatcher. */
function makeSpy() {
  const events: any[] = [];
  const onEvent = (e: any) => events.push(e);
  return { events, onEvent };
}

/** Deterministic helpers — fixed elapsed, fixed progress. */
function stubHelpers(overrides: Partial<DispatchHelpers> = {}): DispatchHelpers {
  return {
    getElapsed: () => 1,
    calcProgress: (s: OneShotRunState) => {
      // Ratchet the floor the way the real helper does, so tests that look
      // at multiple progress events see non-decreasing values if they care.
      s.baseProgress = Math.max(s.baseProgress, 50);
      return { progress: s.baseProgress, stage: 'Reading & analyzing...' };
    },
    ...overrides,
  };
}

/** Build a synthetic assistant message with a single tool_use block. */
function assistantToolUse(opts: {
  name: string;
  id: string;
  filePath?: string;
  stop_reason?: string;
}) {
  return {
    type: 'assistant',
    message: {
      stop_reason: opts.stop_reason,
      content: [
        {
          type: 'tool_use',
          id: opts.id,
          name: opts.name,
          input: opts.filePath ? { file_path: opts.filePath } : {},
        },
      ],
    },
  };
}

/** Build a synthetic tool_result event. */
function toolResult(opts: { tool_use_id: string; tool_name: string; is_error?: boolean; content?: string }) {
  return {
    type: 'tool_result',
    tool_use_id: opts.tool_use_id,
    tool_name: opts.tool_name,
    content: opts.content ?? 'ok',
    is_error: !!opts.is_error,
  };
}

// --- fixtures for the real validator -------------------------------------

let tmpDir: string;
let validAppPath: string;
let brokenAppPath: string;
let nonAppPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'genevents-'));
  validAppPath = join(tmpDir, 'app.jsx');
  brokenAppPath = join(tmpDir, 'app.jsx'); // tests overwrite this when they want it broken
  nonAppPath = join(tmpDir, 'other.tsx');
  writeFileSync(validAppPath, 'export default function App() { return <div>ok</div>; }\n');
  writeFileSync(nonAppPath, 'export default function Other() { return <div>no-reload</div>; }\n');
});

// --- tests ---------------------------------------------------------------

describe('dispatchStreamEvent — non-reference happy path', () => {
  it('emits tool_detail + progress per Write/Edit and generation_stage only on the 2nd tool_use', () => {
    const state = createOneShotRunState({ initialStage: 'foundation' });
    const { events, onEvent } = makeSpy();
    const helpers = stubHelpers();

    // 1st Write — since initialStage is already 'foundation', toolUseSeen === 1
    // does NOT fire generation_stage (that's only for the reading_reference->foundation transition).
    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 't1', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(
      toolResult({ tool_use_id: 't1', tool_name: 'Write' }),
      state,
      onEvent,
      helpers,
    );

    // 2nd Edit — toolUseSeen === 2, fires generation_stage: interactions.
    dispatchStreamEvent(
      assistantToolUse({ name: 'Edit', id: 't2', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(
      toolResult({ tool_use_id: 't2', tool_name: 'Edit' }),
      state,
      onEvent,
      helpers,
    );

    dispatchStreamEvent({ type: 'result', is_error: false, result: 'All done.' }, state, onEvent, helpers);

    // Extract just the event type sequence for readability.
    const types = events.map((e) => e.type);

    // 1st Write: tool_detail, progress, tool_result, preview_reload
    // 2nd Edit: generation_stage (interactions), tool_detail, progress, tool_result, preview_reload
    expect(types).toEqual([
      'tool_detail',
      'progress',
      'tool_result',
      'preview_reload',
      'generation_stage',
      'tool_detail',
      'progress',
      'tool_result',
      'preview_reload',
    ]);

    // generation_stage fires ONCE, and its value is 'interactions'.
    const stageEvents = events.filter((e) => e.type === 'generation_stage');
    expect(stageEvents).toEqual([{ type: 'generation_stage', stage: 'interactions' }]);

    // State reflects the run.
    expect(state.toolsUsed).toBe(2);
    expect(state.hasEdited).toBe(true);
    expect(state.toolUseSeen).toBe(2);
    expect(state.currentStage).toBe('interactions');
    expect(state.resultText).toBe('All done.');
    expect(state.pendingTools.size).toBe(0);
  });
});

describe('dispatchStreamEvent — reference path happy path', () => {
  it('emits foundation on 1st Write, interactions on 2nd, and Read does not advance the stage', () => {
    const state = createOneShotRunState({ initialStage: 'reading_reference' });
    const { events, onEvent } = makeSpy();
    const helpers = stubHelpers();

    // A Read — should NOT advance the stage.
    dispatchStreamEvent(
      assistantToolUse({ name: 'Read', id: 'r1', filePath: '/some/reference.html' }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 'r1', tool_name: 'Read' }), state, onEvent, helpers);
    expect(state.currentStage).toBe('reading_reference');
    expect(state.toolUseSeen).toBe(0);

    // 1st Write — advances reading_reference -> foundation.
    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 't1', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 't1', tool_name: 'Write' }), state, onEvent, helpers);

    // 2nd Edit — advances to interactions.
    dispatchStreamEvent(
      assistantToolUse({ name: 'Edit', id: 't2', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 't2', tool_name: 'Edit' }), state, onEvent, helpers);

    dispatchStreamEvent({ type: 'result', is_error: false, result: 'Done.' }, state, onEvent, helpers);

    const stageEvents = events.filter((e) => e.type === 'generation_stage');
    expect(stageEvents).toEqual([
      { type: 'generation_stage', stage: 'foundation' },
      { type: 'generation_stage', stage: 'interactions' },
    ]);

    expect(state.currentStage).toBe('interactions');
    expect(state.toolUseSeen).toBe(2);
    // Read still counted in toolsUsed (all tool_use blocks do).
    expect(state.toolsUsed).toBe(3);
  });
});

describe('dispatchStreamEvent — preview_reload gating', () => {
  it('emits preview_reload only for successful Write/Edit to app.jsx', () => {
    const state = createOneShotRunState({ initialStage: 'foundation' });
    const { events, onEvent } = makeSpy();
    const helpers = stubHelpers();

    // (1) Write to app.jsx, success -> preview_reload
    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 'a1', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 'a1', tool_name: 'Write' }), state, onEvent, helpers);

    // (2) Write to a non-app file -> NO preview_reload
    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 'a2', filePath: nonAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 'a2', tool_name: 'Write' }), state, onEvent, helpers);

    // (3) Write to app.jsx with is_error: true on the tool_result -> NO preview_reload
    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 'a3', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(
      toolResult({ tool_use_id: 'a3', tool_name: 'Write', is_error: true, content: 'permission denied' }),
      state,
      onEvent,
      helpers,
    );

    const reloads = events.filter((e) => e.type === 'preview_reload');
    expect(reloads).toHaveLength(1);

    const failed = events.filter((e) => e.type === 'preview_reload_failed');
    expect(failed).toHaveLength(0);
  });
});

describe('dispatchStreamEvent — preview_reload_failed on broken JSX', () => {
  it('emits preview_reload_failed with the current stage when validateAppJsx fails', () => {
    const state = createOneShotRunState({ initialStage: 'foundation' });
    // After 1st Write, toolUseSeen becomes 1 (not 2), so currentStage stays 'foundation'.
    const { events, onEvent } = makeSpy();
    const helpers = stubHelpers();

    // Write broken JSX to the app path.
    writeFileSync(brokenAppPath, 'export default function App() { return <div>oops; }\n');

    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 'b1', filePath: brokenAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 'b1', tool_name: 'Write' }), state, onEvent, helpers);

    const reloads = events.filter((e) => e.type === 'preview_reload');
    const failed = events.filter((e) => e.type === 'preview_reload_failed');
    expect(reloads).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].stage).toBe('foundation');
    expect(typeof failed[0].error).toBe('string');
    expect(failed[0].error.length).toBeGreaterThan(0);
  });

  it('reports stage: interactions once the dispatcher has transitioned past foundation', () => {
    const state = createOneShotRunState({ initialStage: 'foundation' });
    const { events, onEvent } = makeSpy();
    const helpers = stubHelpers();

    // 1st Write (valid) — bumps toolUseSeen to 1.
    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 'i1', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 'i1', tool_name: 'Write' }), state, onEvent, helpers);

    // 2nd Edit — bumps toolUseSeen to 2, transitions state to 'interactions'.
    // Now overwrite the file with broken JSX so the tool_result's validator fails.
    writeFileSync(validAppPath, 'const broken = <div ');
    dispatchStreamEvent(
      assistantToolUse({ name: 'Edit', id: 'i2', filePath: validAppPath }),
      state,
      onEvent,
      helpers,
    );
    dispatchStreamEvent(toolResult({ tool_use_id: 'i2', tool_name: 'Edit' }), state, onEvent, helpers);

    const failed = events.filter((e) => e.type === 'preview_reload_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].stage).toBe('interactions');
  });
});

describe('dispatchStreamEvent — max_tokens detection', () => {
  it('sets state.hitMaxTokens when the assistant message stop_reason is max_tokens', () => {
    const state = createOneShotRunState({ initialStage: 'foundation' });
    const { onEvent } = makeSpy();
    const helpers = stubHelpers();

    expect(state.hitMaxTokens).toBe(false);

    dispatchStreamEvent(
      assistantToolUse({
        name: 'Write',
        id: 'mx1',
        filePath: validAppPath,
        stop_reason: 'max_tokens',
      }),
      state,
      onEvent,
      helpers,
    );

    expect(state.hitMaxTokens).toBe(true);
  });

  it('leaves hitMaxTokens false for non-max_tokens stop_reasons', () => {
    const state = createOneShotRunState({ initialStage: 'foundation' });
    const { onEvent } = makeSpy();
    const helpers = stubHelpers();

    dispatchStreamEvent(
      assistantToolUse({ name: 'Write', id: 'mx2', filePath: validAppPath, stop_reason: 'end_turn' }),
      state,
      onEvent,
      helpers,
    );

    expect(state.hitMaxTokens).toBe(false);
  });
});

// Ensure each temp dir is cleaned up so vitest's watch mode stays tidy.
// (Vitest re-invokes beforeEach per test; cleanup below runs after all of them.)
import { afterAll } from 'vitest';
afterAll(() => {
  // Best-effort; if a test already removed it, rmSync won't throw with force.
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
