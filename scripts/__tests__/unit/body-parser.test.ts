/**
 * Tests for streaming body parsers (router.ts parseJsonBody / readBodyWithLimit).
 */
import { describe, it, expect } from 'vitest';
import { parseJsonBody, readBodyWithLimit } from '../../server/router.ts';

function makeRequest(body: string, contentLength?: number): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  } else {
    headers.set('content-length', String(Buffer.byteLength(body)));
  }
  return new Request('http://localhost/test', {
    method: 'POST',
    headers,
    body,
  });
}

function makeRawRequest(body: Buffer, contentLength?: number): Request {
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  if (contentLength !== undefined) {
    headers.set('content-length', String(contentLength));
  } else {
    headers.set('content-length', String(body.length));
  }
  return new Request('http://localhost/test', {
    method: 'POST',
    headers,
    body,
  });
}

describe('parseJsonBody', () => {
  it('parses valid JSON under limit', async () => {
    const data = { hello: 'world', number: 42 };
    const req = makeRequest(JSON.stringify(data));
    const result = await parseJsonBody(req);
    expect(result).toEqual(data);
  });

  it('rejects body exceeding 1MB via Content-Length header (fast path)', async () => {
    // Declare a Content-Length larger than 1MB but send a small body
    const req = makeRequest('{}', 2 * 1024 * 1024);
    await expect(parseJsonBody(req)).rejects.toThrow('Request body too large');
  });

  it('rejects body exceeding custom limit', async () => {
    const req = makeRequest('{"a":"b"}', 200);
    await expect(parseJsonBody(req, 5)).rejects.toThrow();
  });

  it('rejects invalid JSON', async () => {
    const req = makeRequest('not json');
    await expect(parseJsonBody(req)).rejects.toThrow();
  });

  it('handles empty body', async () => {
    const req = makeRequest('', 0);
    await expect(parseJsonBody(req)).rejects.toThrow();
  });

  it('rejects body with small Content-Length but large actual payload (streaming accumulator)', async () => {
    // Construct a body larger than the limit but lie about Content-Length
    // to bypass the fast-path check. The streaming accumulator must catch it.
    const limit = 64;
    const bigPayload = JSON.stringify({ data: 'x'.repeat(limit * 2) });
    // Set Content-Length to a small value that passes the fast-path check
    const req = makeRequest(bigPayload, 10);
    await expect(parseJsonBody(req, limit)).rejects.toThrow('Request body too large');
  });
});

describe('readBodyWithLimit', () => {
  it('reads binary body under limit', async () => {
    const data = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const req = makeRawRequest(data);
    const result = await readBodyWithLimit(req, 1024);
    expect(result).toEqual(data);
  });

  it('rejects body exceeding limit via Content-Length', async () => {
    const req = makeRawRequest(Buffer.from('x'), 10 * 1024 * 1024);
    await expect(readBodyWithLimit(req, 5 * 1024 * 1024)).rejects.toThrow('Body too large');
  });

  it('rejects body with small Content-Length but large actual payload (streaming accumulator)', async () => {
    const limit = 32;
    const bigPayload = Buffer.alloc(limit * 2, 0xAB);
    // Lie about Content-Length to bypass fast-path
    const req = makeRawRequest(bigPayload, 10);
    await expect(readBodyWithLimit(req, limit)).rejects.toThrow('Body too large');
  });
});
