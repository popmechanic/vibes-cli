#!/usr/bin/env node
/**
 * Live Preview Server
 *
 * HTTP server serves preview.html, app.jsx, and theme catalog.
 * WebSocket server bridges chat messages and theme switches to claude -p.
 *
 * Modes:
 *   --mode=preview  (default) Serves preview.html for terminal-based iteration
 *   --mode=editor   Serves editor.html with setup wizard, generation, and deploy
 *
 * Usage: node scripts/preview-server.js [--port 3333] [--mode=editor]
 */

import { fileURLToPath } from 'url';
import { ensurePreviewDeps } from './lib/ensure-deps.js';
await ensurePreviewDeps(fileURLToPath(import.meta.url));

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { loadConfig } from './server/config.js';
import { handleRequest } from './server/routes.js';
import { setupWebSocket } from './server/ws-dispatch.js';
import { wsAdapter } from './server/claude-bridge.js';
import { killProcessOnPort, waitForPort } from './server/lifecycle.js';

// --- Process-level safety nets ---
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});

// --- Build context ---
const ctx = loadConfig();

// --- HTTP Server ---
const server = createServer((req, res) => {
  handleRequest(ctx, req, res).catch((err) => {
    console.error('[HTTP] Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server, maxPayload: 50 * 1024 * 1024 /* 50MB for image refs */ });
setupWebSocket(wss, ctx, wsAdapter);
wss.on('error', (err) => {
  console.error('[WSS] Server error:', err);
});

// --- Start ---
async function start() {
  if (killProcessOnPort(ctx.port)) {
    console.log(`Port ${ctx.port} in use — taking over from previous server...`);
    await waitForPort(ctx.port);
  }

  server.listen(ctx.port, () => {
    const modeLabel = ctx.mode === 'editor' ? 'Editor' : 'Preview';
    console.log(`
┌─────────────────────────────────────────────────┐
│  Vibes ${modeLabel.padEnd(7)} Server                       │
├─────────────────────────────────────────────────┤
│                                                 │
│  Open:     http://localhost:${ctx.port}                │
│  Mode:     ${modeLabel.padEnd(37)}│
│  Themes:   ${String(ctx.themes.length).padEnd(3)} loaded                       │
│  Anims:    ${String(ctx.animations.length).padEnd(3)} loaded                       │
│                                                 │
│  Press Ctrl+C to stop                           │
└─────────────────────────────────────────────────┘
    `);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });
}

start();
