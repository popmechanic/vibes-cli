/**
 * WebSocket handler — unified session with persistent bridge.
 *
 * Routes chat/generate/theme messages through a persistent Claude process
 * via the stream-json bridge. Non-Claude operations (deploy, save, etc.)
 * remain as direct handlers.
 *
 * Features:
 * - Persistent bridge: single Claude process across turns
 * - Grace period: 30s reconnection window on disconnect
 * - Write-gating: only the most-recently-connected client can send messages
 * - Reassembly trigger: auto-assembles index.html after app.jsx edits
 * - App switching: interrupt + reload history on app change
 */

import { existsSync, mkdirSync, copyFileSync, unlinkSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, resolve, basename } from 'path';
import type { ServerWebSocket } from 'bun';
import type { ServerContext } from './config.ts';
import { reloadThemes } from './config.ts';
import { resolveAppJsxPath, resolveProjectDir } from './app-context.js';
import { createBridge, cancelCurrent, type PersistentBridge, type EventCallback } from './claude-bridge.ts';
import { buildChatPrompt, buildGeneratePrompt, buildBrainstormPrompt } from './prompt-builders.ts';
import { loadHistory, appendMessage, clearHistory } from './chat-history.ts';
import { sanitizeAppJsx } from './post-process.ts';
import { handleThemeSwitch, handlePaletteTheme } from './handlers/theme.ts';
import { handleDeploy } from './handlers/deploy.ts';
import { handleSaveTheme } from './handlers/create-theme.ts';
import { handleGenerateImage } from './handlers/image-gen.ts';

// --- Types ---

export interface WsData {
  ctx: ServerContext;
  onEvent: EventCallback;
}

// --- Event Translation Layer ---

/**
 * Translate internal bridge events to client-facing WebSocket messages.
 * Preserves exact wsAdapter behavior from claude-bridge.js.
 */
export function translateEvent(event: any): object[] {
  if (event.type === 'progress') {
    return [{ type: 'status', status: 'thinking', progress: event.progress, stage: event.stage, elapsed: event.elapsed }];
  }
  if (event.type === 'complete') {
    const stage = event.hasEdited ? 'App updated!' : 'Done — no code changes made';
    const msgs: object[] = [
      { type: 'status', status: event.hasEdited ? 'updated' : 'idle', progress: 100, stage, elapsed: event.elapsed },
    ];
    if (!event.skipChat) {
      msgs.push({ type: 'chat', role: 'assistant', content: event.text });
    }
    if (event.hasEdited) {
      msgs.push({ type: 'app_updated' });
    }
    return msgs;
  }
  if (event.type === 'tool_result') {
    // Strip internal fields (_filePath, _toolName, elapsed) — only forward client-safe fields
    return [{ type: 'tool_result', name: event.name, content: event.content, is_error: event.is_error }];
  }
  // All others pass through (token, cancelled, error, tool_detail, theme_selected, etc.)
  return [event];
}

/**
 * Create an onEvent callback that forwards translated events to a WebSocket.
 */
export function createEventAdapter(ws: ServerWebSocket<WsData>): EventCallback {
  return (event: any) => {
    try {
      for (const msg of translateEvent(event)) {
        ws.send(JSON.stringify(msg));
      }
    } catch (err: any) {
      // Only swallow WebSocket-closed errors; re-throw unexpected failures
      if (err?.message?.includes('WebSocket') || ws.readyState !== 1) return;
      throw err;
    }
  };
}

// --- Broadcast helper ---

const connectedClients = new Set<ServerWebSocket<WsData>>();

export function broadcast(msg: object): void {
  const data = JSON.stringify(msg);
  for (const ws of connectedClients) {
    try { ws.send(data); } catch {}
  }
}

// --- Session State ---

/** The persistent bridge instance (lazily created on first message). */
let bridge: PersistentBridge | null = null;

/** Current app directory the bridge is operating in. */
let currentAppDirPath: string | null = null;

