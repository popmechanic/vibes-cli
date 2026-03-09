import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../../../bundles/sse-parser.js';

// Helper: create a ReadableStream from string chunks
function chunksToReader(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return stream.getReader();
}

// Helper: collect all yields from async generator
async function collect(gen) {
  const results = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe('parseSSEStream', () => {
  it('extracts content from complete SSE messages', async () => {
    const reader = chunksToReader([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['Hello', ' world']);
  });

  it('handles chunks split across reads', async () => {
    const reader = chunksToReader([
      'data: {"choices":[{"delta":{"conte',
      'nt":"split"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['split']);
  });

  it('ignores SSE comments', async () => {
    const reader = chunksToReader([
      ': keepalive\ndata: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['hi']);
  });

  it('handles empty delta content', async () => {
    const reader = chunksToReader([
      'data: {"choices":[{"delta":{}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual([]);
  });

  it('handles multiple messages in a single chunk', async () => {
    const reader = chunksToReader([
      'data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"choices":[{"delta":{"content":"b"}}]}\ndata: {"choices":[{"delta":{"content":"c"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('skips malformed JSON', async () => {
    const reader = chunksToReader([
      'data: not-json\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['ok']);
  });

  it('handles empty stream', async () => {
    const reader = chunksToReader([]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual([]);
  });

  it('handles stream ending without [DONE]', async () => {
    const reader = chunksToReader([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['partial']);
  });

  it('handles remaining buffer after stream ends', async () => {
    // Last chunk doesn't end with newline — tests the buffer cleanup path
    const reader = chunksToReader([
      'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"last"}}]}',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['first', 'last']);
  });

  it('ignores empty lines', async () => {
    const reader = chunksToReader([
      '\n\n\ndata: {"choices":[{"delta":{"content":"hi"}}]}\n\n\n\ndata: [DONE]\n\n',
    ]);
    const result = await collect(parseSSEStream(reader));
    expect(result).toEqual(['hi']);
  });
});
