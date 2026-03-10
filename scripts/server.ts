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
 *
 * Programmatic: import { startServer } from './server.ts';
 *               const { server, ctx } = await startServer({ mode: 'editor', port: 3333 });
 */

if (typeof Bun === 'undefined') { console.error('This server requires Bun. Install from https://bun.sh'); process.exit(1); }

import { loadConfig, type ServerContext } from './server/config.ts';
import { createRouter } from './server/router.ts';
import { createWsHandler, type WsData } from './server/ws.ts';
import { killProcessOnPort, waitForPort } from './server/lifecycle.ts';
import { cancelCurrent } from './server/claude-bridge.ts';

export interface StartServerOptions {
  port?: number;
  mode?: 'preview' | 'editor';
  prompt?: string;
  /** If true, skip process-level signal handlers (caller manages lifecycle) */
  managed?: boolean;
}

export interface StartServerResult {
  server: ReturnType<typeof Bun.serve>;
  ctx: ServerContext;
  shutdown: () => void;
}

export async function startServer(options?: StartServerOptions): Promise<StartServerResult> {
  // Inject options into process.argv so loadConfig() picks them up
  const origArgv = [...process.argv];
  if (options?.port) {
    process.argv.push('--port', String(options.port));
  }
  if (options?.mode) {
    process.argv.push(`--mode=${options.mode}`);
  }
  if (options?.prompt) {
    process.argv.push('--prompt', options.prompt);
  }

  const ctx = loadConfig();
  if (options?.managed) ctx.managed = true;

  // Restore original argv
  process.argv = origArgv;

  const router = createRouter(ctx);
  const wsHandler = createWsHandler(ctx);

  if (await killProcessOnPort(ctx.port)) {
    console.log(`Port ${ctx.port} in use — taking over from previous server...`);
    await waitForPort(ctx.port);
  }

  const server = Bun.serve<WsData>({
    hostname: '127.0.0.1',
    port: ctx.port,
    idleTimeout: 255,

    async fetch(req, srv) {
      const url = new URL(req.url);

      // WebSocket upgrade — accept both /ws and root path (editor.html connects to root)
      if (url.pathname === '/ws' || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
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

  let shuttingDown = false;
  const shutdownFn = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cancelCurrent();
    server.stop(true);
  };

  // Only install signal handlers if not managed by caller
  if (!options?.managed) {
    process.on('uncaughtException', (err) => {
      console.error('[Process] Uncaught exception:', err);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      console.error('[Process] Unhandled rejection:', reason);
    });
    process.on('SIGINT', () => { shutdownFn(); setTimeout(() => process.exit(0), 1000); });
    process.on('SIGTERM', () => { shutdownFn(); setTimeout(() => process.exit(0), 1000); });
  }

  const modeLabel = ctx.mode === 'editor' ? 'Editor' : 'Preview';
  console.log(`\nVibes ${modeLabel} Server`);
  console.log(`  Open:   http://localhost:${ctx.port}`);
  console.log(`  Mode:   ${modeLabel}`);
  console.log(`  Themes: ${ctx.themes.length} loaded`);
  console.log(`  Anims:  ${ctx.animations.length} loaded`);
  if (!options?.managed) console.log(`  Press Ctrl+C to stop\n`);

  return { server, ctx, shutdown: shutdownFn };
}

// --- CLI entry point ---
if (import.meta.main) {
  startServer();
}