/** Grace period timer — delays bridge teardown on disconnect. */
let graceTimer: ReturnType<typeof setTimeout> | null = null;
const GRACE_PERIOD_MS = 30_000;

/** Track app.jsx mtime for reassembly detection. */
let lastAppJsxMtime: number = 0;

/** Accumulate streaming tokens for chat history. */
let streamingTextBuffer: string = '';

// --- Bridge Management ---

/**
 * Get or create the bridge for the given app directory.
 * The bridge is lazily created on first use and reused across reconnections.
 */
function getOrCreateBridge(ctx: ServerContext, appDir: string): PersistentBridge {
  // If bridge exists for a different app, kill it
  if (bridge && currentAppDirPath !== appDir) {
    console.log(`[WS] App changed from ${currentAppDirPath} to ${appDir} — killing bridge`);
    bridge.kill();
    bridge = null;
  }

  if (!bridge) {
    currentAppDirPath = appDir;
    // Snapshot app.jsx mtime before bridge starts
    snapshotAppJsxMtime(appDir);

    streamingTextBuffer = '';
    bridge = createBridge(appDir, (event: any) => {
      // Accumulate streaming text for chat history (Bug 4 fix)
      if (event.type === 'token' && event.text) {
        streamingTextBuffer += event.text;
      }

      // Check for app.jsx edits on tool_result
      if (event.type === 'tool_result' && !event.is_error) {
        checkAndReassemble(ctx, appDir);
      }

      // On completion: final reassembly check + save full response to chat history
      if (event.type === 'complete') {
        checkAndReassemble(ctx, appDir);
        const fullResponse = streamingTextBuffer || event.result || '';
        if (fullResponse) {
          appendMessage(appDir, { role: 'assistant', content: fullResponse });
        }
        streamingTextBuffer = '';
      }

      // Forward to all connected clients
      broadcast(event);
    }, ctx.projectRoot);
    console.log(`[WS] Created persistent bridge for ${appDir}`);
  }

  return bridge;
}

/**
 * Snapshot the current mtime of app.jsx for change detection.
 */
function snapshotAppJsxMtime(appDir: string): void {
  const appPath = join(appDir, 'app.jsx');
  try {
    lastAppJsxMtime = statSync(appPath).mtimeMs;
  } catch {
    lastAppJsxMtime = 0;
  }
}

/**
 * Parse app.jsx with Bun's built-in transpiler to catch syntax errors
 * (unterminated strings, unbalanced braces, invalid JSX) that come from
 * truncated / malformed model output — e.g. when the upstream stream cuts
 * off mid-token during a provider incident. Cheap, zero-dep, runs in a
 * few ms for a typical app.
 */
