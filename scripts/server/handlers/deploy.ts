/**
 * Deploy handlers — assemble + deploy to Cloudflare.
 * Uses Bun.spawn for subprocess management.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getCloudflareConfig } from '../../lib/registry.js';
import { currentAppDir } from '../app-context.js';
import { runBunScript, type EventCallback } from '../claude-bridge.ts';
import type { ServerContext } from '../config.ts';

/**
 * Build env for the deploy subprocess.
 * Only injects registry credentials if wrangler's own OAuth config is missing.
 * This prevents stale API tokens from overriding a valid `npx wrangler login` session.
 */
function getRegistryEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  // If wrangler already has OAuth credentials, don't inject registry tokens
  const hasWranglerOAuth = existsSync(join(process.env.HOME || '', '.wrangler', 'config', 'default.toml'));
  if (hasWranglerOAuth && !env.CLOUDFLARE_API_TOKEN && !env.CLOUDFLARE_API_KEY) {
    return env;
  }
  const cf = getCloudflareConfig();
  if (cf.apiToken) {
    if (!env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = cf.apiToken;
  } else {
    if (cf.apiKey && !env.CLOUDFLARE_API_KEY) env.CLOUDFLARE_API_KEY = cf.apiKey;
    if (cf.email && !env.CLOUDFLARE_EMAIL) env.CLOUDFLARE_EMAIL = cf.email;
  }
  return env;
}

export async function handleDeploy(
  ctx: ServerContext,
  onEvent: EventCallback,
  target: string,
  name: string,
): Promise<void> {
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

    // Sanitize bgColor — reject characters that could break out of CSS value context
    if (bgColor && /[;{}]/.test(bgColor)) {
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

  const deployScript = join(ctx.projectRoot, 'scripts/deploy-cloudflare.js');
  const deployArgs = ['--name', appName, '--file', indexHtmlPath];

  // Progress updates during deploy
  const progressInterval = setInterval(() => {
    const elapsed = getElapsed();
    const progress = Math.min(30 + Math.round(60 * (1 - Math.exp(-elapsed / 30))), 90);
    onEvent({ type: 'progress', progress, stage: 'Deploying...', elapsed });
  }, 1000);

  const deployResult = await runBunScript(deployScript, deployArgs, {
    cwd: ctx.projectRoot,
    env: getRegistryEnv(),
  });

  clearInterval(progressInterval);

  if (!deployResult.ok) {
    onEvent({ type: 'error', message: `Deploy failed: ${deployResult.stderr.slice(0, 600)}` });
    return;
  }

  // Extract deploy URL
  let deployUrl = '';
  const deployedToMatch = deployResult.stdout.match(/Deployed to\s+(https?:\/\/[^\s]+)/);
  if (deployedToMatch) {
    deployUrl = deployedToMatch[1];
  } else {
    const allUrls = [...deployResult.stdout.matchAll(/(https?:\/\/[^\s]+)/g)];
    if (allUrls.length) deployUrl = allUrls[allUrls.length - 1][1];
  }

  // App is already in its directory — no need to copy
  console.log(`[Deploy] App "${appName}" deployed from ${appDir}`);

  onEvent({ type: 'progress', progress: 100, stage: 'Done!', elapsed: getElapsed() });
  onEvent({ type: 'deploy_complete', url: deployUrl, name: appName });
  onEvent({ type: 'chat', role: 'assistant', content: deployUrl ? `Deployed to ${deployUrl}` : 'Deployment complete!' });

  console.log(`[Deploy] cloudflare deploy "${appName}" complete${deployUrl ? `: ${deployUrl}` : ''}`);
}
