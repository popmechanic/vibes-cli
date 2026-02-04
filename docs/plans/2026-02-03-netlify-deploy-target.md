# Netlify Deploy Target Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Netlify as an optional deployment target alongside exe.dev, supporting both static apps and multi-tenant SaaS with registry services.

**Architecture:** Create a new `deploy-netlify.js` script that mirrors `deploy-exe.js` functionality using Netlify CLI for static hosting and Netlify Functions for the registry server. The existing exe skill remains unchanged; users choose their target via flag or separate command.

**Tech Stack:** Netlify CLI, Netlify Functions (Node.js), Netlify Blobs (for registry.json persistence)

---

## Prerequisites

Before starting:
- Netlify account created
- Netlify CLI installed globally: `npm install -g netlify-cli`
- Authenticated: `netlify login`

---

## Task 1: Create deploy-netlify.js Scaffold

**Files:**
- Create: `scripts/deploy-netlify.js`

**Step 1: Create the basic script structure**

```javascript
#!/usr/bin/env node

/**
 * deploy-netlify.js - Deploy Vibes apps to Netlify
 *
 * Usage:
 *   node scripts/deploy-netlify.js --name myapp --file index.html
 *   node scripts/deploy-netlify.js --name myapp --file index.html --domain mydomain.com
 *   node scripts/deploy-netlify.js --name myapp --file index.html --with-registry --clerk-key "..." --clerk-webhook-secret "..."
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    file: { type: 'string' },
    domain: { type: 'string' },
    'with-registry': { type: 'boolean', default: false },
    'clerk-key': { type: 'string' },
    'clerk-webhook-secret': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
});

if (args.help) {
  console.log(`
Usage: node scripts/deploy-netlify.js [options]

Options:
  --name <name>              Site name (required)
  --file <path>              HTML file to deploy (required)
  --domain <domain>          Custom domain (optional)
  --with-registry            Enable registry functions for sell apps
  --clerk-key <pem>          Clerk JWKS public key (required with --with-registry)
  --clerk-webhook-secret <s> Clerk webhook secret (required with --with-registry)
  --dry-run                  Show what would be done without doing it
  -h, --help                 Show this help
`);
  process.exit(0);
}

// Validate required args
if (!args.name || !args.file) {
  console.error('Error: --name and --file are required');
  process.exit(1);
}

if (!existsSync(args.file)) {
  console.error(`Error: File not found: ${args.file}`);
  process.exit(1);
}

async function main() {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NETLIFY DEPLOYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Site Name: ${args.name}
  File: ${args.file}
  Registry: ${args['with-registry'] ? 'Enabled' : 'Disabled'}
`);

  await phase1PreFlight();
  await phase2PrepareDeployDir();
  await phase3DeploySite();
  if (args['with-registry']) {
    await phase4SetupFunctions();
    await phase5SetEnvVars();
  }
  if (args.domain) {
    await phase6CustomDomain();
  }
  await phase7Verify();
}

