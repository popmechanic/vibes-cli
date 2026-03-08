/**
 * Deploy handlers — assemble + deploy via the Deploy API.
 *
 * On first deploy, provisions a Fireproof Connect instance (dashboard +
 * cloud workers, R2, D1) for the app via alchemy. Connect URLs are injected
 * into the assembled HTML before sending to the Deploy API.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { getAccessToken } from '../../lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';
import { isFirstDeploy, getApp, setApp } from '../../lib/registry.js';
import { deployConnect } from '../../lib/alchemy-deploy.js';

const DEPLOY_API_URL = 'https://vibes-deploy-api.marcus-e.workers.dev';

/**
 * Assemble and deploy an app via the Deploy API.
 */
export async function handleDeploy(ctx, onEvent, target, name, token) {
  if (!target || target !== 'cloudflare') {
    onEvent({ type: 'error', message: 'Invalid deploy target. Use "cloudflare".' });
    return;
  }

  const appName = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
  if (!appName) {
    onEvent({ type: 'error', message: 'App name is required for deployment.' });
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

  // First assemble
  onEvent({ type: 'progress', progress: 5, stage: 'Assembling app...', elapsed: 0 });

  const appJsxPath = join(ctx.projectRoot, 'app.jsx');
  const indexHtmlPath = join(ctx.projectRoot, 'index.html');

  const assembleResult = await new Promise((resolve) => {
    const child = spawn('node', [
      join(ctx.projectRoot, 'scripts/assemble.js'),
      appJsxPath,
      indexHtmlPath,
    ], {
      cwd: ctx.projectRoot,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ ok: false, stdout: '', stderr: err.message });
    });
  });

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
  } catch (e) {
    console.error('[Deploy] Patch failed:', e.message);
  }

  // --- Connect provisioning ---
  // Check if this app already has a Connect instance or needs one provisioned.
  let connectInfo = null;
  const existingApp = getApp(appName);

  if (isFirstDeploy(appName)) {
    onEvent({ type: 'progress', progress: 15, stage: 'Setting up real-time sync...', elapsed: getElapsed() });
    try {
      // Check for saved alchemy password from a previous partial deploy.
      // Alchemy encrypts state with this password — losing it breaks re-deploys.
      const partialEntry = getApp(appName);
      let alchemyPassword = partialEntry?.connect?.alchemyPassword || null;
      if (!alchemyPassword) {
        const { randomBytes } = await import('crypto');
        alchemyPassword = randomBytes(32).toString('hex');
        // Pre-save so the password survives crashes
        setApp(appName, { ...(partialEntry || { name: appName }), name: appName, connect: { alchemyPassword } });
      }

      connectInfo = await deployConnect({
        appName,
        oidcAuthority: OIDC_AUTHORITY,
        oidcServiceWorkerName: 'pocket-id',
        alchemyPassword,
      });
      // Save Connect info to registry
      setApp(appName, {
        ...(existingApp || { name: appName }),
        name: appName,
        connect: {
          ...connectInfo,
          deployedAt: new Date().toISOString(),
        },
      });
      console.log(`[Deploy] Connect provisioned for ${appName}: ${connectInfo.apiUrl}`);
    } catch (err) {
      onEvent({ type: 'error', message: `Connect provisioning failed: ${err.message}` });
      return;
    }
  } else {
    connectInfo = existingApp.connect;
    console.log(`[Deploy] Reusing existing Connect for ${appName}: ${connectInfo.apiUrl}`);
  }

  // Inject Connect URLs into the assembled HTML
  if (connectInfo?.apiUrl && connectInfo?.cloudUrl) {
    let html = readFileSync(indexHtmlPath, 'utf8');
    html = html.replace(
      /tokenApiUri:\s*"[^"]*"/,
      `tokenApiUri: "${connectInfo.apiUrl}"`
    );
    html = html.replace(
      /cloudBackendUrl:\s*"[^"]*"/,
      `cloudBackendUrl: "${connectInfo.cloudUrl}"`
    );
    writeFileSync(indexHtmlPath, html);
    console.log(`[Deploy] Injected Connect URLs into index.html`);
  }

  onEvent({ type: 'progress', progress: 30, stage: 'Deploying...', elapsed: getElapsed() });

  // Build the files map for the Deploy API
  const files = {
    'index.html': readFileSync(indexHtmlPath, 'utf8'),
  };

  // Include the OIDC bridge bundle so it's served alongside the app
  const bridgePath = join(ctx.projectRoot, 'bundles/fireproof-oidc-bridge.js');
  if (existsSync(bridgePath)) {
    files['fireproof-oidc-bridge.js'] = readFileSync(bridgePath, 'utf8');
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

    const result = await response.json();
    deployUrl = result.url || '';
  } catch (err) {
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
  } catch (e) {
    console.error('[Deploy] Failed to save app metadata:', e.message);
  }

  onEvent({ type: 'progress', progress: 100, stage: 'Done!', elapsed: getElapsed() });
  onEvent({ type: 'deploy_complete', url: deployUrl, name: appName });

  console.log(`[Deploy] cloudflare deploy "${appName}" complete${deployUrl ? `: ${deployUrl}` : ''}`);
}
