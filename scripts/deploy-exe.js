#!/usr/bin/env node
/**
 * exe.dev Deployment Automation
 *
 * Deploys static Vibes apps to exe.dev VMs using nginx.
 *
 * Usage:
 *   node scripts/deploy-exe.js --name <vmname> [options]
 *
 * Options:
 *   --name <vmname>    VM name (required)
 *   --domain <domain>  Custom domain for wildcard SSL setup
 *   --file <path>      HTML file to deploy (default: index.html)
 *   --ai-key <key>     OpenRouter API key for AI features
 *   --multi-tenant     Enable multi-tenant mode (for sell apps)
 *   --tenant-limit <$> Credit limit per tenant in dollars (default: 5)
 *   --registry-url <url> Cloudflare Worker registry URL to inject into HTML
 *   --dry-run          Show what would be done without executing
 *   --skip-verify      Skip verification step
 *   --help             Show this help message
 *
 * Examples:
 *   # Deploy to new VM
 *   node scripts/deploy-exe.js --name myapp
 *
 *   # Deploy with custom domain setup
 *   node scripts/deploy-exe.js --name myapp --domain myapp.com
 *
 * Note: For Fireproof Connect (sync backend), use deploy-connect.js instead.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ensureDeps } from './lib/ensure-deps.js';
import { prompt, confirm } from './lib/prompt.js';
import { parseArgs as parseCliArgs, formatHelp, handleHelpAndErrors } from './lib/cli-utils.js';

const __filename = fileURLToPath(import.meta.url);

await ensureDeps(__filename);

import {
  connect,
  runCommand,
  runExeCommand,
  uploadFile,
  uploadFileWithSudo,
  setPublic,
} from './lib/exe-ssh.js';

import {
  preFlightSSH,
  createAndSetupVM,
  ensureBun,
  uploadFilesWithSudo,
  verifyDeployment as verifyURL,
  validateName,
} from './lib/deploy-utils.js';

import { generateHandoff, extractContextFromEnv } from './generate-handoff.js';

const __dirname = dirname(__filename);
const CONFIG_PATH = join(homedir(), '.vibes-deploy-exe.json');

// ============== Argument Parsing ==============

const deployExeSchema = [
  { name: 'name', flag: '--name', type: 'string', required: true, description: 'VM name (required)' },
  { name: 'domain', flag: '--domain', type: 'string', description: 'Custom domain for wildcard SSL setup' },
  { name: 'file', flag: '--file', type: 'string', default: 'index.html', description: 'HTML file to deploy (default: index.html)' },
  { name: 'dryRun', flag: '--dry-run', type: 'boolean', description: 'Show what would be done without executing' },
  { name: 'skipVerify', flag: '--skip-verify', type: 'boolean', description: 'Skip verification step' },
  { name: 'aiKey', flag: '--ai-key', type: 'string', description: 'OpenRouter API key for AI features' },
  { name: 'multiTenant', flag: '--multi-tenant', type: 'boolean', description: 'Enable per-tenant AI usage tracking' },
  { name: 'tenantLimit', flag: '--tenant-limit', type: 'string', default: '5', description: 'Credit limit per tenant in dollars (default: 5)' },
  { name: 'registryUrl', flag: '--registry-url', type: 'string', description: 'Cloudflare Worker registry URL to inject into HTML' },
];

const deployExeMeta = {
  name: 'exe.dev Deployment Automation',
  description: 'Deploys static Vibes apps to exe.dev VMs using nginx.',
  usage: 'node scripts/deploy-exe.js --name <vmname> [options]',
  sections: [
    { title: 'Options', entries: deployExeSchema.slice(0, 5) },
    { title: 'AI Proxy Options', entries: deployExeSchema.slice(5, 8) },
    { title: 'Registry Options', entries: deployExeSchema.slice(8) },
    { title: 'Help', entries: [{ flag: '--help', alias: '-h', type: 'boolean', description: 'Show this help message' }] },
  ],
  examples: [
    '# Deploy to new VM',
    'node scripts/deploy-exe.js --name myapp',
    '',
    '# Deploy with custom domain setup',
    'node scripts/deploy-exe.js --name myapp --domain myapp.com',
    '',
    '# Deploy a different HTML file',
    'node scripts/deploy-exe.js --name myapp --file build/index.html',
    '',
    '# Deploy with AI proxy',
    'node scripts/deploy-exe.js --name myapp --ai-key "sk-or-v1-..."',
  ],
  notes: [
    'Prerequisites:',
    '  - SSH key in ~/.ssh/ (id_ed25519, id_rsa, or id_ecdsa)',
    '  - exe.dev account (run \'ssh exe.dev\' to create one)',
    '',
    'Note: For Fireproof Connect (sync backend), use deploy-connect.js instead.',
  ],
};

function parseArgs(argv) {
  const { args, positionals } = parseCliArgs(deployExeSchema, argv.slice(2));

  // Post-process: tenant-limit is a number
  if (args.tenantLimit) {
    args.tenantLimit = parseFloat(args.tenantLimit) || 5;
  }

  // Map _help to help for backward compatibility
  args.help = args._help || false;
  delete args._help;

  return args;
}

function printHelp() {
  console.log('\n' + formatHelp(deployExeMeta, deployExeSchema));
}

// ============== Configuration ==============

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
      return { deployments: {} };
    }
  }
  return { deployments: {} };
}

function saveConfig(config) {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ============== Deployment Phases ==============

async function phase1PreFlight(args) {
  console.log('\nPhase 1: Pre-flight checks...');

  // SSH key + connection test (shared)
  await preFlightSSH({ dryRun: args.dryRun });

  // Check HTML file exists
  if (!existsSync(args.file)) {
    throw new Error(`HTML file not found: ${args.file}`);
  }
  console.log(`  ✓ HTML file found: ${args.file}`);
}

async function phase2CreateVM(args) {
  console.log('\nPhase 2: VM Creation...');
  await createAndSetupVM(args.name, { dryRun: args.dryRun });
}

async function phase3ServerSetup(args) {
  console.log('\nPhase 3: Server Setup...');

  const vmHost = `${args.name}.exe.xyz`;

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would connect to ${vmHost}`);
    console.log('  [DRY RUN] Would run: sudo systemctl enable --now nginx');
    return;
  }

  console.log(`  Connecting to ${vmHost}...`);

  try {
    const client = await connect(vmHost);

    // Enable and start nginx
    console.log('  Starting nginx...');
    const { stdout, stderr, code } = await runCommand(
      client,
      'sudo systemctl enable --now nginx'
    );

    if (code !== 0) {
      console.log(`  Warning: nginx command returned code ${code}`);
      if (stderr) console.log(`  stderr: ${stderr}`);
    }

    // Verify nginx is running
    const status = await runCommand(client, 'systemctl is-active nginx');
    if (status.stdout.trim() === 'active') {
      console.log('  ✓ nginx is running');
    } else {
      console.log('  ⚠ nginx may not be running properly');
    }

    client.end();
  } catch (err) {
    throw new Error(`Server setup failed: ${err.message}`);
  }
}

async function phase4FileUpload(args) {
  console.log('\nPhase 4: File Upload...');

  const vmHost = `${args.name}.exe.xyz`;
  const remotePath = '/var/www/html/index.html';

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would upload ${args.file} to ${vmHost}:${remotePath}`);
    return;
  }

  console.log(`  Uploading ${args.file} to ${vmHost}...`);

  try {
    // Read HTML content and inject registry URL if placeholder exists
    let htmlContent = readFileSync(args.file, 'utf-8');
    if (htmlContent.includes('__VIBES_REGISTRY_URL__')) {
      const registryUrl = args.registryUrl || '';
      htmlContent = htmlContent.split('__VIBES_REGISTRY_URL__').join(registryUrl);
      console.log(`  Injected registry URL: ${registryUrl || '(empty)'}`);
    }

    // Write modified content to a temp file for upload
    const tmpLocalPath = join(__dirname, '..', '.vibes-deploy-tmp.html');
    writeFileSync(tmpLocalPath, htmlContent);

    // First upload to home directory, then move with sudo (in case of permission issues)
    const tmpPath = '/home/exedev/vibes-index.html';

    await uploadFile(tmpLocalPath, vmHost, tmpPath);

    const client = await connect(vmHost);
    await runCommand(client, `sudo mv ${tmpPath} ${remotePath}`);
    await runCommand(client, `sudo chown www-data:www-data ${remotePath}`);
    client.end();

    // Clean up temp file
    try { unlinkSync(tmpLocalPath); } catch {}

    console.log('  ✓ File uploaded successfully');
  } catch (err) {
    throw new Error(`File upload failed: ${err.message}`);
  }
}

// TEMPORARY: Deploy local Fireproof bundle + vibes bridge until upstream package is fixed
// Issue: @necrodome/fireproof-clerk@0.0.3 from esm.sh has client-side CID stringification bug
// Remove this phase when the npm package is updated with the fix
// See: https://github.com/fireproof-storage/fireproof/issues/XXX
async function phase4bBundleUpload(args) {
  const BUNDLE_FILES = [
    'fireproof-clerk-bundle.js',
    'fireproof-vibes-bridge.js',
  ];
  const bundlesDir = join(__dirname, '..', 'bundles');

  // Check that at least the main bundle exists
  if (!existsSync(join(bundlesDir, BUNDLE_FILES[0]))) {
    console.log('\nPhase 4b: Bundle Upload... SKIPPED (bundle not found)');
    console.log('  Warning: Apps will use esm.sh package (may have CID bug)');
    return;
  }

  console.log('\nPhase 4b: Bundle Upload (temporary workaround)...');

  const vmHost = `${args.name}.exe.xyz`;

  if (args.dryRun) {
    for (const file of BUNDLE_FILES) {
      console.log(`  [DRY RUN] Would upload ${file} to ${vmHost}:/var/www/html/${file}`);
    }
    return;
  }

  try {
    for (const file of BUNDLE_FILES) {
      const localPath = join(bundlesDir, file);
      if (!existsSync(localPath)) {
        console.warn(`  Warning: ${file} not found, skipping`);
        continue;
      }
      const tmpPath = `/home/exedev/${file}`;
      await uploadFile(localPath, vmHost, tmpPath);

      const client = await connect(vmHost);
      await runCommand(client, `sudo mv ${tmpPath} /var/www/html/${file}`);
      await runCommand(client, `sudo chown www-data:www-data /var/www/html/${file}`);
      client.end();
    }

    console.log(`  ✓ ${BUNDLE_FILES.length} bundle files uploaded`);
  } catch (err) {
    // Non-fatal - warn but don't fail deployment
    console.warn(`  Warning: Bundle upload failed: ${err.message}`);
    console.warn('  Apps may experience CID stringification issues');
  }
}

// Upload auth card images for AuthScreen component
async function phase4cAuthCardsUpload(args) {
  const CARDS_DIR = join(__dirname, '..', 'assets', 'auth-cards');
  const CARD_FILES = ['card-1.png', 'card-2.png', 'card-3.png', 'card-4.png'];

  // Check if cards directory exists
  if (!existsSync(CARDS_DIR)) {
    console.log('\nPhase 4c: Auth Cards Upload... SKIPPED (assets/auth-cards not found)');
    return;
  }

  console.log('\nPhase 4c: Auth Cards Upload...');

  const vmHost = `${args.name}.exe.xyz`;
  const remoteDir = '/var/www/html/assets/auth-cards';

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would create ${remoteDir} and upload ${CARD_FILES.length} card images`);
    return;
  }

  try {
    const client = await connect(vmHost);

    // Create cards directory on server
    await runCommand(client, `sudo mkdir -p ${remoteDir}`);
    await runCommand(client, `sudo chown www-data:www-data ${remoteDir}`);

    client.end();

    // Upload each card image
    for (const cardFile of CARD_FILES) {
      const localPath = join(CARDS_DIR, cardFile);
      if (!existsSync(localPath)) {
        console.log(`  Warning: ${cardFile} not found, skipping`);
        continue;
      }

      const tmpPath = `/home/exedev/${cardFile}`;
      const remotePath = `${remoteDir}/${cardFile}`;

      await uploadFile(localPath, vmHost, tmpPath);

      const client2 = await connect(vmHost);
      await runCommand(client2, `sudo mv ${tmpPath} ${remotePath}`);
      await runCommand(client2, `sudo chown www-data:www-data ${remotePath}`);
      client2.end();
    }

    console.log(`  ✓ ${CARD_FILES.length} card images uploaded to /assets/auth-cards/`);
  } catch (err) {
    // Non-fatal - auth screens work without cards, just shows buttons
    console.warn(`  Warning: Card upload failed: ${err.message}`);
    console.warn('  AuthScreen will render without card images');
  }
}

// Upload favicon assets for PWA and browser tabs
async function phase4dFaviconUpload(args) {
  const FAVICON_DIR = join(__dirname, '..', 'assets', 'vibes-favicon');
  const FAVICON_FILES = [
    'favicon.svg',
    'favicon-96x96.png',
    'favicon.ico',
    'apple-touch-icon.png',
    'site.webmanifest',
    'web-app-manifest-192x192.png',
    'web-app-manifest-512x512.png'
  ];

  // Check if favicon directory exists
  if (!existsSync(FAVICON_DIR)) {
    console.log('\nPhase 4d: Favicon Upload... SKIPPED (assets/vibes-favicon not found)');
    return;
  }

  console.log('\nPhase 4d: Favicon Upload...');

  const vmHost = `${args.name}.exe.xyz`;
  const remoteDir = '/var/www/html/assets/vibes-favicon';

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would upload ${FAVICON_FILES.length} favicon files to ${remoteDir}`);
    return;
  }

  try {
    // Create directory on server
    const client0 = await connect(vmHost);
    await runCommand(client0, `sudo mkdir -p ${remoteDir} && sudo chown www-data:www-data ${remoteDir}`);
    client0.end();

    // Upload each favicon file
    for (const file of FAVICON_FILES) {
      const localPath = join(FAVICON_DIR, file);
      if (!existsSync(localPath)) {
        console.warn(`  Warning: ${file} not found, skipping`);
        continue;
      }

      const tmpPath = `/home/exedev/${file}`;
      const remotePath = `${remoteDir}/${file}`;

      await uploadFile(localPath, vmHost, tmpPath);

      const client = await connect(vmHost);
      await runCommand(client, `sudo mv ${tmpPath} ${remotePath}`);
      await runCommand(client, `sudo chown www-data:www-data ${remotePath}`);
      client.end();
    }

    console.log(`  ✓ ${FAVICON_FILES.length} favicon files uploaded`);
  } catch (err) {
    // Non-fatal - app works without favicons
    console.warn(`  Warning: Favicon upload failed: ${err.message}`);
  }
}

async function phase5AIProxy(args) {
  // Skip if no AI key provided
  if (!args.aiKey) {
    console.log('\nPhase 5: AI Proxy... SKIPPED (no --ai-key provided)');
    return;
  }

  console.log('\nPhase 5: AI Proxy Setup...');

  const vmHost = `${args.name}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would install Bun and deploy AI proxy');
    console.log(`  [DRY RUN] Multi-tenant: ${args.multiTenant}`);
    console.log(`  [DRY RUN] Tenant limit: $${args.tenantLimit}`);
    return;
  }

  try {
    await ensureBun(vmHost);

    const client = await connect(vmHost);

    // Create vibes directory
    await runCommand(client, 'sudo mkdir -p /opt/vibes /var/lib/vibes');
    await runCommand(client, 'sudo chown $USER:$USER /opt/vibes /var/lib/vibes');

    // Read and upload proxy script
    console.log('  Uploading AI proxy...');
    const proxyPath = join(__dirname, 'deployables', 'ai-proxy.js');
    if (!existsSync(proxyPath)) {
      throw new Error(`AI proxy script not found at ${proxyPath}`);
    }
    await uploadFileWithSudo(proxyPath, vmHost, '/opt/vibes/proxy.js');

    // Set environment variables
    console.log('  Configuring environment...');
    const envVars = [
      `OPENROUTER_API_KEY=${args.aiKey}`,
      `VIBES_MULTI_TENANT=${args.multiTenant}`,
      `VIBES_TENANT_LIMIT=${args.tenantLimit}`
    ];

    for (const envVar of envVars) {
      // Check if already set, if not add it (heredoc avoids shell interpretation of values)
      const varName = envVar.split('=')[0];
      await runCommand(client, `grep -q "^${varName}=" /etc/environment || cat <<'VAREOF' | sudo tee -a /etc/environment\n${envVar}\nVAREOF`);
    }

    // Ensure /opt/vibes/ is owned by exedev (service runs as exedev, not root)
    await runCommand(client, 'sudo chown -R exedev:exedev /opt/vibes');

    // Create systemd service
    console.log('  Creating systemd service...');
    const serviceFile = `[Unit]
Description=Vibes AI Proxy
After=network.target

[Service]
Type=simple
User=exedev
WorkingDirectory=/opt/vibes
ExecStart=/usr/local/bin/bun run /opt/vibes/proxy.js
Restart=always
RestartSec=5
EnvironmentFile=/etc/environment

[Install]
WantedBy=multi-user.target`;

    await runCommand(client, `cat <<'SVCEOF' | sudo tee /etc/systemd/system/vibes-proxy.service\n${serviceFile}\nSVCEOF`);
    await runCommand(client, 'sudo systemctl daemon-reload');
    await runCommand(client, 'sudo systemctl enable vibes-proxy');
    await runCommand(client, 'sudo systemctl restart vibes-proxy');

    // Verify service is running
    const serviceStatus = await runCommand(client, 'systemctl is-active vibes-proxy');
    if (serviceStatus.stdout.trim() !== 'active') {
      console.log('  ⚠ Service may not be running. Check logs with: journalctl -u vibes-proxy');
    } else {
      console.log('  ✓ AI proxy service running');
    }

    // Configure nginx proxy using include file (SSL-safe: doesn't modify main config SSL settings)
    console.log('  Configuring nginx...');
    const nginxConf = `# Vibes AI Proxy - auto-generated by deploy-exe.js
location /api/ai/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}`;

    // Write AI proxy config to separate include file (doesn't touch main config)
    await runCommand(client, `cat <<'NGXEOF' | sudo tee /etc/nginx/vibes-ai-proxy.conf\n${nginxConf}\nNGXEOF`);

    // Add include directive to main config if not already present
    // This is the only modification to main config - a single include line
    const includeCheck = await runCommand(client, 'grep -q "include /etc/nginx/vibes-ai-proxy.conf" /etc/nginx/sites-available/default && echo "EXISTS" || echo "NOT_FOUND"');
    if (includeCheck.stdout.includes('NOT_FOUND')) {
      // Insert include after "server {" line (preserves all existing SSL config)
      await runCommand(client, `sudo sed -i '/^[[:space:]]*server[[:space:]]*{/a\\    include /etc/nginx/vibes-ai-proxy.conf;' /etc/nginx/sites-available/default`);
    }

    // Test and reload nginx
    const nginxTest = await runCommand(client, 'sudo nginx -t 2>&1');
    if (nginxTest.code === 0) {
      await runCommand(client, 'sudo systemctl reload nginx');
      console.log('  ✓ nginx configured for AI proxy (using include file)');
    } else {
      console.log('  ⚠ nginx config test failed. Manual configuration may be needed.');
      console.log(`     Error: ${nginxTest.stderr || nginxTest.stdout}`);
    }

    client.end();
    console.log('  ✓ AI proxy setup complete');

  } catch (err) {
    throw new Error(`AI proxy setup failed: ${err.message}`);
  }
}

async function phase6Handoff(args) {
  console.log('\nPhase 6: Context Handoff...');

  const vmHost = `${args.name}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would generate and upload HANDOFF.md');
    return;
  }

  try {
    // Extract context from environment (set by vibes skill) or use defaults
    const context = extractContextFromEnv();
    context.files = [args.file];
    context.vmName = args.name;

    // Generate handoff document
    const handoffContent = generateHandoff(context);

    // Write to temp file
    const tmpHandoff = '/tmp/vibes-handoff.md';
    writeFileSync(tmpHandoff, handoffContent);

    // Upload to VM
    console.log('  Generating HANDOFF.md...');
    await uploadFile(tmpHandoff, vmHost, '/tmp/HANDOFF.md');

    const client = await connect(vmHost);
    await runCommand(client, 'sudo mv /tmp/HANDOFF.md /var/www/html/HANDOFF.md');
    await runCommand(client, 'sudo chown www-data:www-data /var/www/html/HANDOFF.md');
    client.end();

    console.log('  ✓ HANDOFF.md uploaded for remote Claude context');
  } catch (err) {
    // Non-fatal: handoff is optional
    console.log(`  ⚠ Could not upload HANDOFF.md: ${err.message}`);
  }
}

async function phase7PublicAccess(args) {
  console.log('\nPhase 7: Public Access...');

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would run: share set-public ${args.name}`);
    return;
  }

  console.log(`  Setting public access for ${args.name}...`);
  let result = await setPublic(args.name);

  // Retry once if failed
  if (!result.success) {
    console.log(`  First attempt failed: ${result.message}`);
    console.log('  Retrying in 2 seconds...');
    await new Promise(r => setTimeout(r, 2000));
    result = await setPublic(args.name);
  }

  if (result.success) {
    console.log('  ✓ Public access enabled');
  } else {
    console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║  ⚠️  ACTION REQUIRED: Public access not enabled            ║
  ╠════════════════════════════════════════════════════════════╣
  ║  The VM was created but is not publicly accessible.        ║
  ║  Run this command manually:                                ║
  ║                                                            ║
  ║    ssh exe.dev share set-public ${args.name.padEnd(26)}    ║
  ║                                                            ║
  ║  Error: ${result.message.substring(0, 48).padEnd(48)}      ║
  ╚════════════════════════════════════════════════════════════╝
`);
  }
}

async function phase8CustomDomain(args) {
  if (!args.domain) {
    console.log('\nPhase 8: Custom Domain... SKIPPED (no --domain provided)');
    return;
  }

  console.log('\nPhase 8: Custom Domain Setup...');
  console.log(`
  To set up your custom domain (${args.domain}), follow these steps:

  1. WILDCARD DNS CONFIGURATION
     Add these DNS records at your DNS provider:

     For wildcard subdomains (*.${args.domain}):
       Type: CNAME
       Name: *
       Value: ${args.name}.exe.xyz

     For the apex domain (${args.domain}):
       Type: ALIAS or ANAME
       Name: @
       Value: exe.xyz

       Type: CNAME
       Name: www
       Value: ${args.name}.exe.xyz

  2. WILDCARD SSL CERTIFICATE
     SSH into your VM and run certbot with DNS challenge:

     ssh ${args.name}.exe.xyz
     sudo apt install certbot
     sudo certbot certonly --manual --preferred-challenges dns \\
       -d "${args.domain}" -d "*.${args.domain}"

     Follow the prompts to add TXT records for verification.

  3. CONFIGURE NGINX FOR SSL
     After obtaining the certificate, update nginx:

     sudo nano /etc/nginx/sites-available/default

     Add SSL configuration pointing to your certificates.

  4. VERIFY
     Open https://${args.domain} in your browser.
`);

  const proceed = await confirm('Have you completed the DNS configuration?');
  if (proceed) {
    console.log('  Great! SSL setup should complete within a few minutes after DNS propagation.');
  }
}

async function verifyDeploymentPhase(args) {
  console.log('\nVerifying deployment...');
  const url = `https://${args.name}.exe.xyz`;
  return verifyURL(url, { userAgent: 'vibes-deploy-exe/1.0' });
}

// ============== Main ==============

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.name) {
    console.error('Error: --name is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  validateName(args.name);

  console.log(`
${'━'.repeat(60)}
  exe.dev DEPLOYMENT
${'━'.repeat(60)}
`);

  console.log(`  VM Name: ${args.name}`);
  console.log(`  File: ${args.file}`);
  if (args.domain) console.log(`  Domain: ${args.domain}`);
  if (args.aiKey) {
    console.log(`  AI Proxy: Enabled`);
    console.log(`  Multi-tenant: ${args.multiTenant}`);
    if (args.multiTenant) console.log(`  Tenant Limit: $${args.tenantLimit}/month`);
  }
  if (args.registryUrl) console.log(`  Registry URL: ${args.registryUrl}`);
  if (args.dryRun) console.log(`  Mode: DRY RUN`);

  try {
    // Run deployment phases
    await phase1PreFlight(args);
    await phase2CreateVM(args);
    await phase3ServerSetup(args);
    await phase4FileUpload(args);
    await phase4bBundleUpload(args);
    await phase4cAuthCardsUpload(args);
    await phase4dFaviconUpload(args);
    await phase5AIProxy(args);
    await phase6Handoff(args);
    await phase7PublicAccess(args);
    await phase8CustomDomain(args);

    // Verification
    if (!args.skipVerify && !args.dryRun) {
      console.log('\n  Waiting 5 seconds for deployment to propagate...');
      await new Promise(r => setTimeout(r, 5000));
      await verifyDeploymentPhase(args);
    }

    // Save deployment config
    const config = loadConfig();
    config.deployments[args.name] = {
      file: args.file,
      domain: args.domain,
      aiEnabled: !!args.aiKey,
      multiTenant: args.multiTenant,
      registryUrl: args.registryUrl || null,
      deployedAt: new Date().toISOString()
    };
    saveConfig(config);

    console.log(`
${'━'.repeat(60)}
  DEPLOYMENT COMPLETE
${'━'.repeat(60)}

  Your app is live at:
    https://${args.name}.exe.xyz
${args.aiKey ? `
  AI Proxy:
    Endpoint: https://${args.name}.exe.xyz/api/ai/chat
    Mode: ${args.multiTenant ? `Multi-tenant ($${args.tenantLimit}/month per tenant)` : 'Single-user'}` : ''}
${args.registryUrl ? `
  Registry: ${args.registryUrl}` : ''}

  To continue development on the VM (Claude is pre-installed):
    ssh ${args.name}.exe.xyz -t "cd /var/www/html && claude"
${args.domain ? `
  Custom domain: https://${args.domain} (after DNS setup)` : ''}

  To redeploy after changes:
    node scripts/deploy-exe.js --name ${args.name} --file ${args.file}${args.aiKey ? ` --ai-key <key>${args.multiTenant ? ' --multi-tenant' : ''}` : ''}${args.registryUrl ? ` --registry-url ${args.registryUrl}` : ''}

  For Fireproof Connect (sync backend), use deploy-connect.js instead.
`);

  } catch (err) {
    console.error(`\n✗ Deployment failed: ${err.message}`);
    process.exit(1);
  }
}

main();