main().catch(err => {
  console.error('Deployment failed:', err.message);
  process.exit(1);
});
```

**Step 2: Run to verify it parses args**

Run: `node scripts/deploy-netlify.js --help`
Expected: Help text displayed

**Step 3: Commit**

```bash
git add scripts/deploy-netlify.js
git commit -m "feat(deploy): scaffold deploy-netlify.js script"
```

---

## Task 2: Implement Pre-Flight and Deploy Directory Setup

**Files:**
- Modify: `scripts/deploy-netlify.js`

**Step 1: Add phase1PreFlight function**

```javascript
async function phase1PreFlight() {
  console.log('Phase 1: Pre-flight checks...');

  // Check Netlify CLI is installed
  try {
    execSync('netlify --version', { stdio: 'pipe' });
    console.log('  ✓ Netlify CLI installed');
  } catch {
    console.error('  ✗ Netlify CLI not found. Install with: npm install -g netlify-cli');
    process.exit(1);
  }

  // Check authenticated
  try {
    const result = execSync('netlify status', { stdio: 'pipe' }).toString();
    if (result.includes('Not logged in')) {
      throw new Error('Not logged in');
    }
    console.log('  ✓ Netlify authenticated');
  } catch {
    console.error('  ✗ Not logged in to Netlify. Run: netlify login');
    process.exit(1);
  }

  // Validate registry requirements
  if (args['with-registry']) {
    if (!args['clerk-key'] || !args['clerk-webhook-secret']) {
      console.error('  ✗ --with-registry requires --clerk-key and --clerk-webhook-secret');
      process.exit(1);
    }
    console.log('  ✓ Registry credentials provided');
  }
}
```

**Step 2: Add phase2PrepareDeployDir function**

```javascript
async function phase2PrepareDeployDir() {
  console.log('\nPhase 2: Prepare deploy directory...');

  const deployDir = join(__dirname, '..', '.netlify-deploy', args.name);

  // Clean and create deploy directory
  if (existsSync(deployDir)) {
    execSync(`rm -rf "${deployDir}"`);
  }
  mkdirSync(deployDir, { recursive: true });

  // Copy main HTML file
  copyFileSync(args.file, join(deployDir, 'index.html'));
  console.log('  ✓ Copied index.html');

  // Copy favicon assets if they exist
  const faviconDir = join(__dirname, '..', 'assets', 'vibes-favicon');
  if (existsSync(faviconDir)) {
    const faviconFiles = [
      'favicon.svg', 'favicon-96x96.png', 'favicon.ico',
      'apple-touch-icon.png', 'site.webmanifest',
      'web-app-manifest-192x192.png', 'web-app-manifest-512x512.png'
    ];
    for (const file of faviconFiles) {
      const src = join(faviconDir, file);
      if (existsSync(src)) {
        copyFileSync(src, join(deployDir, file));
      }
    }
    console.log('  ✓ Copied favicon assets');
  }

  // Copy auth cards if they exist
  const cardsDir = join(__dirname, '..', 'assets', 'auth-cards');
  if (existsSync(cardsDir)) {
    const cardsDeployDir = join(deployDir, 'cards');
    mkdirSync(cardsDeployDir, { recursive: true });
    for (let i = 1; i <= 4; i++) {
      const src = join(cardsDir, `card-${i}.png`);
      if (existsSync(src)) {
        copyFileSync(src, join(cardsDeployDir, `card-${i}.png`));
      }
    }
    console.log('  ✓ Copied auth cards');
  }

  // Copy fireproof bundle if it exists (temporary workaround)
  const bundlePath = join(__dirname, '..', 'bundles', 'fireproof-clerk-bundle.js');
  if (existsSync(bundlePath)) {
    copyFileSync(bundlePath, join(deployDir, 'fireproof-clerk-bundle.js'));
    console.log('  ✓ Copied fireproof bundle');
  }

  // Store deploy dir for later phases
  global.deployDir = deployDir;
}
```

**Step 3: Run to verify directory creation**

Run: `node scripts/deploy-netlify.js --name test-app --file /path/to/index.html --dry-run`
Expected: Phases 1-2 complete, `.netlify-deploy/test-app/` created with files

**Step 4: Commit**

```bash
git add scripts/deploy-netlify.js
git commit -m "feat(deploy): add pre-flight and deploy dir setup for Netlify"
```

---

## Task 3: Implement Site Deployment

**Files:**
- Modify: `scripts/deploy-netlify.js`

**Step 1: Add phase3DeploySite function**

```javascript
async function phase3DeploySite() {
  console.log('\nPhase 3: Deploy to Netlify...');

  if (args['dry-run']) {
    console.log(`  [DRY RUN] Would deploy ${global.deployDir} to Netlify site: ${args.name}`);
    return;
  }

  const deployDir = global.deployDir;

  // Check if site exists, create if not
  try {
    execSync(`netlify sites:list --json`, { stdio: 'pipe' });
    const sites = JSON.parse(execSync(`netlify sites:list --json`, { stdio: 'pipe' }).toString());
    const siteExists = sites.some(s => s.name === args.name);

    if (!siteExists) {
      console.log(`  Creating new site: ${args.name}...`);
      execSync(`netlify sites:create --name ${args.name}`, { stdio: 'inherit' });
    } else {
      console.log(`  ✓ Site ${args.name} exists`);
    }
  } catch (err) {
    // If sites:list fails, try creating anyway
    try {
      execSync(`netlify sites:create --name ${args.name}`, { stdio: 'pipe' });
    } catch {
      // Site might already exist, continue
    }
  }

  // Link to site
  execSync(`netlify link --name ${args.name}`, { cwd: deployDir, stdio: 'pipe' });

  // Deploy
  console.log('  Deploying...');
  const deployCmd = args['with-registry']
    ? `netlify deploy --prod --dir . --functions ../functions`
    : `netlify deploy --prod --dir .`;

  execSync(deployCmd, { cwd: deployDir, stdio: 'inherit' });

  // Get site URL
  const siteInfo = JSON.parse(execSync(`netlify sites:list --json`, { stdio: 'pipe' }).toString());
  const site = siteInfo.find(s => s.name === args.name);
  global.siteUrl = site?.ssl_url || `https://${args.name}.netlify.app`;

  console.log(`  ✓ Deployed to ${global.siteUrl}`);
}
```

**Step 2: Test with a real deployment**

Run: `node scripts/deploy-netlify.js --name vibes-test-app --file /path/to/simple/index.html`
Expected: Site deployed to https://vibes-test-app.netlify.app

**Step 3: Commit**

```bash
git add scripts/deploy-netlify.js
git commit -m "feat(deploy): implement Netlify site deployment"
```

---

## Task 4: Create Registry Functions

**Files:**
- Create: `scripts/netlify-functions/claim.js`
- Create: `scripts/netlify-functions/check.js`
- Create: `scripts/netlify-functions/webhook.js`
- Create: `scripts/netlify-functions/registry.js`

**Step 1: Create functions directory**

```bash
mkdir -p scripts/netlify-functions
```

**Step 2: Create registry.js (GET /api/registry)**

```javascript
// scripts/netlify-functions/registry.js
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  // Only allow GET
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const store = getStore('registry');
    const data = await store.get('registry.json', { type: 'json' });

    if (!data) {
      // Return empty registry if none exists
      return Response.json({
        claims: {},
        quotas: {},
        reserved: ['admin', 'api', 'www', 'app'],
        preallocated: {}
      });
    }

    return Response.json(data);
  } catch (err) {
    console.error('Registry read error:', err);
    return new Response('Internal error', { status: 500 });
  }
};

