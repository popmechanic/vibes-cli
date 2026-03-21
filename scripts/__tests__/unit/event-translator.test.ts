import { describe, it, expect } from 'vitest';
import { translateStreamEvent } from '../../server/event-translator.ts';

describe('event-translator', () => {
  it('translates system init', () => {
    const event = { type: 'system', subtype: 'init', model: 'sonnet', tools: ['Read'], session_id: 'abc' };
    expect(translateStreamEvent(event)).toEqual([{ type: 'init', model: 'sonnet', tools: ['Read'], session_id: 'abc' }]);
  });

  it('translates text_delta to token', () => {
    const event = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } } };
    expect(translateStreamEvent(event)).toEqual([{ type: 'token', text: 'hello' }]);
  });

  it('translates tool_use content_block_start to tool_start', () => {
    const event = { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read', id: 't1' } } };
    expect(translateStreamEvent(event)).toEqual([{ type: 'tool_start', name: 'Read', id: 't1' }]);
  });

  it('buffers input_json_delta (returns empty)', () => {
    const event = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file' } } };
    expect(translateStreamEvent(event)).toEqual([]);
  });

  it('translates tool_result with content cap at 10KB', () => {
    const bigContent = 'x'.repeat(20000);
    const event = { type: 'tool_result', tool_name: 'Read', content: bigContent, is_error: false };
    const result = translateStreamEvent(event);
    expect(result[0].type).toBe('tool_result');
    expect(result[0].content.length).toBeLessThanOrEqual(10240);
    expect(result[0].truncated).toBe(true);
  });

  it('translates result event', () => {
    const event = { type: 'result', subtype: 'success', result: 'Done', is_error: false, usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.01, duration_ms: 5000 };
    const result = translateStreamEvent(event);
    expect(result[0].type).toBe('complete');
    expect(result[0].usage).toBeDefined();
    expect(result[0].cost).toBe(0.01);
  });

  it('translates rate_limit_event', () => {
    const event = { type: 'rate_limit_event' };
    expect(translateStreamEvent(event)).toEqual([{ type: 'status', status: 'rate_limited' }]);
  });

  it('translates compact_boundary', () => {
    const event = { type: 'system', subtype: 'compact_boundary' };
    expect(translateStreamEvent(event)).toEqual([{ type: 'status', status: 'context_compacted' }]);
  });

  it('drops hook events', () => {
    const event = { type: 'hook_started' };
    expect(translateStreamEvent(event)).toEqual([]);
  });

  it('translates result with is_error', () => {
    const event = { type: 'result', is_error: true, result: 'Something failed' };
    const result = translateStreamEvent(event);
    expect(result[0].type).toBe('error');
    expect(result[0].message).toBe('Something failed');
  });

  it('translates api_retry', () => {
    const event = { type: 'system', subtype: 'api_retry', attempt: 2 };
    expect(translateStreamEvent(event)).toEqual([{ type: 'status', status: 'retrying', attempt: 2 }]);
  });

  it('translates assistant message with text and tool_use blocks', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', name: 'Read', id: 'tu_1' },
        ],
      },
    };
    const result = translateStreamEvent(event);
    expect(result).toEqual([
      { type: 'token', text: 'Let me read that file.' },
      { type: 'tool_start', name: 'Read', id: 'tu_1' },
    ]);
  });

  it('handles assistant tool_use with missing id', () => {
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read' }] },
    };
    const result = translateStreamEvent(event);
    expect(result[0].id).toBeNull();
  });
});
