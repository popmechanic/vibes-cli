/**
 * Deploy handlers — assemble + deploy via the Deploy API.
 *
 * Connect provisioning is handled server-side by the Deploy API Worker.
 * The CLI just sends files and reads back Connect URLs from the response.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { getAccessToken } from '../../lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';
import { getApp, setApp } from '../../lib/registry.js';
import { runBunScript } from '../claude-bridge.ts';
import type { EventCallback } from '../claude-bridge.ts';
import type { ServerContext } from '../config.ts';
import { currentAppDir } from '../app-context.js';

const DEPLOY_API_URL = 'https://vibes-deploy-api.marcus-e.workers.dev';

/**
 * Assemble and deploy an app via the Deploy API.
 */
export async function handleDeploy(ctx: ServerContext, onEvent: EventCallback, target: string, name: string, token?: string) {
  if (!target || target !== 'cloudflare') {
    onEvent({ type: 'error', message: 'Invalid deploy target. Use "cloudflare".' });
    return;
  }

  const appName = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
  if (!appName) {
    onEvent({ type: 'error', message: 'App name is required for deployment.' });
    return;
  }
  // Cloudflare limits worker names with previews to 54 chars.
  // Longest prefix is "fireproof-dashboard-" (20 chars), so stage name max is 34.
  if (appName.length > 34) {
    onEvent({ type: 'error', message: `App name "${appName}" is ${appName.length} chars — max is 34 for Cloudflare worker names. Use a shorter name.` });
    return;
  }

  // Auto-obtain token via Pocket ID if not provided by client
  if (!token) {
    onEvent({ type: 'progress', progress: 1, stage: 'Checking authentication...', elapsed: 0 });
    try {
      const tokens = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID, silent: true });
      if (!tokens) {
        onEvent({ type: 'auth_required' });
        return;
      }
      token = tokens.accessToken;
    } catch (err) {
      onEvent({ type: 'auth_required' });
      return;
    }
  }

  const startTime = Date.now();
  function getElapsed() { return Math.round((Date.now() - startTime) / 1000); }

  onEvent({ type: 'progress', progress: 5, stage: 'Assembling app...', elapsed: 0 });

  const appDir = currentAppDir(ctx);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app active. Generate or load an app first.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
  const indexHtmlPath = join(appDir, 'index.html');

  const assembleResult = await runBunScript(
    join(ctx.projectRoot, 'scripts/assemble.js'),
    [appJsxPath, indexHtmlPath],
    { cwd: ctx.projectRoot },
  );

  if (!assembleResult.ok) {
    onEvent({ type: 'error', message: `Assembly failed: ${assembleResult.stderr.slice(0, 2000)}` });
    return;
  }

  // Patch assembled HTML so the app's background shows through the template frame
  try {
    const appCode = readFileSync(appJsxPath, 'utf8');
    let html = readFileSync(indexHtmlPath, 'utf8');

    const rootMatch = appCode.match(/:root\s*\{([^}]+)\}/);
    let bgColor = '';
    if (rootMatch) {
      const bgMatch = rootMatch[1].match(/--color-background\s*:\s*([^;]+)/);
      if (bgMatch) bgColor = bgMatch[1].trim();
    }
    if (!bgColor) {
      const bodyBgMatch = appCode.match(/body\s*\{[^}]*background\s*:\s*([^;]+)/);
      if (bodyBgMatch) bgColor = bodyBgMatch[1].trim();
    }

    // Sanitize bgColor — reject characters that could break out of CSS value or HTML context
    if (bgColor && /[;{}<>"']/.test(bgColor)) {
      console.warn(`[Deploy] Rejected suspicious bgColor value: ${bgColor.slice(0, 50)}`);
      bgColor = '';
    }
    const bg = bgColor || 'inherit';

    const headPatch = `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <style>
      #container { padding: 10px !important; }
      body::before { background-color: ${bg} !important; }
    </style>`;
    html = html.replace('</head>', headPatch + '\n</head>');

    const bodyPatch = `<style>
      div[style*="z-index: 10"][style*="position: fixed"] { background: ${bg} !important; }
    </style>`;
    html = html.replace('</body>', bodyPatch + '\n</body>');

    writeFileSync(indexHtmlPath, html);
    console.log('[Deploy] Patched body::before background' + (bgColor ? `: ${bgColor}` : ''));
  } catch (e: any) {
    console.error('[Deploy] Patch failed:', e.message);
  }

  onEvent({ type: 'progress', progress: 30, stage: 'Deploying...', elapsed: getElapsed() });

  // Build the files map for the Deploy API
  const files: Record<string, string> = {
    'index.html': readFileSync(indexHtmlPath, 'utf8'),
  };

  // Include the OIDC bridge bundle so it's served alongside the app
  const bridgePath = join(ctx.projectRoot, 'bundles/fireproof-oidc-bridge.js');
  if (existsSync(bridgePath)) {
    files['fireproof-oidc-bridge.js'] = readFileSync(bridgePath, 'utf8');
  }

  // Include the AI hook bundle
  const aiBundlePath = join(ctx.projectRoot, 'bundles/vibes-ai.js');
  if (existsSync(aiBundlePath)) {
    files['vibes-ai.js'] = readFileSync(aiBundlePath, 'utf8');
  }

  // Include auth card SVG assets for deployed apps
  const authCardsDir = join(ctx.projectRoot, 'assets/auth-cards');
  if (existsSync(authCardsDir)) {
    for (const name of ['card-1.svg', 'card-2.svg', 'card-3.svg', 'card-4.svg']) {
      const p = join(authCardsDir, name);
      if (existsSync(p)) files[`assets/auth-cards/${name}`] = readFileSync(p, 'utf8');
    }
  }

  // Include favicon assets for deployed apps
  const faviconDir = join(ctx.projectRoot, 'assets/vibes-favicon');
  if (existsSync(faviconDir)) {
    const textAssets = ['favicon.svg', 'site.webmanifest'];
    const binaryAssets = ['favicon-96x96.png', 'favicon.ico', 'apple-touch-icon.png',
                          'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png'];
    for (const name of textAssets) {
      const p = join(faviconDir, name);
      if (existsSync(p)) files[`assets/vibes-favicon/${name}`] = readFileSync(p, 'utf8');
    }
    for (const name of binaryAssets) {
      const p = join(faviconDir, name);
      if (existsSync(p)) files[`assets/vibes-favicon/${name}`] = 'base64:' + readFileSync(p).toString('base64');
    }
  }

  // Deploy via the Deploy API
  let deployUrl = '';
  try {
    const progressInterval = setInterval(() => {
      const elapsed = getElapsed();
      const progress = Math.min(30 + Math.round(60 * (1 - Math.exp(-elapsed / 30))), 90);
      onEvent({ type: 'progress', progress, stage: 'Deploying...', elapsed });
    }, 1000);

    const response = await fetch(`${DEPLOY_API_URL}/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ name: appName, files }),
    });

    clearInterval(progressInterval);

    if (!response.ok) {
      const errorText = await response.text();
      onEvent({ type: 'error', message: `Deploy failed (${response.status}): ${errorText.slice(0, 2000)}` });
      return;
    }

    const result: any = await response.json();
    deployUrl = result.url || '';

    // Save Connect info from Deploy API response
    if (result.connect) {
      const appEntry = getApp(appName) || { name: appName };
      setApp(appName, {
        ...appEntry,
        name: appName,
        connect: {
          apiUrl: result.connect.apiUrl,
          cloudUrl: result.connect.cloudUrl,
          deployedAt: new Date().toISOString(),
        },
      });
      console.log(`[Deploy] Connect provisioned: ${result.connect.apiUrl}`);
    }
  } catch (err: any) {
    onEvent({ type: 'error', message: `Deploy failed: ${err.message}` });
    return;
  }

  // Save deployed app.jsx and update registry with app metadata
  try {
    const saveDest = join(ctx.appsDir, appName);
    mkdirSync(saveDest, { recursive: true });
    copyFileSync(appJsxPath, join(saveDest, 'app.jsx'));
    console.log(`[Deploy] Saved deployed app.jsx to ${saveDest}`);

    const appEntry = getApp(appName) || { name: appName };
    setApp(appName, {
      ...appEntry,
      app: { workerName: appName, url: deployUrl },
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[Deploy] Failed to save app metadata:', e.message);
  }

  onEvent({ type: 'progress', progress: 100, stage: 'Done!', elapsed: getElapsed() });
  onEvent({ type: 'deploy_complete', url: deployUrl, name: appName });

  console.log(`[Deploy] cloudflare deploy "${appName}" complete${deployUrl ? `: ${deployUrl}` : ''}`);
}
