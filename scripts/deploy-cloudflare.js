#!/usr/bin/env node
/**
 * Deploy Vibes app to Cloudflare Workers
 *
 * Usage:
 *   node scripts/deploy-cloudflare.js --name myapp --file index.html [--ai-key <openrouter-key>]
 *     [--clerk-key <pk_test_...>] [--billing-mode <off|required>] [--admin-ids <user_id1,user_id2>]
 *     [--webhook-secret <whsec_...>] [--env-dir <dir>]
 *     [--reserved <list>] [--preallocated <list>]
 *
 * Automatically copies:
 *   - index.html to public/
 *   - bundles/*.js to public/ (fireproof-clerk-bundle.js workaround)
 *   - assets/ to public/assets/ (images, icons)
 *
 * Clerk key and webhook secret auto-detected from .env if not provided via flags.
 * --env-dir defaults to the parent directory of --file.
 */

import { execSync } from "child_process";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { resolve, join, basename, dirname } from "path";
import { createPublicKey } from "crypto";
import { PLUGIN_ROOT } from "./lib/paths.js";
import { loadEnvFile } from "./lib/env-utils.js";
const WORKER_DIR = resolve(PLUGIN_ROOT, "skills/cloudflare/worker");

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...options });
}

/**
 * Recursively copy a directory
 */
function copyDirRecursive(src, dest) {
  if (!existsSync(src)) return;

  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      console.log(`  Copied ${entry}`);
    }
  }
}

/**
 * Decode a Clerk publishable key to extract the Frontend API domain.
 * pk_test_<base64(domain + "$")> or pk_live_<base64(domain + "$")>
 */
function clerkDomainFromKey(publishableKey) {
  const match = publishableKey.match(/^pk_(test|live)_(.+)$/);
  if (!match) return null;
  const decoded = Buffer.from(match[2], "base64").toString("utf8");
  return decoded.replace(/\$$/, ""); // strip trailing $
}

/**
 * Fetch the Clerk JWKS and convert the first RSA key to PEM format.
 */