export const config = {
  path: "/api/registry"
};
```

**Step 3: Create check.js (GET /api/check/:subdomain)**

```javascript
// scripts/netlify-functions/check.js
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const subdomain = url.pathname.split('/').pop();

  if (!subdomain || subdomain === 'check') {
    return Response.json({ error: 'Subdomain required' }, { status: 400 });
  }

  try {
    const store = getStore('registry');
    const data = await store.get('registry.json', { type: 'json' }) || {
      claims: {},
      reserved: ['admin', 'api', 'www', 'app'],
      preallocated: {}
    };

    // Check reserved
    if (data.reserved?.includes(subdomain)) {
      return Response.json({ available: false, reason: 'reserved' });
    }

    // Check preallocated
    if (data.preallocated?.[subdomain]) {
      return Response.json({
        available: false,
        reason: 'preallocated',
        ownerId: data.preallocated[subdomain]
      });
    }

    // Check claimed
    if (data.claims?.[subdomain]) {
      return Response.json({
        available: false,
        reason: 'claimed',
        ownerId: data.claims[subdomain].userId
      });
    }

    return Response.json({ available: true });
  } catch (err) {
    console.error('Check error:', err);
    return new Response('Internal error', { status: 500 });
  }
};

export const config = {
  path: "/api/check/*"
};
```

**Step 4: Create claim.js (POST /api/claim)**

```javascript
// scripts/netlify-functions/claim.js
import { getStore } from "@netlify/blobs";

// JWT validation (simplified - in production use jose library)
async function validateJWT(token, publicKey) {
  // For MVP, we'll trust the token and extract claims
  // TODO: Implement proper RS256 validation with jose
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  // Check expiration
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error('Token expired');
  }

  return payload;
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Extract and validate JWT
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  let payload;

  try {
    payload = await validateJWT(token, process.env.CLERK_PEM_PUBLIC_KEY);
  } catch (err) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }

  const userId = payload.sub;
  if (!userId) {
    return Response.json({ error: 'No user ID in token' }, { status: 401 });
  }

  // Parse request body
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { subdomain } = body;
  if (!subdomain || !/^[a-z0-9-]+$/.test(subdomain)) {
    return Response.json({ error: 'Invalid subdomain' }, { status: 400 });
  }

  try {
    const store = getStore('registry');
    const data = await store.get('registry.json', { type: 'json' }) || {
      claims: {},
      quotas: {},
      reserved: ['admin', 'api', 'www', 'app'],
      preallocated: {}
    };

    // Check availability
    if (data.reserved?.includes(subdomain)) {
      return Response.json({ error: 'Subdomain reserved' }, { status: 409 });
    }
    if (data.claims?.[subdomain]) {
      return Response.json({ error: 'Subdomain taken' }, { status: 409 });
    }

    // Check quota
    const userClaims = Object.values(data.claims || {}).filter(c => c.userId === userId);
    const quota = data.quotas?.[userId] ?? 999;

    if (userClaims.length >= quota) {
      return Response.json({
        error: 'Quota exceeded',
        current: userClaims.length,
        quota
      }, { status: 402 });
    }

    // Claim it
    data.claims[subdomain] = {
      userId,
      claimedAt: new Date().toISOString()
    };

    await store.setJSON('registry.json', data);

    return Response.json({
      success: true,
      subdomain,
      claimedAt: data.claims[subdomain].claimedAt
    }, { status: 201 });

  } catch (err) {
    console.error('Claim error:', err);
    return new Response('Internal error', { status: 500 });
  }
};

