/**
 * Tests for the operation lock (claude-bridge.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acquireLock, releaseLock, cancelCurrent, isLocked } from '../../server/claude-bridge.ts';

describe('operation lock', () => {
  beforeEach(() => {
    // Ensure lock is released before each test
    releaseLock();
  });

  it('acquires lock when free', () => {
    expect(acquireLock('chat', () => {})).toBe(true);
    expect(isLocked()).toBe(true);
  });

  it('rejects concurrent operations', () => {
    expect(acquireLock('chat', () => {})).toBe(true);
    expect(acquireLock('generate', () => {})).toBe(false);
    releaseLock();
    expect(acquireLock('generate', () => {})).toBe(true);
  });

  it('releaseLock frees the lock', () => {
    acquireLock('chat', () => {});
    expect(isLocked()).toBe(true);
    releaseLock();
    expect(isLocked()).toBe(false);
  });

  it('cancel releases the lock and calls cancel fn', () => {
    const cancel = vi.fn();
    acquireLock('chat', cancel);
    expect(cancelCurrent()).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(isLocked()).toBe(false);
    expect(acquireLock('generate', () => {})).toBe(true);
  });

  it('cancelCurrent returns false when no operation', () => {
    expect(cancelCurrent()).toBe(false);
  });

  it('multiple release calls are safe', () => {
    acquireLock('chat', () => {});
    releaseLock();
    releaseLock(); // Should not throw
    expect(isLocked()).toBe(false);
  });
});