async function fetchClerkPEM(clerkDomain) {
  const jwksUrl = `https://${clerkDomain}/.well-known/jwks.json`;
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
  const clerkKeyIdx = args.indexOf("--clerk-key");
  const billingModeIdx = args.indexOf("--billing-mode");
  const webhookSecretIdx = args.indexOf("--webhook-secret");
  const adminIdsIdx = args.indexOf("--admin-ids");
  const envDirIdx = args.indexOf("--env-dir");
  const reservedIdx = args.indexOf("--reserved");
  const preallocatedIdx = args.indexOf("--preallocated");

  if (nameIdx === -1) {
    throw new Error("Usage: deploy-cloudflare.js --name <app-name> --file <index.html> [--ai-key <key>] [--clerk-key <pk_test_...>] [--billing-mode <off|required>] [--admin-ids <user_id1,user_id2>] [--webhook-secret <whsec_...>] [--env-dir <dir>] [--reserved <list>] [--preallocated <list>]");
  }

  const name = args[nameIdx + 1];
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

  // Resolve env directory for .env auto-detection (defaults to --file's parent dir)
  const envDir = envDirIdx !== -1
    ? resolve(process.cwd(), args[envDirIdx + 1])
    : dirname(resolve(process.cwd(), file));
  const envVars = loadEnvFile(envDir);

  // Clerk key: flag > .env auto-detect
  let clerkKey = clerkKeyIdx !== -1 ? args[clerkKeyIdx + 1] : null;
  if (!clerkKey && envVars.VITE_CLERK_PUBLISHABLE_KEY) {
    clerkKey = envVars.VITE_CLERK_PUBLISHABLE_KEY;
    console.log(`Clerk key: from ${envDir}/.env`);
  } else if (clerkKey) {
    console.log("Clerk key: from --clerk-key flag");
  }

  // Webhook secret: flag > .env auto-detect
  let webhookSecret = webhookSecretIdx !== -1 ? args[webhookSecretIdx + 1] : null;
  if (!webhookSecret && envVars.CLERK_WEBHOOK_SECRET) {
    webhookSecret = envVars.CLERK_WEBHOOK_SECRET;
    console.log(`Webhook secret: from ${envDir}/.env`);
  } else if (webhookSecret) {
    console.log("Webhook secret: from --webhook-secret flag");
  }

  console.log(`Deploying ${name} to Cloudflare Workers...`);
  console.log(`Plugin root: ${PLUGIN_ROOT}`);

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

  // 2. Copy bundles/ to public/ (e.g., fireproof-clerk-bundle.js)
  const bundlesDir = resolve(PLUGIN_ROOT, "bundles");
  if (existsSync(bundlesDir)) {
    console.log(`\nCopying bundles/ to public/`);
    for (const entry of readdirSync(bundlesDir)) {
      const srcPath = join(bundlesDir, entry);
      if (!statSync(srcPath).isDirectory() && entry.endsWith(".js")) {
        copyFileSync(srcPath, join(publicDir, entry));
        console.log(`  Copied ${entry}`);
      }
    }
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

  // Set Clerk secrets for JWT verification (sell apps with /claim endpoint)
  if (clerkKey) {
    const clerkDomain = clerkDomainFromKey(clerkKey);
    if (!clerkDomain) {
      throw new Error("Invalid Clerk publishable key format");
    }

    console.log(`\nConfiguring Clerk JWT verification...`);
    console.log(`  Clerk domain: ${clerkDomain}`);

    const pem = await fetchClerkPEM(clerkDomain);
    console.log("  PEM key obtained");

    // Set CLERK_PEM_PUBLIC_KEY secret
    execSync(`npx wrangler secret put CLERK_PEM_PUBLIC_KEY --name ${name}`, {
      input: pem,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    // Set PERMITTED_ORIGINS — allow the worker URL patterns
    // Worker URLs are https://{name}.{account}.workers.dev
    const origins = `https://${name}.*.workers.dev,https://${clerkDomain}`;
    execSync(`npx wrangler secret put PERMITTED_ORIGINS --name ${name}`, {
      input: origins,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`  Permitted origins: ${origins}`);
    console.log("  Clerk auth enabled for /claim endpoint");
  }

  // Set CLERK_WEBHOOK_SECRET if provided
  if (webhookSecret) {
    console.log("\nSetting CLERK_WEBHOOK_SECRET secret...");
    execSync(`npx wrangler secret put CLERK_WEBHOOK_SECRET --name ${name}`, {
      input: webhookSecret,
      cwd: WORKER_DIR,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log("  Webhook secret configured");
  } else if (clerkKey) {
    console.log("\n⚠️  No webhook secret provided. Subscription billing won't work without it.");
  }

  // Seed config keys in KV
  console.log("\nSeeding KV config...");
  const reservedList = reserved.length ? JSON.stringify(reserved) : '[]';
  const preallocatedObj = Object.keys(preallocated).length ? JSON.stringify(preallocated) : '{}';
  run(`npx wrangler kv key put "config:reserved" '${reservedList}' --binding REGISTRY_KV --name ${name}`, { cwd: WORKER_DIR });
  run(`npx wrangler kv key put "config:preallocated" '${preallocatedObj}' --binding REGISTRY_KV --name ${name}`, { cwd: WORKER_DIR });
  console.log(`  Reserved subdomains: ${reserved.length ? reserved.join(', ') : 'none'}`);
  console.log(`  Preallocated: ${Object.keys(preallocated).length ? Object.keys(preallocated).join(', ') : 'none'}`);
  console.log("  KV config seeded");

  // Extract the actual deployed URL from wrangler output (includes account subdomain)
  const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/);
  const deployedUrl = urlMatch ? urlMatch[0] : `https://${name}.workers.dev`;
  console.log(`\n✅ Deployed to ${deployedUrl}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