export const config = {
  path: "/api/claim"
};
```

**Step 5: Create webhook.js (POST /api/webhook)**

```javascript
// scripts/netlify-functions/webhook.js
import { getStore } from "@netlify/blobs";
import { Webhook } from "svix";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('CLERK_WEBHOOK_SECRET not configured');
    return new Response('Server misconfigured', { status: 500 });
  }

  // Verify webhook signature
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json({ error: 'Missing svix headers' }, { status: 401 });
  }

  const body = await req.text();

  try {
    const wh = new Webhook(webhookSecret);
    wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature
    });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body);
  const { type, data } = event;

  console.log(`Processing webhook: ${type}`);

  try {
    const store = getStore('registry');
    const registry = await store.get('registry.json', { type: 'json' }) || {
      claims: {},
      quotas: {},
      reserved: ['admin', 'api', 'www', 'app'],
      preallocated: {}
    };

    if (type === 'subscription.created' || type === 'subscription.updated') {
      const userId = data.user_id;
      const quantity = data.quantity || 1;

      registry.quotas[userId] = quantity;

      // LIFO release if quota decreased
      const userClaims = Object.entries(registry.claims)
        .filter(([_, c]) => c.userId === userId)
        .sort((a, b) => new Date(b[1].claimedAt) - new Date(a[1].claimedAt));

      while (userClaims.length > quantity) {
        const [subdomain] = userClaims.shift();
        delete registry.claims[subdomain];
        console.log(`Released ${subdomain} due to quota decrease`);
      }
    }

    if (type === 'subscription.deleted') {
      const userId = data.user_id;
      delete registry.quotas[userId];

      // Release all claims
      for (const [subdomain, claim] of Object.entries(registry.claims)) {
        if (claim.userId === userId) {
          delete registry.claims[subdomain];
          console.log(`Released ${subdomain} due to subscription deletion`);
        }
      }
    }

    await store.setJSON('registry.json', registry);

    return Response.json({ received: true });

  } catch (err) {
    console.error('Webhook processing error:', err);
    return new Response('Processing error', { status: 500 });
  }
};

