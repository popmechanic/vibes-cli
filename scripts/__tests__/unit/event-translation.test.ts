/**
 * Tests for the event translation layer (ws.ts translateEvent).
 */
import { describe, it, expect } from 'vitest';
import { translateEvent } from '../../server/ws.ts';

describe('translateEvent', () => {
  it('translates progress to status with thinking', () => {
    const msgs = translateEvent({ type: 'progress', progress: 50, stage: 'Thinking...', elapsed: 5 });
    expect(msgs).toEqual([{ type: 'status', status: 'thinking', progress: 50, stage: 'Thinking...', elapsed: 5 }]);
  });

  it('translates complete to status + chat + app_updated when hasEdited and !skipChat', () => {
    const msgs = translateEvent({ type: 'complete', text: 'Done', toolsUsed: 2, elapsed: 10, hasEdited: true, skipChat: false });
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ type: 'status', status: 'updated', progress: 100, stage: 'App updated!', elapsed: 10 });
    expect(msgs[1]).toEqual({ type: 'chat', role: 'assistant', content: 'Done' });
    expect(msgs[2]).toEqual({ type: 'app_updated' });
  });

  it('skips chat message when skipChat is true', () => {
    const msgs = translateEvent({ type: 'complete', text: 'Done', toolsUsed: 1, elapsed: 5, hasEdited: true, skipChat: true });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('status');
    expect(msgs[1].type).toBe('app_updated');
  });

  it('skips app_updated when hasEdited is false', () => {
    const msgs = translateEvent({ type: 'complete', text: 'Sure', toolsUsed: 0, elapsed: 3, hasEdited: false, skipChat: false });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('status');
    expect(msgs[1].type).toBe('chat');
  });

  it('returns only status when both skipChat and !hasEdited', () => {
    const msgs = translateEvent({ type: 'complete', text: 'Ok', toolsUsed: 0, elapsed: 1, hasEdited: false, skipChat: true });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('status');
  });

  it('passes through token events', () => {
    const msgs = translateEvent({ type: 'token', text: 'hello' });
    expect(msgs).toEqual([{ type: 'token', text: 'hello' }]);
  });

  it('passes through cancelled events', () => {
    const msgs = translateEvent({ type: 'cancelled' });
    expect(msgs).toEqual([{ type: 'cancelled' }]);
  });

  it('passes through error events', () => {
    const msgs = translateEvent({ type: 'error', message: 'oops' });
    expect(msgs).toEqual([{ type: 'error', message: 'oops' }]);
  });

  it('strips elapsed from tool_result events', () => {
    const msgs = translateEvent({ type: 'tool_result', name: 'Write', content: 'ok', is_error: false, elapsed: 5 });
    expect(msgs).toEqual([{ type: 'tool_result', name: 'Write', content: 'ok', is_error: false }]);
  });

  it('passes through theme_selected events', () => {
    const msgs = translateEvent({ type: 'theme_selected', themeId: 'neo', themeName: 'Neo' });
    expect(msgs).toEqual([{ type: 'theme_selected', themeId: 'neo', themeName: 'Neo' }]);
  });

  it('passes through tool_detail events', () => {
    const msgs = translateEvent({ type: 'tool_detail', name: 'Edit', input_summary: 'app.jsx', elapsed: 3 });
    expect(msgs).toEqual([{ type: 'tool_detail', name: 'Edit', input_summary: 'app.jsx', elapsed: 3 }]);
  });
});
