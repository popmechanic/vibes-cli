/**
 * Tests for the persistent bridge state machine.
 *
 * Tests the pure `nextState()` function in isolation — no process
 * spawning, no I/O. This validates the state transition table.
 */
import { describe, it, expect } from 'vitest';
import { nextState, type BridgeState, type BridgeAction } from '../../server/claude-bridge.ts';

describe('bridge state machine', () => {
  it('starts in idle state (convention)', () => {
    // The bridge factory initializes state to 'idle'.
    // nextState itself is stateless — we just verify idle is a valid starting point.
    expect(nextState('idle', 'send_message')).toBe('streaming');
  });

  it('transitions idle -> streaming on send_message', () => {
    expect(nextState('idle', 'send_message')).toBe('streaming');
  });

  it('transitions streaming -> idle on result_received', () => {
    expect(nextState('streaming', 'result_received')).toBe('idle');
  });

  it('transitions streaming -> interrupted on interrupt', () => {
    expect(nextState('streaming', 'interrupt')).toBe('interrupted');
  });

  it('transitions streaming -> dead on unexpected process exit', () => {
    expect(nextState('streaming', 'process_exit')).toBe('dead');
  });

  it('transitions interrupted -> idle on process exit (expected after SIGINT)', () => {
    expect(nextState('interrupted', 'process_exit')).toBe('idle');
  });

  it('transitions dead -> streaming on send_message (auto-respawn)', () => {
    expect(nextState('dead', 'send_message')).toBe('streaming');
  });

  it('transitions idle -> dead on kill', () => {
    expect(nextState('idle', 'kill')).toBe('dead');
  });

  it('transitions streaming -> dead on kill', () => {
    expect(nextState('streaming', 'kill')).toBe('dead');
  });

  it('transitions interrupted -> dead on kill', () => {
    expect(nextState('interrupted', 'kill')).toBe('dead');
  });

  it('transitions idle -> dead on reset', () => {
    expect(nextState('idle', 'reset')).toBe('dead');
  });

  it('transitions streaming -> dead on reset', () => {
    expect(nextState('streaming', 'reset')).toBe('dead');
  });

  it('returns null for invalid transitions', () => {
    // Can't interrupt when idle
    expect(nextState('idle', 'interrupt')).toBeNull();
    // Can't receive result when idle
    expect(nextState('idle', 'result_received')).toBeNull();
    // Can't send message when already streaming
    expect(nextState('streaming', 'send_message')).toBeNull();
    // Can't kill when already dead
    expect(nextState('dead', 'kill')).toBeNull();
    // Can't reset when already dead
    expect(nextState('dead', 'reset')).toBeNull();
    // Can't receive result when dead
    expect(nextState('dead', 'result_received')).toBeNull();
  });

  it('supports full lifecycle: idle -> streaming -> idle -> dead', () => {
    let state: BridgeState = 'idle';

    // Send message
    state = nextState(state, 'send_message')!;
    expect(state).toBe('streaming');

    // Receive result
    state = nextState(state, 'result_received')!;
    expect(state).toBe('idle');

    // Kill
    state = nextState(state, 'kill')!;
    expect(state).toBe('dead');
  });

  it('supports interrupt + resume lifecycle', () => {
    let state: BridgeState = 'idle';

    // Send message
    state = nextState(state, 'send_message')!;
    expect(state).toBe('streaming');

    // Interrupt
    state = nextState(state, 'interrupt')!;
    expect(state).toBe('interrupted');

    // Process exits after SIGINT
    state = nextState(state, 'process_exit')!;
    expect(state).toBe('idle');

    // Can send another message
    state = nextState(state, 'send_message')!;
    expect(state).toBe('streaming');
  });

  it('supports crash + respawn lifecycle', () => {
    let state: BridgeState = 'idle';

    // Send message
    state = nextState(state, 'send_message')!;
    expect(state).toBe('streaming');

    // Unexpected crash
    state = nextState(state, 'process_exit')!;
    expect(state).toBe('dead');

    // Respawn on next message
    state = nextState(state, 'send_message')!;
    expect(state).toBe('streaming');

    // Complete normally
    state = nextState(state, 'result_received')!;
    expect(state).toBe('idle');
  });
});