function validateAppJsx(appDir: string): { ok: true } | { ok: false; error: string } {
  const appPath = join(appDir, 'app.jsx');
  try {
    const source = readFileSync(appPath, 'utf-8');
    const transpiler = new Bun.Transpiler({ loader: 'jsx' });
    transpiler.transformSync(source);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Check if app.jsx was modified since last snapshot. If so, run post-processing
 * and reassembly, then broadcast app_updated.
 */
function checkAndReassemble(ctx: ServerContext, appDir: string): void {
  const appPath = join(appDir, 'app.jsx');
  try {
    const currentMtime = statSync(appPath).mtimeMs;
    console.log(`[WS] checkAndReassemble: mtime=${currentMtime} last=${lastAppJsxMtime} changed=${currentMtime > lastAppJsxMtime}`);
    if (currentMtime > lastAppJsxMtime) {
      lastAppJsxMtime = currentMtime;
      console.log(`[WS] app.jsx modified — running post-process and reassembly`);

      // Syntax-check the generated code before we let it propagate to
      // index.html and the preview frame's Babel transformer. Catches
      // truncated / malformed output from upstream model incidents.
      const syntax = validateAppJsx(appDir);
      if (!syntax.ok) {
        console.warn(`[WS] app.jsx has syntax errors, skipping assembly: ${syntax.error}`);
        broadcast({ type: 'app_invalid', error: syntax.error });
        return;
      }

      // Post-process (sanitize CSS escapes, strip redeclared globals)
      sanitizeAppJsx(appDir);

      // Reassemble index.html
      try {
        const proc = Bun.spawnSync({
          cmd: ['bun', join(ctx.projectRoot, 'scripts/assemble.js'), 'app.jsx', 'index.html'],
          cwd: appDir,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (proc.exitCode === 0) {
          console.log(`[WS] Reassembled index.html for ${appDir}`);
        } else {
          console.warn(`[WS] Reassembly failed (exit ${proc.exitCode}): ${proc.stderr?.toString().slice(0, 200)}`);
        }
      } catch (err: any) {
        console.warn(`[WS] Reassembly error: ${err.message}`);
      }

      broadcast({ type: 'app_updated' });
    }
  } catch {
    // app.jsx doesn't exist yet — nothing to reassemble
  }
}

/**
 * Switch to a different app directory. Interrupts current bridge if streaming.
 */
function switchApp(ctx: ServerContext, newAppDir: string): void {
  if (bridge) {
    if (bridge.state === 'streaming') {
      bridge.interrupt();
    }
    if (currentAppDirPath !== newAppDir) {
      bridge.kill();
      bridge = null;
    }
  }
  currentAppDirPath = newAppDir;
}

// --- WebSocket Handler ---

export function createWsHandler(ctx: ServerContext) {
  return {
    maxPayloadLength: 5 * 1024 * 1024, // 5MB — files now upload via HTTP POST
    idleTimeout: 255,

    open(ws: ServerWebSocket<WsData>) {
      console.log('[WS] Client connected');
      ws.data.onEvent = createEventAdapter(ws);
      connectedClients.add(ws);

      // Cancel grace period if reconnecting within window
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
        console.log('[WS] Reconnected within grace period — bridge preserved');
      }

    },

    async message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      let msg: any;
      try {
        msg = JSON.parse(typeof message === 'string' ? message : message.toString());
      } catch {
        ws.data.onEvent({ type: 'error', message: 'Invalid JSON' });
        return;
      }

      const onEvent = ws.data.onEvent;

      // Handle reconnect — replay events from ring buffer
      if (msg.type === 'reconnect') {
        const lastSeq = msg.lastSeq || 0;
        if (bridge) {
          const events = bridge.eventLog.filter(e => e.seq > lastSeq);
          for (const { event } of events) {
            try {
              ws.send(JSON.stringify(event));
            } catch { break; }
          }
          console.log(`[WS] Replayed ${events.length} events since seq ${lastSeq}`);
        }
        return;
      }

      try {
        switch (msg.type) {
          // --- Bridge-routed messages ---

          case 'chat': {
            const appDir = resolveProjectDir(ctx, msg.app) || ctx.projectRoot;
            const prompt = buildChatPrompt(ctx, msg.message, {
              effects: msg.effects,
              animationId: msg.animationId,
              reference: msg.reference,
              skillId: msg.skillId,
              appName: msg.app,
            });
            appendMessage(appDir, { role: 'user', content: msg.message });
            const b = getOrCreateBridge(ctx, appDir);
            // Chat turns suppress generate-only staged-preview events.
            b.setTurnMode('chat');
            b.sendMessage(prompt);
            break;
          }

          case 'generate': {
            if (!msg.prompt) {
              onEvent({ type: 'error', message: 'Please describe what you want to build.' });
              break;
            }

            // Sync projectDir from client
            ctx.projectDir = msg.projectDir || null;

            if (!ctx.projectDir) {
              onEvent({ type: 'error', message: 'Please choose a project folder first.' });
              break;
            }

            const newAppDir = ctx.projectDir;
            const appName = basename(ctx.projectDir);
            onEvent({ type: 'app_created', name: appName });

            // Build the generate context (theme, style guide, TinyBase patterns)
            const result = buildGeneratePrompt(ctx, msg.prompt, {
              themeId: msg.themeId,
              reference: msg.reference,
              useAI: !!msg.useAI,
            });

            const themeColors = ctx.themeColors[result.themeId] || null;
            onEvent({ type: 'theme_selected', themeId: result.themeId, themeName: result.themeName, themeBackground: themeColors?.bg || null });

            // Switch to new app directory and save user message
            switchApp(ctx, newAppDir);
            appendMessage(newAppDir, { role: 'user', content: msg.prompt });

            // Staged-preview prelude: for reference-path generate, show the
            // user their uploaded reference while Claude reads it; then emit
            // the initial generation_stage so the UI shows the correct
            // staged-preview label from the start.
            const isReferencePath = result.isReference;
            const initialStage: 'reading_reference' | 'foundation' = isReferencePath ? 'reading_reference' : 'foundation';

            if (isReferencePath) {
              const refName = msg.reference?.name as string | undefined;
              const isTextRef = !!refName && /\.(txt|md|csv|tsv|json|xml|rtf)$/i.test(refName);
              if (refName && !isTextRef) {
                const refKind = result.isHtmlRef ? 'html' : 'image';
                const vibesTmpPath = join(ctx.projectRoot, '.vibes-tmp', refName);
                if (existsSync(vibesTmpPath)) {
                  onEvent({
                    type: 'reference_preview',
                    src: `/reference-frame?name=${encodeURIComponent(refName)}&kind=${refKind}`,
                  });
                }
              }
            }

            onEvent({ type: 'generation_stage', stage: initialStage });

            // Try brainstorm first — includes generate instructions for after Q&A
            const brainstormPrompt = buildBrainstormPrompt(ctx, msg.prompt, result.prompt);
            const b = getOrCreateBridge(ctx, newAppDir);

            // Generate turns emit the full staged-preview sequence; set mode
            // BEFORE sendMessage so the stream parser sees it from the first
            // tool_use.
            b.setTurnMode('generate', initialStage);

            if (brainstormPrompt) {
              b.sendMessage(brainstormPrompt);
            } else {
              // Fallback: no brainstorm skill found, generate directly
              b.sendMessage(result.prompt);
            }
            break;
          }

          case 'theme':
            // Theme switch uses multi-pass logic (Pass 1 mechanical + Pass 2 Claude).
            // This involves reading/writing app.jsx directly and running a one-shot
            // Claude call with guardrails. Keep using the existing handler for now
            // since it has complex validation logic that doesn't fit pure bridge routing.
            await handleThemeSwitch(ctx, onEvent, msg.themeId, msg.model, msg.app || undefined);
            break;

          case 'cancel': {
            // Try bridge interrupt first, fall back to legacy lock
            if (bridge && bridge.state === 'streaming') {
              bridge.interrupt();
              const appDir = currentAppDirPath || ctx.projectRoot;
              appendMessage(appDir, { role: 'system', content: 'Interrupted' });
            } else if (!cancelCurrent()) {
              onEvent({ type: 'error', message: 'No request in progress.' });
            }
            break;
          }

          case 'reset': {
            const appDir = currentAppDirPath || ctx.projectRoot;
            if (bridge) {
              bridge.reset();
            }
            clearHistory(appDir);
            onEvent({ type: 'status', status: 'idle', progress: 0, stage: 'Reset' });
            console.log(`[WS] Session reset for ${appDir}`);
            break;
          }

          case 'switch_app': {
            const newAppDir = msg.projectDir || ctx.projectDir || join(ctx.appsDir, msg.name);
            ctx.projectDir = msg.projectDir || ctx.projectDir || null;
            switchApp(ctx, newAppDir);
            const history = loadHistory(newAppDir);
            onEvent({ type: 'history', messages: history });
            console.log(`[WS] Switched to app: ${msg.name || basename(newAppDir)} (${history.length} history messages)`);
            break;
          }

          // --- Non-bridge handlers (unchanged) ---

          case 'deploy':
            await handleDeploy(ctx, onEvent, msg.target, msg.name, undefined, msg.app || undefined, !!msg.isPrivate);
            break;

          case 'save_theme': {
            const name = String(msg.name || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
            if (!name) {
              onEvent({ type: 'error', message: 'Theme name is required' });
              break;
            }
            await handleSaveTheme(ctx, onEvent, name, msg.model, msg.app || undefined);
            break;
          }

          case 'generate_image':
            await handleGenerateImage(ctx, onEvent, msg.prompt, msg.model);
            break;

          case 'palette_theme':
            await handlePaletteTheme(ctx, onEvent, msg.colors, msg.app || undefined);
            break;

          case 'window_control':
            if (ctx.onWindowControl) {
              ctx.onWindowControl(msg.action);
            }
            break;

          case 'delete_theme': {
            const themeId = String(msg.themeId || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
            if (!themeId) {
              onEvent({ type: 'error', message: 'Theme ID is required' });
              break;
            }
            const themeFile = join(ctx.themeDir, `${themeId}.txt`);
            if (!existsSync(themeFile)) {
              onEvent({ type: 'error', message: `Theme "${themeId}" not found` });
              break;
            }
            unlinkSync(themeFile);
            const catalogPath = join(ctx.themeDir, 'catalog.txt');
            if (existsSync(catalogPath)) {
              const catalog = readFileSync(catalogPath, 'utf-8');
              const updated = catalog.split('\n').filter(line => !line.includes(`| ${themeId} |`)).join('\n');
              writeFileSync(catalogPath, updated, 'utf-8');
            }
            reloadThemes(ctx);
            onEvent({ type: 'theme_deleted', themeId });
            console.log(`[DeleteTheme] Deleted theme "${themeId}"`);
            break;
          }

          case 'save_app': {
            const name = (msg.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
            if (!name) {
              onEvent({ type: 'error', message: 'App name is required' });
              break;
            }
            if (ctx.projectDir) {
              // Project folder mode: files already in place, just acknowledge
              if (!existsSync(join(ctx.projectDir, 'app.jsx'))) {
                onEvent({ type: 'error', message: 'No app.jsx to save' });
                break;
              }
              onEvent({ type: 'app_saved', name });
              console.log(`[Save] Project folder save acknowledged: ${ctx.projectDir}`);
            } else {
              // Legacy mode: copy to ~/.vibes/apps/
              const sourceApp = msg.app || undefined;
              const appSrc = resolveAppJsxPath(ctx, sourceApp);
              if (!existsSync(appSrc)) {
                onEvent({ type: 'error', message: 'No app.jsx to save' });
                break;
              }
              const dest = join(ctx.appsDir, name);
              mkdirSync(dest, { recursive: true });
              if (resolve(appSrc) !== resolve(join(dest, 'app.jsx'))) {
                copyFileSync(appSrc, join(dest, 'app.jsx'));
              }
              onEvent({ type: 'app_saved', name });
              console.log(`[Save] Saved app to ${dest}`);
            }
            break;
          }
        }
      } catch (err: any) {
        console.error('[WS] Handler error:', err);
        onEvent({ type: 'error', message: `Internal error: ${err.message}` });
      }
    },

    close(ws: ServerWebSocket<WsData>) {
      console.log('[WS] Client disconnected');
      connectedClients.delete(ws);

      // If no more clients, start grace period instead of immediate teardown
      if (connectedClients.size === 0) {
        console.log(`[WS] No clients — starting ${GRACE_PERIOD_MS / 1000}s grace period`);
        graceTimer = setTimeout(() => {
          graceTimer = null;
          console.log('[WS] Grace period expired — tearing down bridge');
          if (bridge) {
            bridge.kill();
            bridge = null;
          }
          cancelCurrent(); // Clean up any legacy operations too
        }, GRACE_PERIOD_MS);
      }
    },
  };
}

/**
 * Kill the session bridge. Called during server shutdown.
 */
export function killSessionBridge(): void {
  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  if (bridge) {
    bridge.kill();
    bridge = null;
  }
}
