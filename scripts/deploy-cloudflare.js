#!/usr/bin/env node
/**
 * Deploy Vibes app to Cloudflare Workers
 *
 * Usage:
 *   node scripts/deploy-cloudflare.js --name myapp --file index.html [--ai-key <openrouter-key>]
 *     [--oidc-authority <https://pocket-id.example.com>] [--billing-mode <off|required>]
 *     [--admin-ids <user_id1,user_id2>] [--env-dir <dir>]
 *     [--reserved <list>] [--preallocated <list>]
 *
 * Automatically copies:
 *   - index.html to public/
 *   - bundles/fireproof-oidc-bridge.js to public/ (Vibes-specific wrapper)
 *   - assets/ to public/assets/ (images, icons)
 *
 * OIDC authority auto-detected from .env if not provided via flags.
 * --env-dir defaults to the parent directory of --file.
 */

import { execSync } from "child_process";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { resolve, join, basename, dirname } from "path";
import { createPublicKey } from "crypto";
import { PLUGIN_ROOT } from "./lib/paths.js";
import { loadEnvFile } from "./lib/env-utils.js";
import { getApp, setApp, isFirstDeploy, validateName } from './lib/registry.js';
import { deployConnect } from './lib/alchemy-deploy.js';
const WORKER_DIR = resolve(PLUGIN_ROOT, "skills/cloudflare/worker");

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...options });
}

/**
 * Recursively copy a directory
 */
// Extensions to skip when copying assets to the worker's public dir
const SKIP_EXTENSIONS = new Set(['.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi']);
const SKIP_FILES = new Set(['.DS_Store']);
const MAX_ASSET_SIZE = 25 * 1024 * 1024; // 25 MiB (Cloudflare Workers limit)

function copyDirRecursive(src, dest) {
  if (!existsSync(src)) return;

  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stats = statSync(srcPath);

    if (stats.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      if (SKIP_FILES.has(entry)) continue;
      const ext = entry.substring(entry.lastIndexOf('.')).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) {
        console.log(`  Skipped ${entry} (${ext} not supported by Workers)`);
        continue;
      }
      if (stats.size > MAX_ASSET_SIZE) {
        console.log(`  Skipped ${entry} (${(stats.size / 1024 / 1024).toFixed(1)} MiB exceeds 25 MiB limit)`);
        continue;
      }
      copyFileSync(srcPath, destPath);
      console.log(`  Copied ${entry}`);
    }
  }
}

/**
 * Fetch the OIDC JWKS via discovery and convert the first RSA signing key to PEM format.
 * Uses OIDC discovery ({authority}/.well-known/openid-configuration) to find the jwks_uri.
 */
async function fetchOIDCPEM(authority) {
  const discoveryUrl = `${authority.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  console.log(`  Fetching OIDC discovery from ${discoveryUrl}`);
  const discoveryResp = await fetch(discoveryUrl);
  if (!discoveryResp.ok) {
    throw new Error(`OIDC discovery failed: ${discoveryResp.status} ${discoveryResp.statusText}`);
  }
  const oidcConfig = await discoveryResp.json();
  const jwksUrl = oidcConfig.jwks_uri;
  if (!jwksUrl) {
    throw new Error("OIDC discovery response missing jwks_uri");
  }

  console.log(`  Fetching JWKS from ${jwksUrl}`);
  const resp = await fetch(jwksUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch JWKS: ${resp.status} ${resp.statusText}`);
  }
  const jwks = await resp.json();
  const rsaKey = jwks.keys.find((k) => k.kty === "RSA" && k.use === "sig");
  if (!rsaKey) {
    throw new Error("No RSA signing key found in JWKS");
  }
  const pem = createPublicKey({ key: rsaKey, format: "jwk" }).export({
    type: "spki",
    format: "pem",
  });
  return pem;
}

