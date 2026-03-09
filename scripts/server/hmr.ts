/**
 * Time-lapse HMR — Babel-validated snapshot hot reload.
 *
 * During generation, detects renderable app.jsx snapshots and pushes
 * assembled HTML to the browser for live preview updates.
 *
 * Two complementary triggers:
 * 1. Primary: Write tool_result events from the Claude event stream
 * 2. Backstop: fs.watchFile polling (1s interval)
 */

// @babel/parser ships its own TypeScript declarations — no @types/ package needed
import { parse } from '@babel/parser';
import { watchFile, unwatchFile, readFileSync } from 'fs';
import { join } from 'path';
import type { ServerContext } from './config.ts';
import { currentAppDir } from './app-context.js';
import { assembleAppFrame } from './handlers/generate.ts';

/**
 * Check if JSX code is syntactically valid and has an export default.
 * Uses Babel parser — the same parser the browser uses for transpilation.
 */
export function isRenderable(code: string): boolean {
  if (!code.includes('export default')) return false;
  try {
    parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: false,
    });
    return true;
  } catch {
    return false;
  }
}

export interface HmrWatcher {
  start: () => void;
  stop: () => void;
  onToolResult: (event: { _toolName?: string; _filePath?: string }) => void;
}

export function createHmrWatcher(
  ctx: ServerContext,
  broadcast: (msg: object) => void
): HmrWatcher {
  let lastSnapshot = '';
  let debounceTimer: Timer | null = null;
  let active = false;

  function getAppPath(): string {
    const appDir = currentAppDir(ctx);
    return appDir ? join(appDir, 'app.jsx') : join(ctx.projectRoot, 'app.jsx');
  }

  let polling = false;

  let watchedPath: string | null = null;

  function startPolling(): void {
    if (polling) return;
    polling = true;
    watchedPath = getAppPath();
    watchFile(watchedPath, { interval: 1000 }, () => {
      scheduleCheck();
    });
  }

  function stopPolling(): void {
    if (!polling) return;
    polling = false;
    if (watchedPath) unwatchFile(watchedPath);
    watchedPath = null;
  }

  function scheduleCheck(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => checkAndPush(), 500);
  }

  function onToolResult(event: { _toolName?: string; _filePath?: string }): void {
    if (!active) return;
    if (event._toolName !== 'Write' && event._toolName !== 'Edit') return;
    if (event._filePath && !event._filePath.endsWith('app.jsx')) return;
    scheduleCheck();
  }

  function checkAndPush(): void {
    try {
      const code = readFileSync(getAppPath(), 'utf-8');
      if (code === lastSnapshot) return;
      if (!isRenderable(code)) return;

      lastSnapshot = code;
      const assembled = assembleAppFrame(ctx, code);
      broadcast({
        type: 'hmr_update',
        html: assembled,
        timestamp: Date.now(),
        codeLength: code.length,
      });
    } catch {
      // File may not exist yet or be in mid-write
    }
  }

  function start(): void {
    if (active) return;
    active = true;
    lastSnapshot = '';
    startPolling();
  }

  function stop(): void {
    active = false;
    stopPolling();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    lastSnapshot = '';
  }

  return { start, stop, onToolResult };
}
