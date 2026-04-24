/**
 * Tests for the /reference-frame route handler.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { serveReferenceFrame } from '../../server/handlers/reference-frame.ts';

const TMP = join(import.meta.dirname, '.tmp-refframe-test');

function makeCtx() {
  return { projectRoot: TMP, port: 3333 } as any;
}

beforeEach(() => {
  mkdirSync(join(TMP, '.vibes-tmp'), { recursive: true });
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('serveReferenceFrame', () => {
  it('serves an HTML reference as-is with text/html content-type', async () => {
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.html'), '<p>hi</p>');
    const url = new URL('http://localhost/reference-frame?name=ref.html&kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<p>hi</p>');
  });

  it('wraps an image reference in a full-bleed HTML shell', async () => {
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.png'), 'fake-png-bytes');
    const url = new URL('http://localhost/reference-frame?name=ref.png&kind=image');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<img');
    expect(body).toContain('src="/reference-frame?name=ref.png&kind=raw"');
    expect(body).toContain('object-fit:contain');
  });

  it('returns the raw image bytes when kind=raw', async () => {
    const bytes = Buffer.from([137, 80, 78, 71]); // PNG magic
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.png'), bytes);
    const url = new URL('http://localhost/reference-frame?name=ref.png&kind=raw');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/');
  });

  it('rejects path traversal attempts', () => {
    const url = new URL('http://localhost/reference-frame?name=..%2Fetc%2Fpasswd&kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(400);
  });

  it('rejects missing name', () => {
    const url = new URL('http://localhost/reference-frame?kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a name that does not exist on disk', () => {
    const url = new URL('http://localhost/reference-frame?name=nonexistent.html&kind=html');
    const res = serveReferenceFrame(makeCtx(), url);
    expect(res.status).toBe(404);
  });

  it('uses the port from ctx for the CORS Access-Control-Allow-Origin header', () => {
    writeFileSync(join(TMP, '.vibes-tmp', 'ref.html'), '<p>hi</p>');
    const url = new URL('http://localhost/reference-frame?name=ref.html&kind=html');
    const ctx = { projectRoot: TMP, port: 4444 } as any;
    const res = serveReferenceFrame(ctx, url);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4444');
  });
});
