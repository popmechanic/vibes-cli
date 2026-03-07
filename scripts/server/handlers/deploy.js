/**
 * Deploy handlers — assemble + deploy via the Deploy API.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const DEPLOY_API_URL = 'https://vibes-deploy-api.vibes.diy';

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

  if (!token) {
    onEvent({ type: 'error', message: 'Authentication token is required for deployment.' });
    return;
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

  // Save the deployed version to ~/.vibes/apps/
  try {
    const saveDest = join(ctx.appsDir, appName);
    mkdirSync(saveDest, { recursive: true });
    copyFileSync(appJsxPath, join(saveDest, 'app.jsx'));
    console.log(`[Deploy] Saved deployed app.jsx to ${saveDest}`);
  } catch (e) {
    console.error('[Deploy] Failed to save app.jsx:', e.message);
  }

  onEvent({ type: 'progress', progress: 100, stage: 'Done!', elapsed: getElapsed() });
  onEvent({ type: 'deploy_complete', url: deployUrl, name: appName });
  onEvent({ type: 'chat', role: 'assistant', content: deployUrl ? `Deployed to ${deployUrl}` : 'Deployment complete!' });

  console.log(`[Deploy] cloudflare deploy "${appName}" complete${deployUrl ? `: ${deployUrl}` : ''}`);
}
