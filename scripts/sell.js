#!/usr/bin/env node
/**
 * Vibes Sell - Unified SaaS Deployment CLI
 *
 * Single command to build and deploy SaaS apps from app.jsx to production.
 *
 * Usage:
 *   node scripts/sell.js <command> [options]
 *
 * Commands:
 *   init          Create sell.config.json interactively
 *   assemble      Generate index.html, worker.js, wrangler.toml from config
 *   deploy        Assemble (if needed) and deploy to Cloudflare
 *   verify        Test deployed endpoints
 *   config        Show current configuration
 *
 * Options:
 *   --force           Force operation even if unchanged
 *   --skip-dns        Skip DNS configuration
 *   --skip-routes     Skip worker route configuration
 *   --skip-pages      Skip Pages deployment
 *   --skip-verify     Skip verification step
 *   --worker-only     Only deploy worker
 *   --pages-only      Only deploy pages
 *   --dry-run         Show what would be done without executing
 *   --from-wrangler   Init from existing wrangler.toml
 *
 * Examples:
 *   node scripts/sell.js init
 *   node scripts/sell.js deploy
 *   node scripts/sell.js deploy --worker-only
 *   node scripts/sell.js verify
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import * as readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = 'sell.config.json';
const SKILL_DIR = join(__dirname, '../skills/sell');

// ============== Argument Parsing ==============

function parseArgs(argv) {
  const args = {
    command: null,
    force: false,
    skipDns: false,
    skipRoutes: false,
    skipPages: false,
    skipVerify: false,
    workerOnly: false,
    pagesOnly: false,
    dryRun: false,
    fromWrangler: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-') && !args.command) {
      args.command = arg;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--skip-dns') {
      args.skipDns = true;
    } else if (arg === '--skip-routes') {
      args.skipRoutes = true;
    } else if (arg === '--skip-pages') {
      args.skipPages = true;
    } else if (arg === '--skip-verify') {
      args.skipVerify = true;
    } else if (arg === '--worker-only') {
      args.workerOnly = true;
    } else if (arg === '--pages-only') {
      args.pagesOnly = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--from-wrangler') {
      args.fromWrangler = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Vibes Sell - Unified SaaS Deployment CLI
=========================================

Commands:
  init          Create sell.config.json interactively
  assemble      Generate index.html, worker.js, wrangler.toml from config
  deploy        Assemble (if needed) and deploy to Cloudflare
  verify        Test deployed endpoints
  config        Show current configuration

Options:
  --force           Force operation even if unchanged
  --skip-dns        Skip DNS configuration
  --skip-routes     Skip worker route configuration
  --skip-pages      Skip Pages deployment
  --skip-verify     Skip verification step
  --worker-only     Only deploy worker
  --pages-only      Only deploy pages
  --dry-run         Show what would be done without executing
  --from-wrangler   Init from existing wrangler.toml

Examples:
  node scripts/sell.js init
  node scripts/sell.js assemble
  node scripts/sell.js deploy
  node scripts/sell.js deploy --worker-only
  node scripts/sell.js verify
`);
}

// ============== User Input Helpers ==============

function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

async function prompt(question, defaultValue = '') {
  const rl = createReadline();
  const displayDefault = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${displayDefault}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function promptSecret(question) {
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
        resolve(input);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007F' || char === '\b') {
        if (input.length > 0) input = input.slice(0, -1);
      } else {
        input += char;
      }
    };

    process.stdin.on('data', onData);
  });
}

// ============== Config Management ==============

function loadConfig() {
  const configPath = join(process.cwd(), CONFIG_FILE);
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`Error reading ${CONFIG_FILE}: ${err.message}`);
    process.exit(1);
  }
}

function saveConfig(config) {
  const configPath = join(process.cwd(), CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function validateConfig(config) {
  const errors = [];

  if (!config.app?.source) errors.push('Missing app.source');
  if (!config.app?.name) errors.push('Missing app.name');
  if (!config.domain) errors.push('Missing domain');
  if (!config.clerk?.publishableKey) errors.push('Missing clerk.publishableKey');

  if (config.app?.name && !/^[a-z0-9-]+$/.test(config.app.name)) {
    errors.push('app.name must be lowercase letters, numbers, and hyphens');
  }

  if (config.clerk?.publishableKey && !config.clerk.publishableKey.startsWith('pk_')) {
    errors.push('clerk.publishableKey must start with pk_test_ or pk_live_');
  }

  if (config.app?.source && !existsSync(join(process.cwd(), config.app.source))) {
    errors.push(`App source file not found: ${config.app.source}`);
  }

  return errors;
}

function getContentHash(config) {
  const appPath = join(process.cwd(), config.app.source);
  const appCode = existsSync(appPath) ? readFileSync(appPath, 'utf-8') : '';
  const configJson = JSON.stringify({
    app: config.app,
    domain: config.domain,
    pricing: config.pricing,
    features: config.features,
    clerk: config.clerk,
    admin: config.admin
  });

  return createHash('sha256')
    .update(appCode)
    .update(configJson)
    .digest('hex')
    .slice(0, 12);
}

// ============== Template Processing ==============

function loadTemplate(name) {
  const templatePath = join(SKILL_DIR, 'templates', name);
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  return readFileSync(templatePath, 'utf-8');
}

function loadWorkerTemplate(name) {
  const templatePath = join(SKILL_DIR, 'worker', name);
  if (!existsSync(templatePath)) {
    throw new Error(`Worker template not found: ${templatePath}`);
  }
  return readFileSync(templatePath, 'utf-8');
}

function loadAdminComponent() {
  const adminPath = join(SKILL_DIR, 'components', 'admin.jsx');
  if (!existsSync(adminPath)) {
    throw new Error(`Admin component not found: ${adminPath}`);
  }
  let code = readFileSync(adminPath, 'utf-8').trim();
  // Remove import statements
  code = code.replace(/^import\s+.*?from\s+["'].*?["'];?\s*$/gm, '');
  code = code.replace(/^import\s+["'].*?["'];?\s*$/gm, '');
  return code;
}

function applyReplacements(template, config) {
  const pagesProject = config.cloudflare?.pagesProject || config.app.name;

  const replacements = {
    '__CLERK_PUBLISHABLE_KEY__': config.clerk.publishableKey,
    '__APP_NAME__': config.app.name,
    '__APP_NAME_UPPER__': config.app.name.toUpperCase(),
    '__APP_TITLE__': config.app.title || config.app.name,
    '__APP_DOMAIN__': config.domain,
    '__MONTHLY_PRICE__': config.pricing?.monthly || '$9',
    '__YEARLY_PRICE__': config.pricing?.yearly || '$89',
    '__APP_TAGLINE__': config.app.tagline || 'Your own private workspace. Get started in seconds.',
    '__FEATURES__': JSON.stringify(config.features || ['Unlimited usage', 'Private workspace', 'Custom subdomain']),
    '__ADMIN_USER_IDS__': JSON.stringify(config.admin?.userIds || []),
    '__PAGES_PROJECT__': pagesProject,
    '__WORKER_NAME__': `${pagesProject}-wildcard`
  };

  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.split(placeholder).join(value);
  }
  return result;
}

// ============== Commands ==============

async function commandInit(args) {
  console.log('\n━━━ Vibes Sell: Initialize Project ━━━\n');

  let config = {
    $schema: './node_modules/vibes-skill/skills/sell/sell.config.schema.json',
    app: {},
    pricing: {},
    clerk: {},
    admin: { userIds: [] },
    cloudflare: {},
    deployment: {}
  };

  // Try to read from existing wrangler.toml
  if (args.fromWrangler && existsSync('wrangler.toml')) {
    console.log('Reading from existing wrangler.toml...\n');
    const toml = readFileSync('wrangler.toml', 'utf-8');

    const nameMatch = toml.match(/name\s*=\s*"([^"]+)"/);
    const domainMatch = toml.match(/APP_DOMAIN\s*=\s*"([^"]+)"/);
    const pagesMatch = toml.match(/PAGES_HOSTNAME\s*=\s*"([^"]+)"/);
    const kvMatch = toml.match(/id\s*=\s*"([a-f0-9]+)"/i);

    if (nameMatch) {
      const workerName = nameMatch[1];
      config.app.name = workerName.replace('-wildcard', '');
    }
    if (domainMatch) config.domain = domainMatch[1];
    if (pagesMatch) {
      const pagesProject = pagesMatch[1].replace('.pages.dev', '');
      config.cloudflare.pagesProject = pagesProject;
    }
    if (kvMatch && kvMatch[1] !== 'YOUR_KV_NAMESPACE_ID') {
      config.cloudflare.kvNamespaceId = kvMatch[1];
    }
  }

  // Interactive prompts
  config.app.source = await prompt('App source file', config.app.source || 'app.jsx');
  config.app.name = await prompt('App name (lowercase, hyphens)', config.app.name || '');
  config.app.title = await prompt('Display title', config.app.title || config.app.name);
  config.app.tagline = await prompt('Tagline', config.app.tagline || 'Your own private workspace.');
  config.domain = await prompt('Root domain', config.domain || '');
  config.pricing.monthly = await prompt('Monthly price', config.pricing.monthly || '$9');
  config.pricing.yearly = await prompt('Yearly price', config.pricing.yearly || '$89');

  const featuresInput = await prompt('Features (comma-separated)', 'Unlimited usage, Private workspace, Custom subdomain');
  config.features = featuresInput.split(',').map(f => f.trim()).filter(Boolean);

  config.clerk.publishableKey = await prompt('Clerk publishable key (pk_test_...)', config.clerk?.publishableKey || '');

  config.cloudflare.pagesProject = config.cloudflare.pagesProject || config.app.name;

  // Validate
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.log('\n⚠️  Validation warnings:');
    errors.forEach(e => console.log(`   - ${e}`));
    console.log('\nYou can fix these in sell.config.json later.');
  }

  // Save
  saveConfig(config);
  console.log(`\n✓ Created ${CONFIG_FILE}`);
  console.log('\nNext steps:');
  console.log('  1. Review and edit sell.config.json if needed');
  console.log('  2. Run: node scripts/sell.js assemble');
  console.log('  3. Run: node scripts/sell.js deploy');
}

async function commandAssemble(args) {
  console.log('\n━━━ Vibes Sell: Assemble ━━━\n');

  const config = loadConfig();
  if (!config) {
    console.error(`✗ ${CONFIG_FILE} not found. Run: node scripts/sell.js init`);
    process.exit(1);
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('✗ Configuration errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  // Check if assembly needed
  const currentHash = getContentHash(config);
  if (!args.force && config.deployment?.hash === currentHash) {
    console.log('✓ No changes detected. Use --force to reassemble.');
    return;
  }

  console.log(`Assembling ${config.app.name}...`);

  // Load templates
  let html = loadTemplate('unified.html');
  let workerJs = loadWorkerTemplate('index.js');
  let wranglerToml = loadWorkerTemplate('wrangler.toml');
  const adminCode = loadAdminComponent();

  // Load and process app code
  const appPath = join(process.cwd(), config.app.source);
  let appCode = readFileSync(appPath, 'utf-8').trim();
  // Remove imports (template provides them)
  appCode = appCode.replace(/^import\s+.*?from\s+["'].*?["'];?\s*$/gm, '');
  appCode = appCode.replace(/^import\s+["'].*?["'];?\s*$/gm, '');
  appCode = appCode.replace(/^export\s+default\s+/m, '');

  // Inject code
  html = html.replace('// __VIBES_APP_CODE__', appCode);
  html = html.replace('__ADMIN_CODE__', adminCode);

  // Apply config replacements
  html = applyReplacements(html, config);
  workerJs = applyReplacements(workerJs, config);
  wranglerToml = applyReplacements(wranglerToml, config);

  // Update KV namespace ID if we have it
  if (config.cloudflare?.kvNamespaceId) {
    wranglerToml = wranglerToml.replace(
      'id = "YOUR_KV_NAMESPACE_ID"',
      `id = "${config.cloudflare.kvNamespaceId}"`
    );
  }

  // Write files
  if (args.dryRun) {
    console.log('[DRY RUN] Would write: index.html, worker.js, wrangler.toml');
  } else {
    writeFileSync('index.html', html);
    writeFileSync('worker.js', workerJs);
    writeFileSync('wrangler.toml', wranglerToml);

    // Update config with hash
    config.deployment = config.deployment || {};
    config.deployment.hash = currentHash;
    config.deployment.assembledAt = new Date().toISOString();
    saveConfig(config);

    console.log('✓ Created: index.html');
    console.log('✓ Created: worker.js');
    console.log('✓ Created: wrangler.toml');
  }

  // Print deployment guide
  const guide = loadTemplate('deployment-guide.txt');
  console.log(applyReplacements(guide, config));
}

async function commandDeploy(args) {
  console.log('\n━━━ Vibes Sell: Deploy ━━━\n');

  const config = loadConfig();
  if (!config) {
    console.error(`✗ ${CONFIG_FILE} not found. Run: node scripts/sell.js init`);
    process.exit(1);
  }

  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('✗ Configuration errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  // Check if wrangler is installed
  try {
    execSync('wrangler --version', { stdio: 'pipe' });
  } catch {
    console.error('✗ wrangler CLI not found. Install with: npm install -g wrangler');
    process.exit(1);
  }

  // Check if assembly needed
  const currentHash = getContentHash(config);
  const needsAssembly = args.force ||
    !existsSync('index.html') ||
    !existsSync('worker.js') ||
    config.deployment?.hash !== currentHash;

  if (needsAssembly && !args.workerOnly && !args.pagesOnly) {
    console.log('Changes detected, assembling...\n');
    await commandAssemble({ ...args, force: true });
    console.log('');
  }

  // Phase 1: KV Namespace
  if (!args.pagesOnly) {
    console.log('Phase 1: KV Namespace...');
    if (!config.cloudflare?.kvNamespaceId) {
      if (args.dryRun) {
        console.log('  [DRY RUN] Would create KV namespace: TENANTS');
      } else {
        try {
          const output = execSync('wrangler kv namespace create TENANTS', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
          });

          const jsonMatch = output.match(/"id"\s*:\s*"([a-f0-9]+)"/i);
          const tomlMatch = output.match(/id\s*=\s*"?([a-f0-9]+)"?/i);
          const id = jsonMatch?.[1] || tomlMatch?.[1];

          if (id) {
            config.cloudflare = config.cloudflare || {};
            config.cloudflare.kvNamespaceId = id;
            saveConfig(config);

            // Update wrangler.toml
            let toml = readFileSync('wrangler.toml', 'utf-8');
            toml = toml.replace(/id = "[^"]*"/, `id = "${id}"`);
            writeFileSync('wrangler.toml', toml);

            console.log(`  ✓ Created KV namespace: ${id}`);
          }
        } catch (err) {
          if (err.stderr?.includes('already exists')) {
            console.log('  KV namespace exists, listing...');
            try {
              const list = execSync('wrangler kv namespace list', { encoding: 'utf-8' });
              const namespaces = JSON.parse(list);
              const ns = namespaces.find(n => n.title.includes('TENANTS'));
              if (ns) {
                config.cloudflare = config.cloudflare || {};
                config.cloudflare.kvNamespaceId = ns.id;
                saveConfig(config);

                let toml = readFileSync('wrangler.toml', 'utf-8');
                toml = toml.replace(/id = "[^"]*"/, `id = "${ns.id}"`);
                writeFileSync('wrangler.toml', toml);

                console.log(`  ✓ Found existing KV namespace: ${ns.id}`);
              }
            } catch {
              console.log('  ⚠ Could not get KV namespace ID');
            }
          } else {
            console.error(`  ✗ KV error: ${err.message}`);
          }
        }
      }
    } else {
      console.log(`  ✓ KV namespace: ${config.cloudflare.kvNamespaceId}`);
    }
  }

  // Phase 2: Deploy Worker
  if (!args.pagesOnly) {
    console.log('\nPhase 2: Deploy Worker...');
    if (args.dryRun) {
      console.log('  [DRY RUN] Would run: wrangler deploy');
    } else {
      await new Promise((resolve, reject) => {
        const proc = spawn('wrangler', ['deploy'], {
          stdio: 'inherit',
          shell: true
        });
        proc.on('close', (code) => {
          if (code === 0) {
            console.log('  ✓ Worker deployed');
            resolve();
          } else {
            reject(new Error(`wrangler deploy failed with code ${code}`));
          }
        });
        proc.on('error', reject);
      });

      // Set Clerk secret if needed
      console.log('\n  Setting CLERK_SECRET_KEY...');
      console.log('  Enter your Clerk Secret Key (sk_test_... or sk_live_...)');
      const clerkSecret = await promptSecret('  Clerk Secret Key: ');

      if (clerkSecret) {
        await new Promise((resolve, reject) => {
          const proc = spawn('wrangler', ['secret', 'put', 'CLERK_SECRET_KEY'], {
            stdio: ['pipe', 'inherit', 'inherit'],
            shell: true
          });
          proc.stdin.write(clerkSecret);
          proc.stdin.end();
          proc.on('close', (code) => {
            if (code === 0) {
              console.log('  ✓ Secret configured');
              resolve();
            } else {
              reject(new Error('Failed to set secret'));
            }
          });
          proc.on('error', reject);
        });
      }
    }
  }

  // Phase 3: Configure DNS (requires API token)
  if (!args.skipDns && !args.workerOnly && !args.pagesOnly) {
    console.log('\nPhase 3: DNS Configuration...');
    console.log('  ⚠ DNS configuration requires Cloudflare API token.');
    console.log('  Run node scripts/deploy-sell.js for full automation,');
    console.log('  or configure DNS manually in Cloudflare dashboard.');
  }

  // Phase 4: Configure Routes
  if (!args.skipRoutes && !args.workerOnly && !args.pagesOnly) {
    console.log('\nPhase 4: Worker Routes...');
    console.log('  Routes are defined in wrangler.toml.');
    console.log('  If they don\'t apply, add manually in Cloudflare dashboard:');
    console.log(`    *.${config.domain}/*`);
    console.log(`    ${config.domain}/api/*`);
    console.log(`    ${config.domain}/webhooks/*`);
  }

  // Phase 5: Deploy Pages
  if (!args.skipPages && !args.workerOnly) {
    console.log('\nPhase 5: Deploy Pages...');
    const pagesProject = config.cloudflare?.pagesProject || config.app.name;

    if (args.dryRun) {
      console.log(`  [DRY RUN] Would run: wrangler pages deploy . --project-name ${pagesProject}`);
    } else {
      await new Promise((resolve) => {
        const proc = spawn('wrangler', ['pages', 'deploy', '.', '--project-name', pagesProject], {
          stdio: 'inherit',
          shell: true
        });
        proc.on('close', (code) => {
          if (code === 0) {
            console.log('  ✓ Pages deployed');
          } else {
            console.log('  ⚠ Pages deployment may require manual setup.');
            console.log(`    Create project "${pagesProject}" in Cloudflare dashboard.`);
          }
          resolve();
        });
        proc.on('error', () => resolve());
      });
    }
  }

  // Update deployment info
  config.deployment = config.deployment || {};
  config.deployment.lastDeployed = new Date().toISOString();
  config.deployment.workerName = `${config.cloudflare?.pagesProject || config.app.name}-wildcard`;
  saveConfig(config);

  // Phase 6: Verify
  if (!args.skipVerify && !args.dryRun) {
    console.log('\nPhase 6: Verification...');
    console.log('  Waiting 5 seconds for deployment to propagate...');
    await new Promise(r => setTimeout(r, 5000));
    await commandVerify(args);
  }

  // Print Clerk checklist
  const checklist = loadTemplate('clerk-checklist.txt');
  console.log(applyReplacements(checklist, config));

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEPLOYMENT COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To redeploy after changes:
  node scripts/sell.js deploy

To verify:
  node scripts/sell.js verify
`);
}

async function commandVerify(args) {
  const config = loadConfig();
  if (!config) {
    console.error(`✗ ${CONFIG_FILE} not found.`);
    process.exit(1);
  }

  console.log('\n━━━ Vibes Sell: Verify Deployment ━━━\n');

  const checks = [
    { name: 'Landing page', url: `https://${config.domain}`, expect: 'html' },
    { name: 'API stats', url: `https://${config.domain}/api/stats`, expect: 'json' },
    { name: 'Subdomain routing', url: `https://test.${config.domain}`, expect: 'html' }
  ];

  const results = [];

  for (const check of checks) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(check.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'vibes-sell/1.0' }
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
  console.log('Results:');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    const detail = r.error || `HTTP ${r.code}`;
    console.log(`  ${icon} ${r.name}: ${r.status} (${detail})`);
  }

  const anyFailed = results.some(r => r.status === 'FAIL');
  if (anyFailed) {
    console.log('\n  Note: Some checks failed. This may be due to DNS propagation.');
  }
}

async function commandConfig(args) {
  const config = loadConfig();
  if (!config) {
    console.log(`No ${CONFIG_FILE} found. Run: node scripts/sell.js init`);
    return;
  }

  console.log('\n━━━ Vibes Sell: Current Configuration ━━━\n');
  console.log(JSON.stringify(config, null, 2));
}

// ============== Main ==============

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || !args.command) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  switch (args.command) {
    case 'init':
      await commandInit(args);
      break;
    case 'assemble':
      await commandAssemble(args);
      break;
    case 'deploy':
      await commandDeploy(args);
      break;
    case 'verify':
      await commandVerify(args);
      break;
    case 'config':
      await commandConfig(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n✗ Error:', error.message);
  process.exit(1);
});
