/**
 * GET /reference-frame — serve the user-uploaded reference asset inside
 * an iframe-friendly wrapper so the preview iframe can show it while
 * Claude is analyzing it in Step 1 of generation.
 *
 * Supported kinds:
 *   - html: serve the file as-is with text/html (for HTML references)
 *   - image: wrap the image in a minimal full-bleed HTML shell
 *   - raw: return the raw file bytes (used by the image shell's <img src>)
 *
 * Security: the `name` query parameter is validated to be a plain filename
 * (no slashes, no ..). The file is looked up only under the known reference
 * directory (.vibes-tmp/) relative to projectRoot.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { ServerContext } from '../config.ts';

function corsHeaders(ctx: ServerContext): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': `http://localhost:${ctx.port}`,
    'Vary': 'Origin',
  };
}

function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && !name.includes('..') && name.length <= 200;
}

function contentTypeFor(name: string): string {
  const ext = extname(name).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.avif': return 'image/avif';
    default: return 'application/octet-stream';
  }
}

export function serveReferenceFrame(ctx: ServerContext, url: URL): Response {
  const name = url.searchParams.get('name') || '';
  const kind = url.searchParams.get('kind') || '';

  if (!isSafeName(name)) {
    return new Response('Bad Request', { status: 400, headers: corsHeaders(ctx) });
  }

  const refDir = join(ctx.projectRoot, '.vibes-tmp');
  const filePath = join(refDir, name);
  if (!filePath.startsWith(refDir + '/')) {
    return new Response('Bad Request', { status: 400, headers: corsHeaders(ctx) });
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return new Response('Not Found', { status: 404, headers: corsHeaders(ctx) });
  }

  if (kind === 'html') {
    const body = readFileSync(filePath, 'utf-8');
    return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(ctx) } });
  }

  if (kind === 'raw') {
    const bytes = readFileSync(filePath);
    return new Response(bytes, { headers: { 'Content-Type': contentTypeFor(name), ...corsHeaders(ctx) } });
  }

  // kind === 'image' (or default): wrap in a minimal full-bleed shell
  const rawSrc = `/reference-frame?name=${encodeURIComponent(name)}&kind=raw`;
  const shell = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <style>
    html,body { margin:0; padding:0; height:100%; background:#000; }
    img { display:block; width:100%; height:100%; object-fit:contain; }
  </style>
</head>
<body><img src="${rawSrc}" alt="reference"></body></html>`;
  return new Response(shell, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(ctx) } });
}
