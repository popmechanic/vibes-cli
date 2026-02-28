/**
 * Deploy handlers — assemble + deploy to Cloudflare or exe.dev.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

/**
 * Assemble and deploy an app to Cloudflare or exe.dev.
 */
export async function handleDeploy(ctx, onEvent, target, name) {
  if (!target || (target !== 'cloudflare' && target !== 'exe')) {
    onEvent({ type: 'error', message: 'Invalid deploy target. Use "cloudflare" or "exe".' });
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

  const deployScript = target === 'cloudflare'
    ? join(ctx.projectRoot, 'scripts/deploy-cloudflare.js')
    : join(ctx.projectRoot, 'scripts/deploy-exe.js');

  const deployArgs = target === 'cloudflare'
    ? ['--name', appName, '--file', indexHtmlPath]
    : ['--name', appName, '--file', indexHtmlPath, '--skip-registry'];

  const deployResult = await new Promise((resolve) => {
    const child = spawn('node', [deployScript, ...deployArgs], {
      cwd: ctx.projectRoot,
      env: { ...process.env },
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
    onEvent({ type: 'error', message: `Deploy failed: ${deployResult.stderr.slice(0, 300)}` });
    return;
  }

  // Extract URL from deploy output
  let deployUrl = '';
  const urlMatch = deployResult.stdout.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) deployUrl = urlMatch[1];

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

  console.log(`[Deploy] ${target} deploy "${appName}" complete${deployUrl ? `: ${deployUrl}` : ''}`);
}

/**
 * Deploy a Connect Studio to exe.dev.
 */
export async function handleDeployStudio(ctx, onEvent, studioName, clerkPublishableKey, clerkSecretKey) {
  if (!studioName) {
    onEvent({ type: 'studio-error', message: 'Studio name is required' });
    return;
  }
  if (!clerkPublishableKey) {
    onEvent({ type: 'studio-error', message: 'Clerk publishable key is required' });
    return;
  }
  if (!clerkSecretKey) {
    onEvent({ type: 'studio-error', message: 'Clerk secret key is required' });
    return;
  }

  const { deriveConnectUrls, writeEnvFile } = await import('../../lib/env-utils.js');

  const deployScript = join(ctx.projectRoot, 'scripts/deploy-connect.js');
  const args = [
    deployScript,
    '--studio', studioName,
    '--clerk-publishable-key', clerkPublishableKey,
    '--clerk-secret-key', clerkSecretKey,
  ];

  console.log(`[Studio] Deploying Connect studio "${studioName}"...`);
  onEvent({ type: 'studio-progress', line: `Deploying Connect studio "${studioName}"...` });

  const result = await new Promise((resolve) => {
    const child = spawn('node', args, {
      cwd: ctx.projectRoot,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      for (const line of text.split('\n').filter(Boolean)) {
        try { onEvent({ type: 'studio-progress', line }); } catch { /* ws may be closed */ }
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      for (const line of text.split('\n').filter(Boolean)) {
        try { onEvent({ type: 'studio-progress', line }); } catch { /* ws may be closed */ }
      }
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ ok: false, stdout: '', stderr: err.message });
    });
  });

  if (!result.ok) {
    onEvent({ type: 'studio-error', message: `Studio deploy failed: ${result.stderr.slice(0, 300)}` });
    console.error(`[Studio] Deploy failed: ${result.stderr.slice(0, 200)}`);
    return;
  }

  const { apiUrl, cloudUrl } = deriveConnectUrls(studioName);
  writeEnvFile(ctx.projectRoot, {
    VITE_API_URL: apiUrl,
    VITE_CLOUD_URL: cloudUrl,
  });

  onEvent({ type: 'studio-complete', apiUrl, cloudUrl });
  console.log(`[Studio] Deploy complete: ${apiUrl}`);
}
