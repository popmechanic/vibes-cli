/**
 * WebSocket dispatch — thin message router with a dispatch table.
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { cancelClaude } from './claude-bridge.js';
import { handleChat } from './handlers/chat.js';
import { handleThemeSwitch, handlePaletteTheme } from './handlers/theme.js';
import { handleGenerate } from './handlers/generate.js';
import { handleDeploy, handleDeployStudio } from './handlers/deploy.js';
import { handleCreateTheme, handlePickThemeImage } from './handlers/create-theme.js';

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

    const onEvent = wsAdapter(ws);
    // Per-connection state (e.g., pending theme images)
    const connState = { pendingImages: null };

    const dispatch = {
      chat:             (msg) => handleChat(ctx, onEvent, msg.message, msg.effects || [], msg.animationId || null, msg.model),
      theme:            (msg) => handleThemeSwitch(ctx, onEvent, msg.themeId, msg.model),
      cancel:           ()    => { if (!cancelClaude()) onEvent({ type: 'error', message: 'No request in progress.' }); },
      generate:         (msg) => handleGenerate(ctx, onEvent, msg.prompt, msg.themeId, msg.model),
      deploy:           (msg) => handleDeploy(ctx, onEvent, msg.target, msg.name),
      create_theme:     (msg) => {
        const prompt = String(msg.prompt || '').replace(/[\x00-\x1f]/g, '').slice(0, 500);
        if (!prompt) { onEvent({ type: 'error', message: 'Prompt is required' }); return; }
        return handleCreateTheme(ctx, onEvent, prompt, msg.model, connState);
      },
      pick_theme_image: (msg) => {
        const prompt = String(msg.prompt || '').replace(/[\x00-\x1f]/g, '').slice(0, 500);
        return handlePickThemeImage(ctx, onEvent, msg.index, prompt, msg.model, connState);
      },
      palette_theme:    (msg) => handlePaletteTheme(ctx, onEvent, msg.colors),
      'deploy-studio':  (msg) => handleDeployStudio(ctx, onEvent, msg.studioName, msg.clerkPublishableKey, msg.clerkSecretKey),
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
      cancelClaude();
    });
  });
}
