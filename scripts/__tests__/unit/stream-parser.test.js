import { describe, it, expect, vi } from 'vitest';
import { createStreamParser } from '../../lib/stream-parser.js';

describe('createStreamParser', () => {
  it('parses a complete JSON line', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('{"type":"result"}\n'));
    expect(events).toEqual([{ type: 'result' }]);
  });

  it('buffers incomplete lines across chunks', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('{"type":'));
    expect(events).toHaveLength(0);
    parse(Buffer.from('"assistant"}\n'));
    expect(events).toEqual([{ type: 'assistant' }]);
  });

  it('handles multiple lines in one chunk', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ a: 1 });
    expect(events[1]).toEqual({ b: 2 });
  });

  it('skips empty lines', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('\n\n{"type":"ok"}\n\n'));
    expect(events).toEqual([{ type: 'ok' }]);
  });

  it('warns on malformed JSON without throwing', () => {
    const events = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parse = createStreamParser((e) => events.push(e));
    parse(Buffer.from('not-json\n{"type":"ok"}\n'));
    expect(events).toEqual([{ type: 'ok' }]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('handles multi-byte UTF-8 split across chunks', () => {
    const events = [];
    const parse = createStreamParser((e) => events.push(e));
    const full = Buffer.from('{"text":"hello 🌍"}\n');
    // Split in the middle of the emoji (4-byte sequence)
    parse(full.subarray(0, 18));
    parse(full.subarray(18));
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('hello 🌍');
  });
});
