#!/usr/bin/env node
/**
 * Deploy Vibes app to Cloudflare Workers via Deploy API
 *
 * Usage:
 *   bun scripts/deploy-cloudflare.js --name myapp --file index.html [--ai-key <openrouter-key>]
 *
 * Authenticates via OIDC (Pocket ID) and POSTs the assembled HTML to the
 * Deploy API Worker, which handles Cloudflare deployment, KV, secrets, and assets.
 */

import { readFileSync, existsSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { validateName, getApp, setApp, isFirstDeploy } from './lib/registry.js';
import { getAccessToken } from './lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';
import { PLUGIN_ROOT } from './lib/paths.js';
import { deployConnect } from './lib/alchemy-deploy.js';

const DEPLOY_API_URL = 'https://vibes-deploy-api.marcus-e.workers.dev';

async function deployViaAPI(name, files, accessToken, options = {}) {
  console.log(`Deploying ${name} (${Object.keys(files).length} file(s))...`);
  const body = { name, files };
  if (options.aiKey) {
    body.aiKey = options.aiKey;
  }

  const resp = await fetch(`${DEPLOY_API_URL}/deploy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(`Deploy failed: ${err.error || resp.statusText}`);
  }

  return resp.json();
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf("--name");
  const fileIdx = args.indexOf("--file");
  const appIdx = args.indexOf("--app");
  const aiKeyIdx = args.indexOf("--ai-key");

  if (nameIdx === -1) {
    throw new Error("Usage: deploy-cloudflare.js --name <app-name> (--app <app.jsx> | --file <index.html>) [--ai-key <key>]");
  }

  const name = validateName(args[nameIdx + 1]);
  // Cloudflare limits worker names with previews to 54 chars.
  // Longest prefix is "fireproof-dashboard-" (20 chars), so stage name max is 34.
  if (name.length > 34) {
    throw new Error(`App name "${name}" is ${name.length} chars — max is 34 for Cloudflare worker names. Use a shorter name.`);
  }
  const aiKey = aiKeyIdx !== -1 ? args[aiKeyIdx + 1] : (process.env.OPENROUTER_API_KEY || null);

  // Build HTML content — either assemble from app.jsx or read pre-assembled HTML
  let htmlContent;

  if (appIdx !== -1) {
    // Assemble from app.jsx
    const appFile = resolve(process.cwd(), args[appIdx + 1]);
    if (!existsSync(appFile)) throw new Error(`App file not found: ${appFile}`);

    const { execSync } = await import('child_process');
    const tmpOutput = resolve(process.cwd(), `.vibes-tmp-${name}.html`);
    try {
      execSync(`bun ${join(PLUGIN_ROOT, 'scripts/assemble.js')} "${appFile}" "${tmpOutput}"`, {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
      htmlContent = readFileSync(tmpOutput, 'utf8');
    } finally {
      try { unlinkSync(tmpOutput); } catch {}
    }
    console.log('Assembled app.jsx into template');
  } else {
    // Use pre-assembled HTML file
    const file = fileIdx !== -1 ? args[fileIdx + 1] : "index.html";
    const srcFile = resolve(process.cwd(), file);
    if (!existsSync(srcFile)) throw new Error(`File not found: ${srcFile}`);
    htmlContent = readFileSync(srcFile, 'utf8');
  }

  // --- Connect provisioning (registry is source of truth) ---
  let connectInfo = null;
  const existingApp = getApp(name);

  if (isFirstDeploy(name)) {
    console.log('\nProvisioning real-time sync (first deploy)...');
    const { randomBytes } = await import('crypto');
    let alchemyPassword = existingApp?.connect?.alchemyPassword || randomBytes(32).toString('hex');

    // Pre-save password so it survives crashes
    setApp(name, { name, connect: { alchemyPassword } });

    connectInfo = await deployConnect({
      appName: name,
      oidcAuthority: OIDC_AUTHORITY,
      oidcServiceWorkerName: 'pocket-id',
      alchemyPassword,
    });

    setApp(name, {
      name,
      connect: { ...connectInfo, deployedAt: new Date().toISOString() },
    });
    console.log(`Connect provisioned: ${connectInfo.apiUrl}`);
  } else {
    connectInfo = existingApp?.connect;
    if (connectInfo?.apiUrl) {
      console.log(`Reusing existing Connect: ${connectInfo.apiUrl}`);
    }
  }

  // Inject Connect URLs into HTML
  if (connectInfo?.apiUrl && connectInfo?.cloudUrl) {
    htmlContent = htmlContent.replace(
      /tokenApiUri:\s*"[^"]*"/,
      `tokenApiUri: "${connectInfo.apiUrl}"`
    );
    htmlContent = htmlContent.replace(
      /cloudBackendUrl:\s*"[^"]*"/,
      `cloudBackendUrl: "${connectInfo.cloudUrl}"`
    );
    console.log('Injected Connect URLs');
  }

  const files = {
    'index.html': htmlContent,
  };

  // Add OIDC bridge bundle if present
  const bridgePath = resolve(PLUGIN_ROOT, 'bundles/fireproof-oidc-bridge.js');
  if (existsSync(bridgePath)) {
    files['fireproof-oidc-bridge.js'] = readFileSync(bridgePath, 'utf8');
  }

  // Add AI hook bundle if present
  const aiBundlePath = resolve(PLUGIN_ROOT, 'bundles/vibes-ai.js');
  if (existsSync(aiBundlePath)) {
    files['vibes-ai.js'] = readFileSync(aiBundlePath, 'utf8');
  }

  // Include auth card SVGs
  const authCardsDir = resolve(PLUGIN_ROOT, 'assets/auth-cards');
  if (existsSync(authCardsDir)) {
    for (let i = 1; i <= 4; i++) {
      const p = resolve(authCardsDir, `card-${i}.svg`);
      if (existsSync(p)) files[`assets/auth-cards/card-${i}.svg`] = readFileSync(p, 'utf8');
    }
  }

  // Include favicon assets
  const faviconDir = resolve(PLUGIN_ROOT, 'assets/vibes-favicon');
  if (existsSync(faviconDir)) {
    const textAssets = ['favicon.svg', 'site.webmanifest'];
    const binaryAssets = ['favicon-96x96.png', 'favicon.ico', 'apple-touch-icon.png',
                          'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png'];
    for (const n of textAssets) {
      const p = resolve(faviconDir, n);
      if (existsSync(p)) files[`assets/vibes-favicon/${n}`] = readFileSync(p, 'utf8');
    }
    for (const n of binaryAssets) {
      const p = resolve(faviconDir, n);
      if (existsSync(p)) files[`assets/vibes-favicon/${n}`] = 'base64:' + readFileSync(p).toString('base64');
    }
  }

  console.log(`Deploying ${name} to Cloudflare Workers via Deploy API...`);

  // Authenticate via OIDC
  console.log("\nAuthenticating...");
  const tokens = await getAccessToken({
    authority: OIDC_AUTHORITY,
    clientId: OIDC_CLIENT_ID,
  });

  // Deploy via API
  const result = await deployViaAPI(name, files, tokens.accessToken, { aiKey });

  const deployedUrl = result.url || `https://${name}.vibesos.com`;

  // Save app metadata to registry
  setApp(name, {
    name,
    app: { workerName: name, url: deployedUrl },
  });

  console.log(`\nDeployed to ${deployedUrl}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
