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
import { resolve, dirname, join } from "path";
import { buildPlatformFiles, addAppAssets, separateBySize } from './lib/deploy-files.js';
import { validateName, getApp, setApp } from './lib/registry.js';
import { getAccessToken } from './lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL } from './lib/auth-constants.js';
import { PLUGIN_ROOT } from './lib/paths.js';
import { provisionInviteLink } from './lib/provision-invite-link.js';
import { readVibesJson, writeVibesJson } from './lib/vibes-json.js';

async function deployViaAPI(name, files, accessToken, options = {}) {
  console.log(`Deploying ${name} (${Object.keys(files).length} file(s))...`);
  const body = { name, files };
  if (options.aiKey) {
    body.aiKey = options.aiKey;
  }

  const payload = JSON.stringify(body);
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${DEPLOY_API_URL}/deploy`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        // Don't retry client errors (4xx) — only server/transport failures
        if (resp.status >= 400 && resp.status < 500) {
          throw new Error(`Deploy failed: ${err.error || resp.statusText}`);
        }
        throw new Error(`Deploy failed (${resp.status}): ${err.error || resp.statusText}`);
      }

      return resp.json();
    } catch (e) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) throw e;

      const delay = attempt * 2000; // 2s, 4s
      console.log(`Deploy attempt ${attempt} failed: ${e.message}`);
      console.log(`Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf("--name");
  const fileIdx = args.indexOf("--file");
  const appIdx = args.indexOf("--app");
  const aiKeyIdx = args.indexOf("--ai-key");

  let name;
  if (nameIdx !== -1) {
    name = validateName(args[nameIdx + 1]);
  } else {
    // Try to read name from vibes.json in current directory
    const config = readVibesJson(process.cwd());
    if (config?.name) {
      name = validateName(config.name);
      console.log(`Using app name from vibes.json: ${name}`);
    } else {
      throw new Error("Usage: deploy-cloudflare.js --name <app-name> (--app <app.jsx> | --file <index.html>) [--ai-key <key>]");
    }
  }
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

  const files = {
    'index.html': htmlContent,
    ...buildPlatformFiles(PLUGIN_ROOT),
  };

  // Include app-level assets (assets/ directory next to the app file)
  const appDir = appIdx !== -1
    ? dirname(resolve(process.cwd(), args[appIdx + 1]))
    : fileIdx !== -1
      ? dirname(resolve(process.cwd(), args[fileIdx + 1]))
      : process.cwd();
  addAppAssets(resolve(appDir, 'assets'), files);
  const assetCount = Object.keys(files).filter(k => k.startsWith('assets/')).length;
  if (assetCount > 0) console.log(`Included ${assetCount} asset file(s)`);

  console.log(`Deploying ${name} to Cloudflare Workers via Deploy API...`);

  // Authenticate via OIDC
  console.log("\nAuthenticating...");
  const tokens = await getAccessToken({
    authority: OIDC_AUTHORITY,
    clientId: OIDC_CLIENT_ID,
  });

  // Separate large files for R2 upload
  const { embed, r2: r2Files } = separateBySize(files);
  if (Object.keys(r2Files).length > 0) {
    console.log(`Uploading ${Object.keys(r2Files).length} large asset(s) to R2...`);
    try {
      const r2Resp = await fetch(`${DEPLOY_API_URL}/apps/${name}/assets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: r2Files }),
      });
      if (r2Resp.ok) {
        console.log('R2 assets uploaded successfully');
      } else {
        const errText = await r2Resp.text();
        console.warn(`R2 upload warning: ${errText}`);
      }
    } catch (e) {
      console.warn(`R2 upload warning: ${e.message}`);
    }
  }

  // Deploy with only embedded files (small files stay in worker script)
  const result = await deployViaAPI(name, embed, tokens.accessToken, { aiKey });

  const deployedUrl = result.url || `https://${name}.vibesos.com`;

  // Save app metadata to registry
  setApp(name, {
    name,
    app: { workerName: name, url: deployedUrl },
    wsUrl: result.wsUrl,
  });

  // Write deploy info to vibes.json if in a project folder
  const deployDir = appIdx !== -1
    ? dirname(resolve(process.cwd(), args[appIdx + 1]))
    : process.cwd();
  if (existsSync(join(deployDir, 'vibes.json'))) {
    writeVibesJson(deployDir, {
      deploy: {
        url: deployedUrl,
        workerName: `vibes-app-${name}`,
        deployedAt: new Date().toISOString(),
      },
    });
    console.log('Updated vibes.json with deploy info');
  }

  // Auto-provision public invite link for private apps (fire-and-forget)
  await provisionInviteLink(DEPLOY_API_URL, name, tokens.accessToken);

  console.log(`\nDeployed to ${deployedUrl}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
