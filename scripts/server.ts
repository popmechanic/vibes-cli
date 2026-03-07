/**
 * Live Preview Server — Bun-native
 *
 * HTTP server serves preview.html, app.jsx, and theme catalog.
 * WebSocket server bridges chat messages and theme switches to claude.
 *
 * Modes:
 *   --mode=preview  (default) Serves preview.html for terminal-based iteration
 *   --mode=editor   Serves editor.html with setup wizard, generation, and deploy
 *
 * Usage: bun scripts/server.ts [--port 3333] [--mode=editor]
 */

import { loadConfig } from './server/config.ts';
import { createRouter } from './server/router.ts';
import { createWsHandler, type WsData } from './server/ws.ts';
import { killProcessOnPort, waitForPort } from './server/lifecycle.ts';

// --- Process-level safety nets ---
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});

// --- Build context ---
const ctx = loadConfig();
const router = createRouter(ctx);
const wsHandler = createWsHandler(ctx);

// --- Port takeover ---
async function start() {
  if (await killProcessOnPort(ctx.port)) {
    console.log(`Port ${ctx.port} in use — taking over from previous server...`);
    await waitForPort(ctx.port);
  }

  const server = Bun.serve<WsData>({
    port: ctx.port,
    idleTimeout: 255,

    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req, { data: { ctx, onEvent: () => {}, bridge: null } });
        if (upgraded) return undefined as any;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      return router(req, url);
    },

    websocket: wsHandler,
  });

  const modeLabel = ctx.mode === 'editor' ? 'Editor' : 'Preview';
  const url = `http://localhost:${ctx.port}`;
  console.log(`\nVibes ${modeLabel} Server`);
  console.log(`  Open:   ${url}`);
  console.log(`  Mode:   ${modeLabel}`);
  console.log(`  Themes: ${ctx.themes.length} loaded`);
  console.log(`  Anims:  ${ctx.animations.length} loaded`);
  console.log(`  Press Ctrl+C to stop\n`);
}

start();
