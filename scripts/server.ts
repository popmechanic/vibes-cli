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
import { cancelCurrent } from './server/claude-bridge.ts';

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

// Module-scope server reference for graceful shutdown
let server: ReturnType<typeof Bun.serve> | null = null;

// --- Graceful shutdown ---
function shutdown(signal: string) {
  console.log(`\n[Server] ${signal} received — shutting down...`);
  cancelCurrent(); // Kill any active Claude subprocesses
  if (server) {
    server.stop(true); // true = close existing connections
    server = null;
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Port takeover ---
async function start() {
  if (await killProcessOnPort(ctx.port)) {
    console.log(`Port ${ctx.port} in use — taking over from previous server...`);
    await waitForPort(ctx.port);
  }

  server = Bun.serve<WsData>({
    port: ctx.port,
    idleTimeout: 255,

    async fetch(req, srv) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === '/ws') {
        const upgraded = srv.upgrade(req, { data: { ctx, onEvent: () => {} } });
        // Bun.serve fetch() must return a Response, but on successful upgrade there is
        // nothing to send — Bun expects `undefined`. Cast to satisfy TypeScript.
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