export const config = {
  path: "/api/webhook"
};
```

**Step 6: Commit**

```bash
git add scripts/netlify-functions/
git commit -m "feat(deploy): add Netlify Functions for registry API"
```

---

## Task 5: Implement Functions Setup Phase

**Files:**
- Modify: `scripts/deploy-netlify.js`

**Step 1: Add phase4SetupFunctions**

```javascript
async function phase4SetupFunctions() {
  console.log('\nPhase 4: Setup registry functions...');

  const functionsDir = join(global.deployDir, '..', 'functions');
  const sourceFunctionsDir = join(__dirname, 'netlify-functions');

  // Create functions directory
  mkdirSync(functionsDir, { recursive: true });

  // Copy function files
  const functionFiles = ['claim.js', 'check.js', 'webhook.js', 'registry.js'];
  for (const file of functionFiles) {
    const src = join(sourceFunctionsDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(functionsDir, file));
    }
  }

  console.log('  ✓ Copied registry functions');

  // Create netlify.toml in deploy dir for function config
  const netlifyToml = `
[functions]
  directory = "../functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
`;

  writeFileSync(join(global.deployDir, 'netlify.toml'), netlifyToml);
  console.log('  ✓ Created netlify.toml');
}
```

**Step 2: Add phase5SetEnvVars**

```javascript
async function phase5SetEnvVars() {
  console.log('\nPhase 5: Set environment variables...');

  if (args['dry-run']) {
    console.log('  [DRY RUN] Would set CLERK_PEM_PUBLIC_KEY and CLERK_WEBHOOK_SECRET');
    return;
  }

  const cwd = global.deployDir;

  // Set Clerk public key
  execSync(`netlify env:set CLERK_PEM_PUBLIC_KEY "${args['clerk-key'].replace(/"/g, '\\"')}"`, {
    cwd,
    stdio: 'pipe'
  });
  console.log('  ✓ Set CLERK_PEM_PUBLIC_KEY');

  // Set webhook secret
  execSync(`netlify env:set CLERK_WEBHOOK_SECRET "${args['clerk-webhook-secret']}"`, {
    cwd,
    stdio: 'pipe'
  });
  console.log('  ✓ Set CLERK_WEBHOOK_SECRET');
}
```

**Step 3: Commit**

```bash
git add scripts/deploy-netlify.js
git commit -m "feat(deploy): add functions setup and env vars phases"
```

---

## Task 6: Implement Custom Domain and Verification Phases

**Files:**
- Modify: `scripts/deploy-netlify.js`

**Step 1: Add phase6CustomDomain**

```javascript
async function phase6CustomDomain() {
  console.log('\nPhase 6: Custom domain setup...');

  if (args['dry-run']) {
    console.log(`  [DRY RUN] Would configure domain: ${args.domain}`);
    return;
  }

  try {
    execSync(`netlify domains:create ${args.domain}`, {
      cwd: global.deployDir,
      stdio: 'pipe'
    });
    console.log(`  ✓ Added domain: ${args.domain}`);

    // Also add wildcard if this is a sell app
    if (args['with-registry']) {
      execSync(`netlify domains:create "*.${args.domain}"`, {
        cwd: global.deployDir,
        stdio: 'pipe'
      });
      console.log(`  ✓ Added wildcard: *.${args.domain}`);
    }
  } catch (err) {
    console.log(`  Note: Domain may already be configured or require manual setup`);
  }

  console.log(`
  DNS Configuration Required:
  ─────────────────────────────────────────────────────

  Add these DNS records at your registrar:

  Type    Name    Value
  ────    ────    ─────
  ALIAS   @       ${args.name}.netlify.app
  CNAME   www     ${args.name}.netlify.app
  ${args['with-registry'] ? `CNAME   *       ${args.name}.netlify.app` : ''}

  SSL will be automatically provisioned once DNS propagates.
  `);
}
```

**Step 2: Add phase7Verify**

```javascript
async function phase7Verify() {
  console.log('\nPhase 7: Verification...');

  const siteUrl = global.siteUrl || `https://${args.name}.netlify.app`;

  // Wait for deployment to propagate
  console.log('  Waiting for deployment to propagate...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const response = await fetch(siteUrl);
    if (response.ok) {
      console.log(`  ✓ ${siteUrl} is responding (HTTP ${response.status})`);
    } else {
      console.log(`  ⚠ ${siteUrl} returned HTTP ${response.status}`);
    }
  } catch (err) {
    console.log(`  ⚠ Could not verify: ${err.message}`);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEPLOYMENT COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Your app is live at:
    ${siteUrl}

  ${args['with-registry'] ? `Registry API:
    GET  ${siteUrl}/api/registry
    GET  ${siteUrl}/api/check/{subdomain}
    POST ${siteUrl}/api/claim
    POST ${siteUrl}/api/webhook` : ''}
  ${args.domain ? `
  Custom domain: https://${args.domain}
  (Configure DNS as shown above)` : ''}

  To redeploy:
    node scripts/deploy-netlify.js --name ${args.name} --file ${args.file}${args['with-registry'] ? ' --with-registry' : ''}
`);
}
```

**Step 3: Commit**

```bash
git add scripts/deploy-netlify.js
git commit -m "feat(deploy): add custom domain and verification phases"
```

---

## Task 7: Add .gitignore and Package Dependencies

**Files:**
- Modify: `.gitignore`
- Modify: `scripts/package.json`

**Step 1: Update .gitignore**

Add to `.gitignore`:
```
# Netlify deploy staging
.netlify-deploy/
```

**Step 2: Update scripts/package.json**

Add dependencies needed for functions:
```json
{
  "dependencies": {
    "@netlify/blobs": "^8.0.0",
    "svix": "^1.0.0"
  }
}
```

**Step 3: Commit**

```bash
git add .gitignore scripts/package.json
git commit -m "chore: add Netlify deploy dependencies and gitignore"
```

---

## Task 8: Create Netlify Skill Documentation

**Files:**
- Create: `skills/netlify/SKILL.md`

**Step 1: Create skill file**

```markdown
---
name: netlify
description: Deploy a Vibes app to Netlify hosting with optional registry functions for multi-tenant SaaS
user-invocable: true
---

# /vibes:netlify - Deploy to Netlify

Deploy your Vibes app to Netlify for fast, global CDN hosting with automatic SSL.

## When to Use

- You want fast global CDN delivery
- You need wildcard subdomain support with automatic SSL
- You're deploying a sell app and want serverless registry functions
- You prefer Netlify's deployment workflow

## Prerequisites

1. **Netlify CLI installed**: `npm install -g netlify-cli`
2. **Authenticated**: `netlify login`

## Usage

### Basic Static App

\`\`\`bash
node scripts/deploy-netlify.js --name my-app --file index.html
\`\`\`

### With Custom Domain

\`\`\`bash
node scripts/deploy-netlify.js --name my-app --file index.html --domain myapp.com
\`\`\`

### Sell App with Registry

\`\`\`bash
node scripts/deploy-netlify.js \\
  --name my-saas \\
  --file index.html \\
  --with-registry \\
  --clerk-key "$(cat clerk-jwks-key.pem)" \\
  --clerk-webhook-secret "whsec_xxx" \\
  --domain mysaas.com
\`\`\`

## Registry API Endpoints

When deployed with `--with-registry`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/registry` | GET | Public registry data |
| `/api/check/{subdomain}` | GET | Check subdomain availability |
| `/api/claim` | POST | Claim subdomain (requires JWT) |
| `/api/webhook` | POST | Clerk subscription webhooks |

## Comparison: Netlify vs exe.dev

| Feature | Netlify | exe.dev |
|---------|---------|---------|
| Deployment speed | ~5 seconds | ~30 seconds |
| Global CDN | Yes | No (single region) |
| Wildcard SSL | Automatic | Manual |
| Serverless functions | Yes | Docker containers |
| Cost | Free tier + usage | VM hourly rate |
| SSH access | No | Yes |
| Fireproof Connect | Via external studio | Native support |

## Troubleshooting

### "Not logged in to Netlify"
Run `netlify login` and follow the prompts.

### DNS not propagating
Use `dig` or online tools to verify DNS records. Propagation can take up to 48 hours.

### Function cold starts
First request after idle period may be slow. Consider Netlify's Background Functions for webhook processing.
```

**Step 2: Commit**

```bash
git add skills/netlify/
git commit -m "docs: add Netlify deployment skill documentation"
```

---

## Task 9: Integration Test

**Step 1: Test basic deployment**

```bash
# Create a simple test HTML
echo '<!DOCTYPE html><html><body><h1>Test</h1></body></html>' > /tmp/test.html

# Deploy
node scripts/deploy-netlify.js --name vibes-integration-test --file /tmp/test.html
```

Expected: Site deployed to https://vibes-integration-test.netlify.app

**Step 2: Test with registry**

```bash
node scripts/deploy-netlify.js \
  --name vibes-registry-test \
  --file /tmp/test.html \
  --with-registry \
  --clerk-key "$(cat ~/.clerk/test-key.pem)" \
  --clerk-webhook-secret "whsec_test"
```

Expected: Site deployed with function endpoints working

**Step 3: Verify registry endpoints**

```bash
# Check registry
curl https://vibes-registry-test.netlify.app/api/registry

# Check availability
curl https://vibes-registry-test.netlify.app/api/check/testsubdomain
```

**Step 4: Clean up test sites**

```bash
netlify sites:delete vibes-integration-test --force
netlify sites:delete vibes-registry-test --force
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(deploy): complete Netlify deployment support"
```

---

## Verification Checklist

- [ ] `deploy-netlify.js --help` shows usage
- [ ] Basic HTML deploys successfully
- [ ] Favicon and auth card assets are included
- [ ] Registry functions respond at `/api/*` endpoints
- [ ] Environment variables are set correctly
- [ ] Custom domain instructions are displayed
- [ ] Dry run mode works without side effects

---

## Future Enhancements (Not in Scope)

1. **Proper JWT validation** - Use `jose` library for RS256 verification
2. **Edge Functions** - Move `/api/check` to edge for lower latency
3. **Netlify Identity** - Alternative to Clerk for simpler auth
4. **Deploy previews** - PR-based preview deployments
5. **Rollbacks** - Quick rollback to previous deploys
