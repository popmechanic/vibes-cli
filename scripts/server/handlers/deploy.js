/**
 * Deploy handlers — assemble + deploy to Cloudflare.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { getCloudflareConfig } from '../../lib/registry.js';

/**
 * Build a process.env copy with Cloudflare registry credentials injected.
 * Used only by the deploy subprocess (not assembly).
 */
function getRegistryEnv() {
  const env = { ...process.env };
  const cf = getCloudflareConfig();
  // Only inject the active auth method — API Token takes precedence
  if (cf.apiToken) {
    if (!env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = cf.apiToken;
  } else {
    if (cf.apiKey && !env.CLOUDFLARE_API_KEY) env.CLOUDFLARE_API_KEY = cf.apiKey;
    if (cf.email && !env.CLOUDFLARE_EMAIL) env.CLOUDFLARE_EMAIL = cf.email;
  }
  return env;
}

/**
 * Assemble and deploy an app to Cloudflare.
 */
export async function handleDeploy(ctx, onEvent, target, name) {
  if (!target || target !== 'cloudflare') {
    onEvent({ type: 'error', message: 'Invalid deploy target. Use "cloudflare".' });
    return;
  }

  const appName = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
  if (!appName) {
    onEvent({ type: 'error', message: 'App name is required for deployment.' });
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
    onEvent({ type: 'error', message: `Assembly failed: ${assembleResult.stderr.slice(0, 300)}` });
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

  const deployScript = join(ctx.projectRoot, 'scripts/deploy-cloudflare.js');
  const deployArgs = ['--name', appName, '--file', indexHtmlPath];

  const deployResult = await new Promise((resolve) => {
    const child = spawn('node', [deployScript, ...deployArgs], {
      cwd: ctx.projectRoot,
      env: getRegistryEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const progressInterval = setInterval(() => {
      const elapsed = getElapsed();
      const progress = Math.min(30 + Math.round(60 * (1 - Math.exp(-elapsed / 30))), 90);
      onEvent({ type: 'progress', progress, stage: 'Deploying...', elapsed });
    }, 1000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearInterval(progressInterval);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      clearInterval(progressInterval);
      resolve({ ok: false, stdout: '', stderr: err.message });
    });
  });

  if (!deployResult.ok) {
    onEvent({ type: 'error', message: `Deploy failed: ${deployResult.stderr.slice(0, 600)}` });
    return;
  }

  // Extract the APP URL from deploy output (not Connect infrastructure URLs).
  // deploy-cloudflare.js prints "✅ Deployed to <url>" as its final URL line —
  // match that specifically. Fall back to the last URL in stdout if the pattern
  // isn't found (e.g. future output changes).
  let deployUrl = '';
  const deployedToMatch = deployResult.stdout.match(/Deployed to\s+(https?:\/\/[^\s]+)/);
  if (deployedToMatch) {
    deployUrl = deployedToMatch[1];
  } else {
    // Fallback: grab the last URL in stdout (app URL is always printed last)
    const allUrls = [...deployResult.stdout.matchAll(/(https?:\/\/[^\s]+)/g)];
    if (allUrls.length) deployUrl = allUrls[allUrls.length - 1][1];
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
