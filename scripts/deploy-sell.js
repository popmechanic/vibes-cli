#!/usr/bin/env node
/**
 * Vibes Sell Deployment Automation
 *
 * Automates Cloudflare deployment after assemble-sell.js generates files.
 * Reduces 15+ manual steps to a single command.
 *
 * Usage:
 *   node scripts/deploy-sell.js [options]
 *
 * Options:
 *   --project <name>   Use saved project configuration
 *   --skip-dns         Skip DNS configuration
 *   --skip-routes      Skip worker route configuration
 *   --skip-pages       Skip Pages deployment
 *   --skip-verify      Skip verification step
 *   --verify-only      Only run verification (no deployment)
 *   --dry-run          Show what would be done without executing
 *   --reset            Clear saved configuration for project
 *   --help             Show this help message
 *
 * Environment Variables:
 *   CLOUDFLARE_API_TOKEN  - Cloudflare API token (avoids interactive prompt)
 *   CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID
 *
 * Examples:
 *   # First deployment (interactive)
 *   node scripts/deploy-sell.js
 *
 *   # Redeploy existing project
 *   node scripts/deploy-sell.js --project fantasy-wedding
 *
 *   # Verify deployment status
 *   node scripts/deploy-sell.js --project fantasy-wedding --verify-only
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import * as readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(homedir(), '.vibes-deploy.json');
const CLERK_CHECKLIST_PATH = join(__dirname, '../skills/sell/templates/clerk-checklist.txt');

// ============== Argument Parsing ==============

function parseArgs(argv) {
  const args = {
    project: null,
    skipDns: false,
    skipRoutes: false,
    skipPages: false,
    skipVerify: false,
    verifyOnly: false,
    dryRun: false,
    reset: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) {
      args.project = argv[++i];
    } else if (arg === '--skip-dns') {
      args.skipDns = true;
    } else if (arg === '--skip-routes') {
      args.skipRoutes = true;
    } else if (arg === '--skip-pages') {
      args.skipPages = true;
    } else if (arg === '--skip-verify') {
      args.skipVerify = true;
    } else if (arg === '--verify-only') {
      args.verifyOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--reset') {
      args.reset = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Vibes Sell Deployment Automation
=================================

Automates Cloudflare deployment after assemble-sell.js generates files.

Usage:
  node scripts/deploy-sell.js [options]

Options:
  --project <name>   Use saved project configuration
  --skip-dns         Skip DNS configuration
  --skip-routes      Skip worker route configuration
  --skip-pages       Skip Pages deployment
  --skip-verify      Skip verification step
  --verify-only      Only run verification (no deployment)
  --dry-run          Show what would be done without executing
  --reset            Clear saved configuration for project
  --help             Show this help message

Environment Variables:
  CLOUDFLARE_API_TOKEN  - Cloudflare API token (avoids interactive prompt)
  CLOUDFLARE_ACCOUNT_ID - Cloudflare account ID

Required Cloudflare API Token Permissions:
  - Zone:DNS:Edit
  - Zone:Zone:Read
  - Account:Workers KV Storage:Edit
  - Account:Workers Scripts:Edit

Examples:
  # First deployment (interactive)
  node scripts/deploy-sell.js

  # Redeploy existing project
  node scripts/deploy-sell.js --project fantasy-wedding

  # Skip DNS if already configured
  node scripts/deploy-sell.js --project fantasy-wedding --skip-dns

  # Verify deployment status
  node scripts/deploy-sell.js --project fantasy-wedding --verify-only
`);
}

// ============== Configuration Management ==============

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      return { projects: {} };
    }
  }
  return { projects: {} };
}

function saveConfig(config) {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getProjectConfig(config, projectName) {
  return config.projects[projectName] || null;
}

// ============== User Input Helpers ==============

function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

async function prompt(question) {
  const rl = createReadline();
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptSecret(question) {
  const rl = createReadline();

  // Hide input for secrets
  process.stdout.write(question);

  return new Promise((resolve) => {
    let input = '';

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit();
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += char;
      }
    };

    process.stdin.on('data', onData);
  });
}

async function confirm(question) {
  const answer = await prompt(`${question} (y/N): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

// ============== Pre-flight Checks ==============

function checkWranglerInstalled() {
  try {
    execSync('wrangler --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkFilesExist(outputDir) {
  const required = ['index.html', 'worker.js', 'wrangler.toml'];
  const missing = required.filter(f => !existsSync(join(outputDir, f)));
  return { valid: missing.length === 0, missing };
}

function parseWranglerToml(outputDir) {
  const tomlPath = join(outputDir, 'wrangler.toml');
  const content = readFileSync(tomlPath, 'utf-8');

  // Extract key values from wrangler.toml
  const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
  const pagesMatch = content.match(/PAGES_HOSTNAME\s*=\s*"([^"]+)"/);

  return {
    workerName: nameMatch ? nameMatch[1] : null,
    pagesHostname: pagesMatch ? pagesMatch[1] : null
  };
}

// ============== Cloudflare API Client ==============

class CloudflareAPI {
  constructor(apiToken, accountId = null) {
    this.apiToken = apiToken;
    this.accountId = accountId;
    this.baseUrl = 'https://api.cloudflare.com/client/v4';
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const data = await response.json();

    if (!data.success) {
      const errorMsg = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
      throw new Error(`Cloudflare API error: ${errorMsg}`);
    }

    return data.result;
  }

  // Zone operations
  async getZoneId(domain) {
    // Try exact match first
    let zones = await this.request(`/zones?name=${domain}`);
    if (zones.length > 0) return zones[0].id;

    // Try parent domain (e.g., sub.example.com -> example.com)
    const parts = domain.split('.');
    if (parts.length > 2) {
      const parentDomain = parts.slice(-2).join('.');
      zones = await this.request(`/zones?name=${parentDomain}`);
      if (zones.length > 0) return zones[0].id;
    }

    throw new Error(`Zone not found for domain: ${domain}. Make sure the domain is added to your Cloudflare account.`);
  }

  // DNS operations
  async listDnsRecords(zoneId) {
    return this.request(`/zones/${zoneId}/dns_records?per_page=100`);
  }

  async deleteDnsRecord(zoneId, recordId) {
    return this.request(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: 'DELETE'
    });
  }

  async createDnsRecord(zoneId, record) {
    return this.request(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record)
    });
  }

  // Worker route operations
  async listWorkerRoutes(zoneId) {
    return this.request(`/zones/${zoneId}/workers/routes`);
  }

  async createWorkerRoute(zoneId, pattern, workerName) {
    return this.request(`/zones/${zoneId}/workers/routes`, {
      method: 'POST',
      body: JSON.stringify({
        pattern,
        script: workerName
      })
    });
  }

  async deleteWorkerRoute(zoneId, routeId) {
    return this.request(`/zones/${zoneId}/workers/routes/${routeId}`, {
      method: 'DELETE'
    });
  }
}

// ============== Wrangler Operations ==============

async function createKvNamespace(name, cwd, dryRun = false) {
  if (dryRun) {
    console.log(`  [DRY RUN] Would create KV namespace: ${name}`);
    return 'dry-run-namespace-id';
  }

  try {
    const output = execSync(`wrangler kv namespace create ${name}`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Parse: { "id": "abc123..." } or "id = abc123"
    const jsonMatch = output.match(/"id"\s*:\s*"([a-f0-9]+)"/i);
    const tomlMatch = output.match(/id\s*=\s*"?([a-f0-9]+)"?/i);

    const id = jsonMatch?.[1] || tomlMatch?.[1];
    if (!id) {
      console.log('Wrangler output:', output);
      throw new Error('Failed to parse KV namespace ID from wrangler output');
    }

    return id;
  } catch (error) {
    // Check if namespace already exists
    if (error.message?.includes('already exists') || error.stderr?.includes('already exists')) {
      console.log('  KV namespace already exists, listing to get ID...');
      const listOutput = execSync('wrangler kv namespace list', {
        encoding: 'utf-8',
        cwd
      });

      // Parse JSON array output
      try {
        const namespaces = JSON.parse(listOutput);
        const ns = namespaces.find(n => n.title.includes(name));
        if (ns) return ns.id;
      } catch {
        // Try regex fallback
        const match = listOutput.match(new RegExp(`"id"\\s*:\\s*"([a-f0-9]+)"[^}]*"title"\\s*:\\s*"[^"]*${name}`, 'i'));
        if (match) return match[1];
      }

      throw new Error('KV namespace exists but could not find its ID');
    }
    throw error;
  }
}

function updateWranglerToml(path, kvNamespaceId, dryRun = false) {
  let content = readFileSync(path, 'utf-8');

  if (content.includes('YOUR_KV_NAMESPACE_ID')) {
    if (dryRun) {
      console.log(`  [DRY RUN] Would update wrangler.toml with KV ID: ${kvNamespaceId}`);
      return;
    }

    content = content.replace(
      /id = "YOUR_KV_NAMESPACE_ID"/,
      `id = "${kvNamespaceId}"`
    );
    writeFileSync(path, content);
  }
}

async function deployWorker(cwd, dryRun = false) {
  if (dryRun) {
    console.log('  [DRY RUN] Would deploy worker with: wrangler deploy');
    return;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('wrangler', ['deploy'], {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wrangler deploy failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function setWorkerSecret(secretName, secretValue, cwd, dryRun = false) {
  if (dryRun) {
    console.log(`  [DRY RUN] Would set secret: ${secretName}`);
    return;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('wrangler', ['secret', 'put', secretName], {
      cwd,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true
    });

    proc.stdin.write(secretValue);
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wrangler secret put ${secretName} failed`));
      }
    });

    proc.on('error', reject);
  });
}

async function deployPages(directory, projectName, dryRun = false) {
  if (dryRun) {
    console.log(`  [DRY RUN] Would deploy Pages: wrangler pages deploy ${directory} --project-name ${projectName}`);
    return { success: true };
  }

  return new Promise((resolve) => {
    const proc = spawn('wrangler', ['pages', 'deploy', directory, '--project-name', projectName], {
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      resolve({ success: code === 0, code });
    });

    proc.on('error', () => {
      resolve({ success: false, error: 'spawn failed' });
    });
  });
}

// ============== DNS Configuration ==============

async function configureDns(cf, zoneId, domain, pagesTarget, dryRun = false) {
  console.log('\nConfiguring DNS records...');

  // List existing records
  const records = await cf.listDnsRecords(zoneId);

  // Find conflicting A/AAAA records for root and wildcard
  const rootConflicts = records.filter(r =>
    r.name === domain && (r.type === 'A' || r.type === 'AAAA')
  );
  const wildcardConflicts = records.filter(r =>
    r.name === `*.${domain}` && (r.type === 'A' || r.type === 'AAAA')
  );

  // Delete conflicting records
  for (const record of [...rootConflicts, ...wildcardConflicts]) {
    if (dryRun) {
      console.log(`  [DRY RUN] Would delete ${record.type} record: ${record.name} -> ${record.content}`);
    } else {
      console.log(`  Deleting conflicting ${record.type} record: ${record.name}`);
      await cf.deleteDnsRecord(zoneId, record.id);
    }
  }

  // Check/create root CNAME
  const rootCname = records.find(r => r.name === domain && r.type === 'CNAME');
  if (!rootCname) {
    if (dryRun) {
      console.log(`  [DRY RUN] Would create CNAME: @ -> ${pagesTarget}`);
    } else {
      console.log(`  Creating CNAME: @ -> ${pagesTarget}`);
      await cf.createDnsRecord(zoneId, {
        type: 'CNAME',
        name: '@',
        content: pagesTarget,
        proxied: true,
        ttl: 1 // Auto
      });
    }
  } else {
    console.log(`  Root CNAME already exists: ${rootCname.content}`);
  }

  // Check/create wildcard CNAME
  const wildcardCname = records.find(r => r.name === `*.${domain}` && r.type === 'CNAME');
  if (!wildcardCname) {
    if (dryRun) {
      console.log(`  [DRY RUN] Would create CNAME: * -> ${pagesTarget}`);
    } else {
      console.log(`  Creating CNAME: * -> ${pagesTarget}`);
      await cf.createDnsRecord(zoneId, {
        type: 'CNAME',
        name: '*',
        content: pagesTarget,
        proxied: true,
        ttl: 1 // Auto
      });
    }
  } else {
    console.log(`  Wildcard CNAME already exists: ${wildcardCname.content}`);
  }

  console.log('  DNS configuration complete!');
}

// ============== Worker Routes ==============

async function configureRoutes(cf, zoneId, domain, workerName, dryRun = false) {
  console.log('\nConfiguring worker routes...');

  const requiredRoutes = [
    `*.${domain}/*`,           // Wildcard subdomains
    `${domain}/api/*`,         // Root domain API
    `${domain}/webhooks/*`     // Root domain webhooks
  ];

  const existingRoutes = await cf.listWorkerRoutes(zoneId);

  for (const pattern of requiredRoutes) {
    const existing = existingRoutes.find(r => r.pattern === pattern);

    if (!existing) {
      if (dryRun) {
        console.log(`  [DRY RUN] Would create route: ${pattern} -> ${workerName}`);
      } else {
        console.log(`  Creating route: ${pattern} -> ${workerName}`);
        try {
          await cf.createWorkerRoute(zoneId, pattern, workerName);
        } catch (error) {
          if (error.message.includes('duplicate')) {
            console.log(`    Route already exists (duplicate)`);
          } else {
            throw error;
          }
        }
      }
    } else {
      console.log(`  Route exists: ${pattern}`);
    }
  }

  console.log('  Worker routes configured!');
}

// ============== Verification ==============

async function verifyDeployment(domain) {
  console.log('\nVerifying deployment...');

  const checks = [
    { name: 'Landing page', url: `https://${domain}`, expect: 'html' },
    { name: 'API stats', url: `https://${domain}/api/stats`, expect: 'json' },
    { name: 'Subdomain routing', url: `https://test.${domain}`, expect: 'html' }
  ];

  const results = [];

  for (const check of checks) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(check.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'vibes-deploy/1.0' }
      });

      clearTimeout(timeout);

      const contentType = response.headers.get('content-type') || '';
      const ok = check.expect === 'json'
        ? contentType.includes('application/json')
        : contentType.includes('text/html');

      results.push({
        ...check,
        status: ok ? 'PASS' : 'WARN',
        code: response.status,
        contentType
      });
    } catch (err) {
      results.push({
        ...check,
        status: 'FAIL',
        error: err.name === 'AbortError' ? 'Timeout' : err.message
      });
    }
  }

  // Print results
  console.log('\nVerification Results:');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    const detail = r.error || `HTTP ${r.code}`;
    console.log(`  ${icon} ${r.name}: ${r.status} (${detail})`);
  }

  const allPassed = results.every(r => r.status === 'PASS');
  const anyFailed = results.some(r => r.status === 'FAIL');

  if (anyFailed) {
    console.log('\n  Note: Some checks failed. This may be due to DNS propagation.');
    console.log('  Wait a few minutes and try: --verify-only');
  }

  return { results, allPassed };
}

// ============== Clerk Checklist ==============

function printClerkChecklist(domain, pagesProject) {
  if (existsSync(CLERK_CHECKLIST_PATH)) {
    let checklist = readFileSync(CLERK_CHECKLIST_PATH, 'utf8');
    checklist = checklist
      .split('__APP_DOMAIN__').join(domain)
      .split('__PAGES_PROJECT__').join(pagesProject);
    console.log(checklist);
  } else {
    // Fallback if template not found
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MANUAL STEPS: Configure Clerk at https://dashboard.clerk.com

  1. Add authorized domains: ${domain}, *.${domain}, ${pagesProject}.pages.dev
  2. Enable Clerk Billing and connect Stripe
  3. Create subscription plans: "pro", "monthly", "yearly"
  4. Set up webhook: https://${domain}/webhooks/clerk
  5. Get your Admin User ID from Clerk Dashboard → Users
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  }
}

// ============== Main Execution ==============

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log(`
${'━'.repeat(70)}
  VIBES SELL DEPLOYMENT AUTOMATION
${'━'.repeat(70)}
`);

  // Phase 1: Pre-flight checks
  console.log('Phase 1: Pre-flight checks...');

  if (!checkWranglerInstalled()) {
    console.error('\n✗ ERROR: wrangler CLI not found.');
    console.error('  Install with: npm install -g wrangler');
    console.error('  Then login with: wrangler login');
    process.exit(1);
  }
  console.log('  ✓ wrangler CLI installed');

  const outputDir = process.cwd();
  const fileCheck = checkFilesExist(outputDir);

  if (!fileCheck.valid) {
    console.error(`\n✗ ERROR: Missing required files: ${fileCheck.missing.join(', ')}`);
    console.error('  Run assemble-sell.js first to generate these files.');
    console.error('  Example: node scripts/assemble-sell.js app.jsx index.html --clerk-key pk_test_xxx ...');
    process.exit(1);
  }
  console.log('  ✓ Required files found (index.html, worker.js, wrangler.toml)');

  // Parse wrangler.toml for defaults
  const wranglerInfo = parseWranglerToml(outputDir);

  // Load config
  let config = loadConfig();
  let projectConfig = args.project ? getProjectConfig(config, args.project) : null;

  // Handle --reset
  if (args.reset && args.project) {
    delete config.projects[args.project];
    saveConfig(config);
    console.log(`  Reset configuration for project: ${args.project}`);
    projectConfig = null;
  }

  // Phase 2: Collect configuration
  console.log('\nPhase 2: Configuration...');

  if (!projectConfig) {
    const defaultProject = wranglerInfo.workerName?.replace('-wildcard', '') || 'my-saas';
    const projectName = await prompt(`Project name [${defaultProject}]: `) || defaultProject;

    const defaultDomain = wranglerInfo.pagesHostname?.replace('.pages.dev', '.com') || 'example.com';
    const domain = await prompt(`Root domain [${defaultDomain}]: `) || defaultDomain;

    const defaultPagesProject = wranglerInfo.pagesHostname?.replace('.pages.dev', '') || projectName;
    const pagesProject = await prompt(`Pages project name [${defaultPagesProject}]: `) || defaultPagesProject;

    projectConfig = {
      projectName,
      domain,
      pagesProject,
      workerName: wranglerInfo.workerName || `${pagesProject}-wildcard`,
      createdAt: new Date().toISOString()
    };

    config.projects[projectName] = projectConfig;
  }

  console.log(`  Project: ${projectConfig.projectName}`);
  console.log(`  Domain: ${projectConfig.domain}`);
  console.log(`  Pages project: ${projectConfig.pagesProject}`);

  // Get Cloudflare credentials
  let apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken && !args.verifyOnly && !args.dryRun) {
    console.log('\n  Cloudflare API Token required for deployment.');
    console.log('  Create one at: https://dash.cloudflare.com/profile/api-tokens');
    console.log('  Required permissions: Zone:DNS:Edit, Zone:Zone:Read');
    apiToken = await promptSecret('  Cloudflare API Token: ');
  }

  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || projectConfig.accountId;
  if (!accountId && !args.verifyOnly && !args.dryRun) {
    console.log('\n  Cloudflare Account ID required.');
    console.log('  Find it at: https://dash.cloudflare.com/ (right sidebar)');
    accountId = await prompt('  Cloudflare Account ID: ');
    projectConfig.accountId = accountId;
  }

  // Verify-only mode
  if (args.verifyOnly) {
    await verifyDeployment(projectConfig.domain);
    process.exit(0);
  }

  const cf = apiToken ? new CloudflareAPI(apiToken, accountId) : null;

  // Get zone ID
  if (cf && !projectConfig.zoneId && !args.skipDns && !args.skipRoutes) {
    console.log('\n  Looking up Zone ID...');
    try {
      projectConfig.zoneId = await cf.getZoneId(projectConfig.domain);
      console.log(`  ✓ Zone ID: ${projectConfig.zoneId}`);
    } catch (error) {
      console.error(`  ✗ ${error.message}`);
      console.error('  Use --skip-dns and --skip-routes to skip Cloudflare API operations.');
      process.exit(1);
    }
  }

  // Phase 3: KV Namespace
  console.log('\nPhase 3: KV Namespace...');

  if (!projectConfig.kvNamespaceId) {
    console.log('  Creating KV namespace...');
    try {
      const kvId = await createKvNamespace('TENANTS', outputDir, args.dryRun);
      projectConfig.kvNamespaceId = kvId;
      console.log(`  ✓ KV namespace ID: ${kvId}`);

      // Update wrangler.toml
      updateWranglerToml(join(outputDir, 'wrangler.toml'), kvId, args.dryRun);
      console.log('  ✓ Updated wrangler.toml');
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(`  ✓ KV namespace already configured: ${projectConfig.kvNamespaceId}`);
  }

  // Phase 4: Deploy Worker
  console.log('\nPhase 4: Deploy Worker...');

  try {
    await deployWorker(outputDir, args.dryRun);
    console.log('  ✓ Worker deployed');
  } catch (error) {
    console.error(`  ✗ Worker deployment failed: ${error.message}`);
    process.exit(1);
  }

  // Set Clerk secret
  console.log('\n  Setting CLERK_SECRET_KEY...');
  if (!args.dryRun) {
    console.log('  Enter your Clerk Secret Key (sk_test_... or sk_live_...)');
    const clerkSecret = await promptSecret('  Clerk Secret Key: ');

    if (clerkSecret) {
      try {
        await setWorkerSecret('CLERK_SECRET_KEY', clerkSecret, outputDir, args.dryRun);
        console.log('  ✓ Secret configured');
      } catch (error) {
        console.error(`  ✗ Error setting secret: ${error.message}`);
      }
    } else {
      console.log('  ⚠ Skipped (no key provided)');
    }
  } else {
    console.log('  [DRY RUN] Would prompt for CLERK_SECRET_KEY');
  }

  // Phase 5: DNS Configuration
  if (!args.skipDns && cf && projectConfig.zoneId) {
    console.log('\nPhase 5: DNS Configuration...');

    const pagesTarget = `${projectConfig.pagesProject}.pages.dev`;
    try {
      await configureDns(cf, projectConfig.zoneId, projectConfig.domain, pagesTarget, args.dryRun);
    } catch (error) {
      console.error(`  ✗ DNS configuration error: ${error.message}`);
      console.log('  You may need to configure DNS manually in the Cloudflare dashboard.');
    }
  } else if (args.skipDns) {
    console.log('\nPhase 5: DNS Configuration... SKIPPED');
  }

  // Phase 6: Worker Routes
  if (!args.skipRoutes && cf && projectConfig.zoneId) {
    console.log('\nPhase 6: Worker Routes...');

    try {
      await configureRoutes(cf, projectConfig.zoneId, projectConfig.domain, projectConfig.workerName, args.dryRun);
    } catch (error) {
      console.error(`  ✗ Route configuration error: ${error.message}`);
      console.log('  You may need to configure routes manually in the Cloudflare dashboard.');
    }
  } else if (args.skipRoutes) {
    console.log('\nPhase 6: Worker Routes... SKIPPED');
  }

  // Phase 7: Pages Deployment
  if (!args.skipPages) {
    console.log('\nPhase 7: Pages Deployment...');

    const result = await deployPages('.', projectConfig.pagesProject, args.dryRun);

    if (result.success) {
      console.log('  ✓ Pages deployed');
    } else {
      console.log(`
  ⚠ Pages deployment may require manual setup for first-time deployments.

  Manual Steps:
  1. Go to: https://dash.cloudflare.com/ → Workers & Pages
  2. Click "Create" → "Pages" → "Upload assets"
  3. Project name: ${projectConfig.pagesProject}
  4. Upload index.html
  5. After deployment, add custom domain: ${projectConfig.domain}
`);
    }
  } else {
    console.log('\nPhase 7: Pages Deployment... SKIPPED');
  }

  // Save config
  projectConfig.lastDeployed = new Date().toISOString();
  saveConfig(config);
  console.log(`\n  ✓ Configuration saved to ${CONFIG_PATH}`);

  // Phase 8: Verification
  if (!args.skipVerify && !args.dryRun) {
    console.log('\nPhase 8: Verification...');
    console.log('  Waiting 10 seconds for deployment to propagate...');
    await new Promise(r => setTimeout(r, 10000));

    await verifyDeployment(projectConfig.domain);
  }

  // Print Clerk checklist
  printClerkChecklist(projectConfig.domain, projectConfig.pagesProject);

  console.log(`
${'━'.repeat(70)}
  DEPLOYMENT COMPLETE
${'━'.repeat(70)}

Next steps:
1. Complete the Clerk configuration checklist above
2. Test your deployment at https://${projectConfig.domain}
3. Sign up and get your admin user ID for full access

To redeploy later:
  node scripts/deploy-sell.js --project ${projectConfig.projectName}

To verify deployment:
  node scripts/deploy-sell.js --project ${projectConfig.projectName} --verify-only
`);
}

main().catch((error) => {
  console.error('\n✗ Deployment failed:', error.message);
  process.exit(1);
});
