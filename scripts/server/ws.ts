/**
 * WebSocket handler — Bun native WebSocket with event translation.
 *
 * Replaces ws-dispatch.js with Bun.serve websocket handler pattern.
 * Includes the event translation layer (internal events -> client messages).
 */

import { existsSync, mkdirSync, copyFileSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ServerWebSocket } from 'bun';
import type { ServerContext } from './config.ts';
import { reloadThemes } from './config.ts';
import { cancelCurrent, type EventCallback } from './claude-bridge.ts';
import { handleChat } from './handlers/chat.ts';
import { handleThemeSwitch, handlePaletteTheme } from './handlers/theme.ts';
import { handleGenerate } from './handlers/generate.ts';
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
    const msgs: object[] = [
      { type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: event.elapsed },
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
    } catch {
      // ws may be closed
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

// --- WebSocket Handler ---

export function createWsHandler(ctx: ServerContext) {
  return {
    maxPayloadLength: 50 * 1024 * 1024, // 50MB for image refs
    idleTimeout: 255,

    open(ws: ServerWebSocket<WsData>) {
      console.log('[WS] Client connected');
      ws.data.onEvent = createEventAdapter(ws);
      connectedClients.add(ws);
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

      try {
        switch (msg.type) {
          case 'chat':
            await handleChat(ctx, onEvent, msg.message, msg.effects || [], msg.animationId || null, msg.model, msg.reference || null);
            break;

          case 'generate':
            await handleGenerate(ctx, onEvent, msg.prompt, msg.themeId, msg.model, msg.reference || null);
            break;

          case 'theme':
            await handleThemeSwitch(ctx, onEvent, msg.themeId, msg.model);
            break;

          case 'cancel':
            if (!cancelCurrent()) {
              onEvent({ type: 'error', message: 'No request in progress.' });
            }
            break;

          case 'deploy':
            await handleDeploy(ctx, onEvent, msg.target, msg.name);
            break;

          case 'save_theme': {
            const name = String(msg.name || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
            if (!name) {
              onEvent({ type: 'error', message: 'Theme name is required' });
              break;
            }
            await handleSaveTheme(ctx, onEvent, name, msg.model);
            break;
          }

          case 'generate_image':
            await handleGenerateImage(ctx, onEvent, msg.prompt, msg.model);
            break;

          case 'palette_theme':
            await handlePaletteTheme(ctx, onEvent, msg.colors);
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
            const appSrc = join(ctx.projectRoot, 'app.jsx');
            if (!existsSync(appSrc)) {
              onEvent({ type: 'error', message: 'No app.jsx to save' });
              break;
            }
            const dest = join(ctx.appsDir, name);
            mkdirSync(dest, { recursive: true });
            copyFileSync(appSrc, join(dest, 'app.jsx'));
            onEvent({ type: 'app_saved', name });
            console.log(`[Save] Saved app to ${dest}`);
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
      // If no more clients, cancel active operations
      if (connectedClients.size === 0) {
        cancelCurrent();
      }
    },
  };
}
