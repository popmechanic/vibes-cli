#!/usr/bin/env node
/**
 * Deploy Vibes app to Cloudflare Workers via Deploy API
 *
 * Usage:
 *   node scripts/deploy-cloudflare.js --name myapp --file index.html [--ai-key <openrouter-key>]
 *
 * Authenticates via OIDC (Pocket ID) and POSTs the assembled HTML to the
 * Deploy API Worker, which handles Cloudflare deployment, KV, secrets, and assets.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { validateName } from './lib/registry.js';
import { getAccessToken } from './lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';

const DEPLOY_API_URL = 'https://vibes-deploy-api.vibes.diy';

async function deployViaAPI(name, html, accessToken, options = {}) {
  console.log(`Deploying ${name}...`);
  const body = { name, html };
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
  const aiKeyIdx = args.indexOf("--ai-key");

  if (nameIdx === -1) {
    throw new Error("Usage: deploy-cloudflare.js --name <app-name> --file <index.html> [--ai-key <key>]");
  }

  const name = validateName(args[nameIdx + 1]);
  const file = fileIdx !== -1 ? args[fileIdx + 1] : "index.html";
  const aiKey = aiKeyIdx !== -1 ? args[aiKeyIdx + 1] : null;

  // Read the HTML file
  const srcFile = resolve(process.cwd(), file);
  if (!existsSync(srcFile)) {
    throw new Error(`File not found: ${srcFile}`);
  }
  const html = readFileSync(srcFile, "utf8");

  console.log(`Deploying ${name} to Cloudflare Workers via Deploy API...`);

  // Authenticate via OIDC
  console.log("\nAuthenticating...");
  const tokens = await getAccessToken({
    authority: OIDC_AUTHORITY,
    clientId: OIDC_CLIENT_ID,
  });

  // Deploy via API
  const result = await deployViaAPI(name, html, tokens.accessToken, { aiKey });

  const deployedUrl = result.url || `https://${name}.vibes.diy`;
  console.log(`\nDeployed to ${deployedUrl}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
