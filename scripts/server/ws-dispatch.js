/**
 * WebSocket dispatch — thin message router with a dispatch table.
 */

import { existsSync, mkdirSync, copyFileSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cancelClaude } from './claude-bridge.js';
import { handleChat } from './handlers/chat.js';
import { handleThemeSwitch, handlePaletteTheme } from './handlers/theme.js';
import { handleGenerate } from './handlers/generate.js';
import { handleDeploy } from './handlers/deploy.js';
import { handleSaveTheme } from './handlers/create-theme.js';
import { handleGenerateImage } from './handlers/image-gen.js';
import { reloadThemes } from './config.js';

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

/**
 * Wire up WebSocket message handling on a WSS instance.
 */
export function setupWebSocket(wss, ctx, wsAdapter) {
  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    const onEvent = wsAdapter(ws, wss);
    const dispatch = {
      chat:             (msg) => handleChat(ctx, onEvent, msg.message, msg.effects || [], msg.animationId || null, msg.model, msg.reference || null),
      theme:            (msg) => handleThemeSwitch(ctx, onEvent, msg.themeId, msg.model),
      cancel:           ()    => { if (!cancelClaude()) onEvent({ type: 'error', message: 'No request in progress.' }); },
      generate:         (msg) => handleGenerate(ctx, onEvent, msg.prompt, msg.themeId, msg.model, msg.reference || null),
      deploy:           (msg) => handleDeploy(ctx, onEvent, msg.target, msg.name, msg.token),
      save_theme:       (msg) => {
        const name = String(msg.name || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
        if (!name) { onEvent({ type: 'error', message: 'Theme name is required' }); return; }
        return handleSaveTheme(ctx, onEvent, name, msg.model);
      },
      generate_image:   (msg) => handleGenerateImage(ctx, onEvent, msg.prompt, msg.model),
      palette_theme:    (msg) => handlePaletteTheme(ctx, onEvent, msg.colors),
      delete_theme:     (msg) => {
        const themeId = String(msg.themeId || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
        if (!themeId) { onEvent({ type: 'error', message: 'Theme ID is required' }); return; }
        const themeFile = join(ctx.themeDir, `${themeId}.txt`);
        if (!existsSync(themeFile)) { onEvent({ type: 'error', message: `Theme "${themeId}" not found` }); return; }
        unlinkSync(themeFile);
        // Remove from catalog.txt
        const catalogPath = join(ctx.themeDir, 'catalog.txt');
        if (existsSync(catalogPath)) {
          const catalog = readFileSync(catalogPath, 'utf-8');
          const updated = catalog.split('\n').filter(line => !line.includes(`| ${themeId} |`)).join('\n');
          writeFileSync(catalogPath, updated, 'utf-8');
        }
        reloadThemes(ctx);
        onEvent({ type: 'theme_deleted', themeId });
        console.log(`[DeleteTheme] Deleted theme "${themeId}"`);
      },
      save_app:         (msg) => {
        const name = (msg.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
        if (!name) { onEvent({ type: 'error', message: 'App name is required' }); return; }
        const appSrc = join(ctx.projectRoot, 'app.jsx');
        if (!existsSync(appSrc)) { onEvent({ type: 'error', message: 'No app.jsx to save' }); return; }
        const dest = join(ctx.appsDir, name);
        mkdirSync(dest, { recursive: true });
        copyFileSync(appSrc, join(dest, 'app.jsx'));
        onEvent({ type: 'app_saved', name });
        console.log(`[Save] Saved app to ${dest}`);
      },
    };

    ws.on('message', async (raw) => {
      const msg = safeParseJSON(raw);
      if (!msg) { onEvent({ type: 'error', message: 'Invalid JSON' }); return; }
      if (msg.type === 'chat') {
        console.log(`[WS] chat msg keys:`, Object.keys(msg), msg.reference ? `ref: ${msg.reference.name} (${msg.reference.dataUrl?.length} chars)` : 'no ref');
      }
      const handler = dispatch[msg.type];
      if (!handler) return;
      try { await handler(msg); }
      catch (err) {
        console.error('[WS] Handler error:', err);
        onEvent({ type: 'error', message: `Internal error: ${err.message}` });
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      // Don't cancel Claude on disconnect — the client auto-reconnects
      // and the generation should continue. Only explicit 'cancel' messages
      // should abort the subprocess.
    });
  });
}