async function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf("--name");
  const fileIdx = args.indexOf("--file");
  const aiKeyIdx = args.indexOf("--ai-key");
  const oidcAuthorityIdx = args.indexOf("--oidc-authority");
  const billingModeIdx = args.indexOf("--billing-mode");
  // --webhook-secret removed (Clerk-specific, not needed for OIDC)
  const adminIdsIdx = args.indexOf("--admin-ids");
  const envDirIdx = args.indexOf("--env-dir");
  const reservedIdx = args.indexOf("--reserved");
  const preallocatedIdx = args.indexOf("--preallocated");
  const planQuotasIdx = args.indexOf("--plan-quotas");

  if (nameIdx === -1) {
    throw new Error("Usage: deploy-cloudflare.js --name <app-name> --file <index.html> [--ai-key <key>] [--oidc-authority <url>] [--billing-mode <off|required>] [--admin-ids <user_id1,user_id2>] [--env-dir <dir>] [--reserved <list>] [--preallocated <list>]");
  }

  const name = validateName(args[nameIdx + 1]);
  const file = fileIdx !== -1 ? args[fileIdx + 1] : "index.html";
  const aiKey = aiKeyIdx !== -1 ? args[aiKeyIdx + 1] : null;
  const billingMode = billingModeIdx !== -1 ? args[billingModeIdx + 1] : null;
  const adminIds = adminIdsIdx !== -1 ? args[adminIdsIdx + 1] : null;

  // Parse reserved subdomains (comma-separated list)
  const reserved = reservedIdx !== -1
    ? args[reservedIdx + 1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];

  // Parse preallocated subdomains ("sub:user_id,sub:user_id" → object)
  const preallocated = {};
  if (preallocatedIdx !== -1) {
    const pairs = args[preallocatedIdx + 1].split(',');
    for (const pair of pairs) {
      const [subdomain, userId] = pair.split(':').map(s => s.trim());
      if (subdomain && userId) {
        preallocated[subdomain.toLowerCase()] = userId;
      }
    }
  }

  // Plan quotas: JSON map of plan slug to max subdomains
  const planQuotas = planQuotasIdx !== -1 ? args[planQuotasIdx + 1] : null;

  // Resolve env directory for .env auto-detection (defaults to --file's parent dir)
  const envDir = envDirIdx !== -1
    ? resolve(process.cwd(), args[envDirIdx + 1])
    : dirname(resolve(process.cwd(), file));
  const envVars = loadEnvFile(envDir);

  // OIDC authority: flag > .env auto-detect
  let oidcAuthority = oidcAuthorityIdx !== -1 ? args[oidcAuthorityIdx + 1] : null;
  if (!oidcAuthority && envVars.VITE_OIDC_AUTHORITY) {
    oidcAuthority = envVars.VITE_OIDC_AUTHORITY;
    console.log(`OIDC authority: from ${envDir}/.env`);
  } else if (oidcAuthority) {
    console.log("OIDC authority: from --oidc-authority flag");
  }

  console.log(`Deploying ${name} to Cloudflare Workers...`);
  console.log(`Plugin root: ${PLUGIN_ROOT}`);

  // --- First-deploy detection ---
  const firstDeploy = isFirstDeploy(name);

  if (firstDeploy) {
    console.log(`\nFirst deploy for "${name}" — provisioning paired Connect instance...`);

    // OIDC authority is required for Connect
    if (!oidcAuthority) {
      throw new Error(
        'First deploy requires OIDC authority URL.\n' +
        'Provide via --oidc-authority flag or VITE_OIDC_AUTHORITY in .env'
      );
    }

    // Deploy Connect via alchemy
    const connectResult = await deployConnect({
      appName: name,
      oidcAuthority,
      dryRun: args.includes('--dry-run')
    });

    // Write Connect metadata to registry
    setApp(name, {
      name,
      oidc: {
        authority: oidcAuthority,
        clientId: envVars.VITE_OIDC_CLIENT_ID || ''
      },
      connect: {
        ...connectResult,
        deployedAt: new Date().toISOString()
      }
    });

    // Log Connect URLs (internal infrastructure — not user-facing)
    console.log(`[connect] Provisioned API: ${connectResult.apiUrl}`);
    console.log(`[connect] Provisioned Cloud: ${connectResult.cloudUrl}`);

    // Write Connect URLs to .env so assembly can find them
    const envPath = resolve(envDir, '.env');
    let envContent = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

    // Append or update VITE_API_URL and VITE_CLOUD_URL
    for (const [key, value] of [['VITE_API_URL', connectResult.apiUrl], ['VITE_CLOUD_URL', connectResult.cloudUrl]]) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent = envContent.trimEnd() + `\n${key}=${value}\n`;
      }
    }
    writeFileSync(envPath, envContent);
    console.log(`Updated ${envPath} with Connect URLs`);

    // Auto-assemble if index.html doesn't exist yet
    const srcFile = resolve(process.cwd(), file);
    const appJsx = resolve(process.cwd(), 'app.jsx');
    if (!existsSync(srcFile) && existsSync(appJsx)) {
      console.log(`\nAuto-assembling ${file} from app.jsx...`);
      execSync(`node "${resolve(PLUGIN_ROOT, 'scripts/assemble.js')}" app.jsx "${file}"`, {
        stdio: 'inherit',
        cwd: process.cwd()
      });
    }

  } else {
    console.log(`\nUpdate deploy for "${name}" — using existing Connect instance.`);
    const existing = getApp(name);
    if (existing?.connect) {
      console.log(`[connect] Using existing API: ${existing.connect.apiUrl}`);
    }
  }

  // Ensure public directory exists
  const publicDir = resolve(WORKER_DIR, "public");
  mkdirSync(publicDir, { recursive: true });

  // 1. Copy the HTML file to public/
  const srcFile = resolve(process.cwd(), file);
  if (!existsSync(srcFile)) {
    throw new Error(`File not found: ${srcFile}`);
  }
  const destFile = resolve(publicDir, "index.html");
  console.log(`\nCopying ${basename(srcFile)} to public/`);
  copyFileSync(srcFile, destFile);

  // 2. Copy OIDC bridge to public/
  const bridgePath = resolve(PLUGIN_ROOT, "bundles", "fireproof-oidc-bridge.js");
  if (existsSync(bridgePath)) {
    console.log(`\nCopying fireproof-oidc-bridge.js to public/`);
    copyFileSync(bridgePath, join(publicDir, "fireproof-oidc-bridge.js"));
  }

  // 3. Copy assets/ to public/assets/ (images, favicons, etc.)
  const assetsDir = resolve(PLUGIN_ROOT, "assets");
  const publicAssetsDir = resolve(publicDir, "assets");
  if (existsSync(assetsDir)) {
    console.log(`\nCopying assets/ to public/assets/`);
    copyDirRecursive(assetsDir, publicAssetsDir);
  }

  // Install dependencies if needed
  const nodeModules = resolve(WORKER_DIR, "node_modules");
  if (!existsSync(nodeModules)) {
    console.log("\nInstalling dependencies...");
    run("npm install", { cwd: WORKER_DIR });
  }

  // Create per-app KV namespace and update wrangler.toml
  const wranglerToml = resolve(WORKER_DIR, "wrangler.toml");
  const originalToml = readFileSync(wranglerToml, "utf8");

  console.log("\nEnsuring per-app KV namespace...");
  const kvName = `${name}-registry`;
  let kvId;
  try {
    // List existing KV namespaces to check if one already exists for this app
    const listOutput = execSync("npx wrangler kv namespace list", {
      cwd: WORKER_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const namespaces = JSON.parse(listOutput);
    const existing = namespaces.find((ns) => ns.title === kvName);
    if (existing) {
      kvId = existing.id;
      console.log(`  Found existing KV namespace: ${kvName} (${kvId})`);
    }
  } catch (e) {
    // List failed, will create new
  }

  if (!kvId) {
    console.log(`  Creating KV namespace: ${kvName}`);
    const createOutput = execSync(`npx wrangler kv namespace create "${kvName}"`, {
      cwd: WORKER_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Parse the namespace ID from the output (JSON format: "id": "..." or TOML format: id = "...")
    const idMatch = createOutput.match(/"id"\s*:\s*"([^"]+)"/) || createOutput.match(/id\s*=\s*"([^"]+)"/);
    if (!idMatch) {
      throw new Error(`Failed to parse KV namespace ID from output: ${createOutput}`);
    }
    kvId = idMatch[1];
    console.log(`  Created KV namespace: ${kvName} (${kvId})`);
  }

  // Rewrite wrangler.toml with the per-app KV namespace ID and billing mode
  let updatedToml = originalToml.replace(
    /^id\s*=\s*"[^"]*"/m,
    `id = "${kvId}"`
  );
  if (billingMode) {
    updatedToml = updatedToml.replace(
      /^BILLING_MODE\s*=\s*"[^"]*"/m,
      `BILLING_MODE = "${billingMode}"`
    );
    console.log(`  Billing mode: ${billingMode} (patched in wrangler.toml)`);
  }
  if (adminIds) {
    updatedToml = updatedToml.replace(
      /^ADMIN_USER_IDS\s*=\s*"[^"]*"/m,
      `ADMIN_USER_IDS = "${adminIds}"`
    );
    console.log(`  Admin IDs: ${adminIds} (patched in wrangler.toml)`);
  }
  if (planQuotas) {
    updatedToml = updatedToml.replace(
      /^PLAN_QUOTAS\s*=\s*"[^"]*"/m,
      `PLAN_QUOTAS = '${planQuotas}'`
    );
    console.log(`  Plan quotas: ${planQuotas} (patched in wrangler.toml)`);
  }
  writeFileSync(wranglerToml, updatedToml);

  // Deploy with wrangler (capture output to extract URL)
  console.log("\nDeploying to Cloudflare...");
  let deployOutput = "";
  try {
    console.log(`> npx wrangler deploy --name ${name}`);
    deployOutput = execSync(`npx wrangler deploy --name ${name}`, {
      cwd: WORKER_DIR,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
    process.stdout.write(deployOutput);
  } finally {
    // Always restore original wrangler.toml
    writeFileSync(wranglerToml, originalToml);
  }

  // Set OpenRouter API key if provided
  if (aiKey) {
    console.log("\nSetting OPENROUTER_API_KEY secret...");
    execSync(`npx wrangler secret put OPENROUTER_API_KEY --name ${name}`, {
      input: aiKey,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log("AI proxy enabled at /api/ai/chat");
  }

  // Set OIDC secrets for JWT verification (sell apps with /claim endpoint)
  if (oidcAuthority) {
    console.log(`\nConfiguring OIDC JWT verification...`);
    console.log(`  OIDC authority: ${oidcAuthority}`);

    const pem = await fetchOIDCPEM(oidcAuthority);
    console.log("  PEM key obtained");

    // Set OIDC_PEM_PUBLIC_KEY secret
    execSync(`npx wrangler secret put OIDC_PEM_PUBLIC_KEY --name ${name}`, {
      input: pem,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    // Set OIDC_ISSUER secret (the authority URL for token validation)
    execSync(`npx wrangler secret put OIDC_ISSUER --name ${name}`, {
      input: oidcAuthority,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    // Set PERMITTED_ORIGINS — allow the worker URL patterns
    // Worker URLs are https://{name}.{account}.workers.dev
    const origins = `https://${name}.*.workers.dev`;
    execSync(`npx wrangler secret put PERMITTED_ORIGINS --name ${name}`, {
      input: origins,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`  Permitted origins: ${origins}`);
    console.log("  OIDC auth enabled for /claim endpoint");
  }

  // Seed config keys in KV (use --namespace-id since --binding only works in dev)
  console.log("\nSeeding KV config...");
  const reservedList = reserved.length ? JSON.stringify(reserved) : '[]';
  const preallocatedObj = Object.keys(preallocated).length ? JSON.stringify(preallocated) : '{}';
  run(`npx wrangler kv key put "config:reserved" '${reservedList}' --namespace-id ${kvId} --remote`, { cwd: WORKER_DIR });
  run(`npx wrangler kv key put "config:preallocated" '${preallocatedObj}' --namespace-id ${kvId} --remote`, { cwd: WORKER_DIR });
  console.log(`  Reserved subdomains: ${reserved.length ? reserved.join(', ') : 'none'}`);
  console.log(`  Preallocated: ${Object.keys(preallocated).length ? Object.keys(preallocated).join(', ') : 'none'}`);
  console.log("  KV config seeded");

  // Extract the actual deployed URL from wrangler output (includes account subdomain)
  const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/);
  const deployedUrl = urlMatch ? urlMatch[0] : `https://${name}.workers.dev`;
  console.log(`\n✅ Deployed to ${deployedUrl}`);

  // Update app metadata in registry
  const appEntry = getApp(name) || { name };
  setApp(name, {
    ...appEntry,
    app: {
      workerName: name,
      kvNamespaceId: kvId,
      url: deployedUrl
    }
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
