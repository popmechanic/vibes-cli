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
 *   --reserved <list>  Comma-separated reserved subdomain names (e.g., "admin,billing,api")
 *   --preallocated <list> Pre-claimed subdomains (e.g., "acme:user_xxx,corp:user_yyy")
 *   --clerk-key <key>  Clerk PEM public key for JWT verification
 *   --clerk-webhook-secret <secret> Clerk webhook signing secret
 *   --connect          Deploy Fireproof Connect services (Docker-based sync backend)
 *   --clerk-publishable-key <key>  Clerk publishable key for Connect (required with --connect)
 *   --clerk-secret-key <key>       Clerk secret key for Connect (required with --connect)
 *   --clerk-jwt-url <url>          Clerk JWT URL for Connect (required with --connect)
 *   --dry-run          Show what would be done without executing
 *   --skip-verify      Skip verification step
 *   --skip-file        Skip HTML file upload (for connect-only deployment)
 *   --help             Show this help message
 *
 * Examples:
 *   # Deploy to new VM
 *   node scripts/deploy-exe.js --name myapp
 *
 *   # Deploy with custom domain setup
 *   node scripts/deploy-exe.js --name myapp --domain myapp.com
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirnameEarly = dirname(__filename);

// Auto-install dependencies if missing (needed when running from plugin cache)
async function ensureDependencies() {
  try {
    await import('ssh2');
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      console.log('Installing dependencies...');
      try {
        execSync('npm install', { cwd: __dirnameEarly, stdio: 'inherit' });
        console.log('Dependencies installed.\n');
      } catch (installErr) {
        console.error('Failed to install dependencies:', installErr.message);
        console.error('Try running: cd ' + __dirnameEarly + ' && npm install');
        process.exit(1);
      }
    } else {
      throw e;
    }
  }
}

await ensureDependencies();

import {
  findSSHKey,
  connect,
  runCommand,
  runExeCommand,
  uploadFile,
  uploadFileWithSudo,
  createVM,
  setPublic,
  testConnection
} from './lib/exe-ssh.js';

import { generateHandoff, extractContextFromEnv } from './generate-handoff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(homedir(), '.vibes-deploy-exe.json');

// ============== Argument Parsing ==============

function parseArgs(argv) {
  const args = {
    name: null,
    domain: null,
    file: 'index.html',
    aiKey: null,
    multiTenant: false,
    tenantLimit: 5,
    reserved: [],
    preallocated: {},
    clerkKey: null,
    clerkWebhookSecret: null,
    connect: false,
    clerkPublishableKey: null,
    clerkSecretKey: null,
    clerkJwtUrl: null,
    dryRun: false,
    skipVerify: false,
    skipFile: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name' && argv[i + 1]) {
      args.name = argv[++i];
    } else if (arg === '--domain' && argv[i + 1]) {
      args.domain = argv[++i];
    } else if (arg === '--file' && argv[i + 1]) {
      args.file = argv[++i];
    } else if (arg === '--ai-key' && argv[i + 1]) {
      args.aiKey = argv[++i];
    } else if (arg === '--multi-tenant') {
      args.multiTenant = true;
    } else if (arg === '--tenant-limit' && argv[i + 1]) {
      args.tenantLimit = parseFloat(argv[++i]) || 5;
    } else if (arg === '--reserved' && argv[i + 1]) {
      args.reserved = argv[++i].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    } else if (arg === '--preallocated' && argv[i + 1]) {
      // Format: "subdomain:user_id,subdomain:user_id"
      const pairs = argv[++i].split(',');
      for (const pair of pairs) {
        const [subdomain, userId] = pair.split(':').map(s => s.trim());
        if (subdomain && userId) {
          args.preallocated[subdomain.toLowerCase()] = userId;
        }
      }
    } else if (arg === '--clerk-key' && argv[i + 1]) {
      args.clerkKey = argv[++i];
    } else if (arg === '--clerk-webhook-secret' && argv[i + 1]) {
      args.clerkWebhookSecret = argv[++i];
    } else if (arg === '--connect') {
      args.connect = true;
    } else if (arg === '--clerk-publishable-key' && argv[i + 1]) {
      args.clerkPublishableKey = argv[++i];
    } else if (arg === '--clerk-secret-key' && argv[i + 1]) {
      args.clerkSecretKey = argv[++i];
    } else if (arg === '--clerk-jwt-url' && argv[i + 1]) {
      args.clerkJwtUrl = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--skip-verify') {
      args.skipVerify = true;
    } else if (arg === '--skip-file') {
      args.skipFile = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
exe.dev Deployment Automation
==============================

Deploys static Vibes apps to exe.dev VMs using nginx.

Usage:
  node scripts/deploy-exe.js --name <vmname> [options]

Options:
  --name <vmname>    VM name (required)
  --domain <domain>  Custom domain for wildcard SSL setup
  --file <path>      HTML file to deploy (default: index.html)
  --dry-run          Show what would be done without executing
  --skip-verify      Skip verification step
  --skip-file        Skip HTML file upload (for connect-only deployment)
  --help             Show this help message

Connect Options (Fireproof sync backend):
  --connect                       Deploy Fireproof Connect services
  --clerk-publishable-key <key>   Clerk publishable key (pk_test_... or pk_live_...)
  --clerk-secret-key <key>        Clerk secret key (sk_test_... or sk_live_...)
  --clerk-jwt-url <url>           Clerk JWT URL (https://your-app.clerk.accounts.dev)

Prerequisites:
  - SSH key in ~/.ssh/ (id_ed25519, id_rsa, or id_ecdsa)
  - exe.dev account (run 'ssh exe.dev' to create one)

Examples:
  # Deploy to new VM
  node scripts/deploy-exe.js --name myapp

  # Deploy with custom domain setup
  node scripts/deploy-exe.js --name myapp --domain myapp.com

  # Deploy a different HTML file
  node scripts/deploy-exe.js --name myapp --file build/index.html

  # Deploy Fireproof Connect services (no app deployment)
  node scripts/deploy-exe.js --name myconnect --connect --skip-file \\
    --clerk-publishable-key "pk_test_..." \\
    --clerk-secret-key "sk_test_..." \\
    --clerk-jwt-url "https://your-app.clerk.accounts.dev"

  # Deploy app + Connect services together
  node scripts/deploy-exe.js --name myapp --connect \\
    --clerk-publishable-key "pk_test_..." \\
    --clerk-secret-key "sk_test_..." \\
    --clerk-jwt-url "https://your-app.clerk.accounts.dev"
`);
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

// ============== User Input ==============

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

async function confirm(question) {
  const answer = await prompt(`${question} (y/N): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

// ============== Deployment Phases ==============

async function phase1PreFlight(args) {
  console.log('\nPhase 1: Pre-flight checks...');

  // Check SSH key
  const sshKey = findSSHKey();
  if (!sshKey) {
    throw new Error('No SSH key found in ~/.ssh/. Please create an SSH key first.');
  }
  console.log(`  ✓ SSH key found: ${sshKey}`);

  // Check HTML file exists (unless skipping file upload)
  if (!args.skipFile) {
    if (!existsSync(args.file)) {
      throw new Error(`HTML file not found: ${args.file}`);
    }
    console.log(`  ✓ HTML file found: ${args.file}`);
  } else {
    console.log(`  ⊘ File upload will be skipped`);
  }

  // Test exe.dev connection
  console.log('  Testing exe.dev connection...');
  if (args.dryRun) {
    console.log('  [DRY RUN] Would test SSH connection to exe.dev');
  } else {
    const connected = await testConnection();
    if (!connected) {
      throw new Error(`Cannot connect to exe.dev.

Before deploying, please:
1. Run: ssh exe.dev (to create account if needed, verify email)
2. Then retry this deployment

The deployment will automatically:
- Create the VM if it doesn't exist
- Add the host key to known_hosts`);
    }
    console.log('  ✓ exe.dev connection OK');
  }
}

async function phase2CreateVM(args) {
  console.log('\nPhase 2: VM Creation...');

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would create VM: ${args.name}`);
    return;
  }

  console.log(`  Creating VM: ${args.name}...`);
  const result = await createVM(args.name);

  if (result.success) {
    console.log(`  ✓ ${result.message}`);
  } else {
    throw new Error(`Failed to create VM: ${result.message}`);
  }

  // Add VM host key to known_hosts to avoid interactive prompt
  const vmHost = `${args.name}.exe.xyz`;
  console.log(`  Adding ${vmHost} to known_hosts...`);
  try {
    const { execSync } = require('child_process');
    execSync(`ssh-keyscan -H ${vmHost} >> ~/.ssh/known_hosts 2>/dev/null`, { timeout: 30000 });
    console.log(`  ✓ Host key added`);
  } catch (err) {
    console.log(`  Warning: Could not add host key automatically. You may need to run: ssh ${vmHost}`);
  }
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
  if (args.skipFile) {
    console.log('\nPhase 4: File Upload... SKIPPED (--skip-file)');
    return;
  }

  console.log('\nPhase 4: File Upload...');

  const vmHost = `${args.name}.exe.xyz`;
  const remotePath = '/var/www/html/index.html';

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would upload ${args.file} to ${vmHost}:${remotePath}`);
    return;
  }

  console.log(`  Uploading ${args.file} to ${vmHost}...`);

  try {
    // First upload to home directory, then move with sudo (in case of permission issues)
    const tmpPath = '/home/exedev/vibes-index.html';

    await uploadFile(args.file, vmHost, tmpPath);

    const client = await connect(vmHost);
    await runCommand(client, `sudo mv ${tmpPath} ${remotePath}`);
    await runCommand(client, `sudo chown www-data:www-data ${remotePath}`);
    client.end();

    console.log('  ✓ File uploaded successfully');
  } catch (err) {
    throw new Error(`File upload failed: ${err.message}`);
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
    const client = await connect(vmHost);

    // Install Bun if needed (copy to /usr/local/bin for system-wide access)
    console.log('  Checking/installing Bun...');
    const bunCheck = await runCommand(client, 'which bun || test -f /usr/local/bin/bun && echo "/usr/local/bin/bun" || echo "NOT_FOUND"');
    if (bunCheck.stdout.includes('NOT_FOUND')) {
      console.log('  Installing Bun...');
      await runCommand(client, 'curl -fsSL https://bun.sh/install | bash');
      // Copy to /usr/local/bin so all users (including www-data) can access it
      await runCommand(client, 'sudo cp ~/.bun/bin/bun /usr/local/bin/bun && sudo chmod +x /usr/local/bin/bun');
    }
    console.log('  ✓ Bun installed');

    // Create vibes directory
    await runCommand(client, 'sudo mkdir -p /opt/vibes /var/lib/vibes');
    await runCommand(client, 'sudo chown $USER:$USER /opt/vibes /var/lib/vibes');

    // Read and upload proxy script
    console.log('  Uploading AI proxy...');
    const proxyPath = join(__dirname, 'lib', 'ai-proxy.js');
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
      // Check if already set, if not add it
      const varName = envVar.split('=')[0];
      await runCommand(client, `grep -q "^${varName}=" /etc/environment || echo '${envVar}' | sudo tee -a /etc/environment`);
    }

    // Create systemd service
    console.log('  Creating systemd service...');
    const serviceFile = `[Unit]
Description=Vibes AI Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/vibes
ExecStart=/usr/local/bin/bun run /opt/vibes/proxy.js
Restart=always
RestartSec=5
EnvironmentFile=/etc/environment

[Install]
WantedBy=multi-user.target`;

    await runCommand(client, `echo '${serviceFile}' | sudo tee /etc/systemd/system/vibes-proxy.service`);
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
    await runCommand(client, `echo '${nginxConf}' | sudo tee /etc/nginx/vibes-ai-proxy.conf`);

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

async function phase6Registry(args) {
  // Skip if no clerk credentials provided
  if (!args.clerkKey || !args.clerkWebhookSecret) {
    console.log('\nPhase 6: Registry Server... SKIPPED (no --clerk-key or --clerk-webhook-secret provided)');
    return;
  }

  console.log('\nPhase 6: Registry Server Setup...');

  const vmHost = `${args.name}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would deploy registry server');
    console.log(`  [DRY RUN] Reserved subdomains: ${args.reserved.join(', ') || 'none'}`);
    console.log(`  [DRY RUN] Preallocated: ${Object.keys(args.preallocated).join(', ') || 'none'}`);
    return;
  }

  try {
    const client = await connect(vmHost);

    // Install Bun if needed (copy to /usr/local/bin for system-wide access)
    console.log('  Checking/installing Bun...');
    const bunCheck = await runCommand(client, 'which bun || test -f /usr/local/bin/bun && echo "/usr/local/bin/bun" || echo "NOT_FOUND"');
    if (bunCheck.stdout.includes('NOT_FOUND')) {
      console.log('  Installing Bun...');
      await runCommand(client, 'curl -fsSL https://bun.sh/install | bash');
      // Copy to /usr/local/bin so all users (including www-data) can access it
      await runCommand(client, 'sudo cp ~/.bun/bin/bun /usr/local/bin/bun && sudo chmod +x /usr/local/bin/bun');
    }
    console.log('  ✓ Bun installed');

    // Install registry server dependencies
    console.log('  Installing dependencies...');
    // Ensure /var/www is owned by exedev for Bun to create package.json
    await runCommand(client, 'sudo chown exedev:exedev /var/www');
    await runCommand(client, 'cd /var/www && echo \'{"name":"registry"}\' > package.json && /usr/local/bin/bun add svix jsonwebtoken');
    console.log('  ✓ Dependencies installed');

    // Create initial registry.json
    console.log('  Creating registry.json...');
    const registry = {
      claims: {},
      reserved: args.reserved,
      preallocated: args.preallocated
    };
    const registryJson = JSON.stringify(registry, null, 2);
    await runCommand(client, `echo '${registryJson}' | sudo tee /var/www/html/registry.json`);
    // Registry server runs as exedev, needs write access to registry.json and directory (for .tmp files)
    await runCommand(client, 'sudo chown exedev:exedev /var/www/html');
    await runCommand(client, 'sudo chmod 775 /var/www/html');
    await runCommand(client, 'sudo chown exedev:exedev /var/www/html/registry.json');
    await runCommand(client, 'sudo chmod 664 /var/www/html/registry.json');

    // Upload registry server
    console.log('  Uploading registry server...');
    const registryServerPath = join(__dirname, 'registry-server.ts');
    if (!existsSync(registryServerPath)) {
      throw new Error(`Registry server not found at ${registryServerPath}`);
    }
    await uploadFileWithSudo(registryServerPath, vmHost, '/var/www/registry-server.ts');
    // Fix permissions - service runs as exedev, needs read access
    await runCommand(client, 'sudo chmod 644 /var/www/registry-server.ts && sudo chown exedev:exedev /var/www/registry-server.ts');

    // Create environment file for registry server (port 3002 to avoid conflict with AI proxy on 3001)
    console.log('  Configuring environment...');
    const domain = args.domain || `${args.name}.exe.xyz`;
    // Include both wildcard (for subdomains) and bare domain (for landing page)
    const envContent = `REGISTRY_PATH=/var/www/html/registry.json
CLERK_PEM_PUBLIC_KEY="${args.clerkKey.replace(/\n/g, '\\n')}"
CLERK_WEBHOOK_SECRET=${args.clerkWebhookSecret}
PERMITTED_ORIGINS=https://*.${domain},https://${domain}
PORT=3002`;

    await runCommand(client, `echo '${envContent}' | sudo tee /etc/registry.env`);
    await runCommand(client, 'sudo chmod 600 /etc/registry.env');

    // Create systemd service (runs as exedev to match directory ownership)
    console.log('  Creating systemd service...');
    const serviceFile = `[Unit]
Description=Subdomain Registry Server
After=network.target

[Service]
Type=simple
User=exedev
WorkingDirectory=/var/www
ExecStart=/usr/local/bin/bun run /var/www/registry-server.ts
Restart=always
RestartSec=10
EnvironmentFile=/etc/registry.env

[Install]
WantedBy=multi-user.target`;

    await runCommand(client, `echo '${serviceFile}' | sudo tee /etc/systemd/system/vibes-registry.service`);
    await runCommand(client, 'sudo systemctl daemon-reload');
    await runCommand(client, 'sudo systemctl enable vibes-registry');
    await runCommand(client, 'sudo systemctl restart vibes-registry');

    // Verify service is running
    const serviceStatus = await runCommand(client, 'systemctl is-active vibes-registry');
    if (serviceStatus.stdout.trim() !== 'active') {
      console.log('  ⚠ Service may not be running. Check logs with: journalctl -u vibes-registry');
    } else {
      console.log('  ✓ Registry service running');
    }

    // Configure nginx proxy (port 3002 for registry, 3001 is AI proxy)
    console.log('  Configuring nginx...');
    const nginxConf = `# Vibes Registry - auto-generated by deploy-exe.js
location = /registry.json {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location ~ ^/check/.+ {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location = /claim {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /webhook {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}`;

    await runCommand(client, `echo '${nginxConf}' | sudo tee /etc/nginx/vibes-registry.conf`);

    // Add include directive to main config if not already present
    const includeCheck = await runCommand(client, 'grep -q "include /etc/nginx/vibes-registry.conf" /etc/nginx/sites-available/default && echo "EXISTS" || echo "NOT_FOUND"');
    if (includeCheck.stdout.includes('NOT_FOUND')) {
      await runCommand(client, `sudo sed -i '/^[[:space:]]*server[[:space:]]*{/a\\    include /etc/nginx/vibes-registry.conf;' /etc/nginx/sites-available/default`);
    }

    // Test and reload nginx
    const nginxTest = await runCommand(client, 'sudo nginx -t 2>&1');
    if (nginxTest.code === 0) {
      await runCommand(client, 'sudo systemctl reload nginx');
      console.log('  ✓ nginx configured for registry');
    } else {
      console.log('  ⚠ nginx config test failed. Manual configuration may be needed.');
      console.log(`     Error: ${nginxTest.stderr || nginxTest.stdout}`);
    }

    client.end();
    console.log('  ✓ Registry server setup complete');

  } catch (err) {
    throw new Error(`Registry server setup failed: ${err.message}`);
  }
}

async function phase7Handoff(args) {
  console.log('\nPhase 7: Context Handoff...');

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

async function phase8PublicAccess(args) {
  console.log('\nPhase 8: Public Access...');

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

async function phase9CustomDomain(args) {
  if (!args.domain) {
    console.log('\nPhase 9: Custom Domain... SKIPPED (no --domain provided)');
    return;
  }

  console.log('\nPhase 9: Custom Domain Setup...');
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

async function phase10Connect(args) {
  if (!args.connect) {
    console.log('\nPhase 10: Connect Services... SKIPPED (no --connect)');
    return;
  }

  // Validate required Connect credentials
  if (!args.clerkPublishableKey || !args.clerkSecretKey || !args.clerkJwtUrl) {
    console.error('\n✗ Connect requires --clerk-publishable-key, --clerk-secret-key, and --clerk-jwt-url');
    throw new Error('Missing required Clerk credentials for Connect');
  }

  console.log('\nPhase 10: Connect Services Setup...');

  const vmHost = `${args.name}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would install Docker');
    console.log('  [DRY RUN] Would clone fireproof repo');
    console.log('  [DRY RUN] Would configure docker-compose.yaml');
    console.log('  [DRY RUN] Would start Docker services');
    console.log('  [DRY RUN] Would configure nginx proxy');
    return;
  }

  try {
    const client = await connect(vmHost);

    // 1. Check/install Docker
    console.log('  Checking Docker...');
    const dockerCheck = await runCommand(client, 'which docker || echo "NOT_FOUND"');
    if (dockerCheck.stdout.includes('NOT_FOUND')) {
      console.log('  Installing Docker...');
      // Install Docker using the official convenience script
      await runCommand(client, 'curl -fsSL https://get.docker.com | sudo sh');
      // Add exedev user to docker group
      await runCommand(client, 'sudo usermod -aG docker exedev');
      console.log('  ✓ Docker installed');
      // Note: user needs to log out/in for group to take effect, so use sudo docker for now
    } else {
      console.log('  ✓ Docker already installed');
    }

    // 2. Clone fireproof repo
    console.log('  Setting up fireproof repo...');
    const repoCheck = await runCommand(client, 'test -d /opt/fireproof && echo "EXISTS" || echo "NOT_FOUND"');
    if (repoCheck.stdout.includes('NOT_FOUND')) {
      console.log('  Cloning fireproof repository...');
      await runCommand(client, 'sudo git clone --branch selem/docker-for-all https://github.com/fireproof-storage/fireproof.git /opt/fireproof');
      await runCommand(client, 'sudo chown -R exedev:exedev /opt/fireproof');
      console.log('  ✓ Repository cloned');
    } else {
      console.log('  ✓ Repository already exists');
      // Update to latest
      await runCommand(client, 'cd /opt/fireproof && git pull origin selem/docker-for-all || true');
    }

    // 3. Generate session tokens using setup-connect.js logic
    console.log('  Generating security tokens...');
    const { webcrypto } = await import('crypto');
    const { subtle } = webcrypto;

    // Base58btc alphabet
    const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    function base58Encode(bytes) {
      const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const digits = [0];
      for (const byte of uint8) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
          carry += digits[i] << 8;
          digits[i] = carry % 58;
          carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = Math.floor(carry / 58);
        }
      }
      let result = '';
      for (const byte of uint8) {
        if (byte === 0) result += '1';
        else break;
      }
      for (let i = digits.length - 1; i >= 0; i--) {
        result += BASE58_ALPHABET[digits[i]];
      }
      return result;
    }

    function jwkToEnv(jwk) {
      const jsonStr = JSON.stringify(jwk);
      const bytes = new TextEncoder().encode(jsonStr);
      return 'z' + base58Encode(bytes);
    }

    // Generate session tokens
    const sessionKeyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const sessionPublicJwk = await subtle.exportKey('jwk', sessionKeyPair.publicKey);
    const sessionPrivateJwk = await subtle.exportKey('jwk', sessionKeyPair.privateKey);
    sessionPublicJwk.alg = 'ES256';
    sessionPrivateJwk.alg = 'ES256';
    const sessionTokenPublic = jwkToEnv(sessionPublicJwk);
    const sessionTokenSecret = jwkToEnv(sessionPrivateJwk);

    // Generate Device CA keys
    const caKeyPair = await subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const caPrivateJwk = await subtle.exportKey('jwk', caKeyPair.privateKey);
    caPrivateJwk.alg = 'ES256';
    const devicePrivKey = jwkToEnv(caPrivateJwk);

    const caPublicJwk = await subtle.exportKey('jwk', caKeyPair.publicKey);
    const now = Math.floor(Date.now() / 1000);
    const oneYear = 365 * 24 * 60 * 60;

    const kidBytes = new Uint8Array(32);
    webcrypto.getRandomValues(kidBytes);
    const jtiBytes = new Uint8Array(32);
    webcrypto.getRandomValues(jtiBytes);
    const serialBytes = new Uint8Array(32);
    webcrypto.getRandomValues(serialBytes);

    const header = {
      alg: 'ES256',
      typ: 'CERT+JWT',
      kid: base58Encode(kidBytes),
      x5c: []
    };

    const payload = {
      iss: 'exe.dev Connect CA',
      sub: 'exe.dev Connect CA',
      aud: 'certificate-users',
      iat: now,
      nbf: now,
      exp: now + oneYear,
      jti: base58Encode(jtiBytes),
      certificate: {
        version: '3',
        serialNumber: base58Encode(serialBytes),
        subject: {
          commonName: 'exe.dev Connect CA',
          organization: 'Vibes DIY',
          locality: 'Cloud',
          stateOrProvinceName: 'Production',
          countryName: 'WD'
        },
        issuer: {
          commonName: 'exe.dev Connect CA',
          organization: 'Vibes DIY',
          locality: 'Cloud',
          stateOrProvinceName: 'Production',
          countryName: 'WD'
        },
        validity: {
          notBefore: new Date(now * 1000).toISOString(),
          notAfter: new Date((now + oneYear) * 1000).toISOString()
        },
        subjectPublicKeyInfo: {
          kty: caPublicJwk.kty,
          crv: caPublicJwk.crv,
          x: caPublicJwk.x,
          y: caPublicJwk.y
        },
        signatureAlgorithm: 'ES256',
        keyUsage: ['digitalSignature', 'keyEncipherment'],
        extendedKeyUsage: ['serverAuth']
      }
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = await subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      caKeyPair.privateKey,
      dataToSign
    );
    const signatureB64 = Buffer.from(signature).toString('base64url');
    const deviceCert = `${headerB64}.${payloadB64}.${signatureB64}`;

    console.log('  ✓ Security tokens generated');

    // 4. Create docker-compose.yaml with credentials
    console.log('  Creating docker-compose.yaml...');
    const dockerComposeContent = `# Fireproof Connect - Generated by deploy-exe.js
# Services: Token API (7370), Cloud Sync (8909)

services:
  cloud-backend:
    build:
      context: ..
      dockerfile: docker/Dockerfile.cloud-backend
    container_name: fireproof-cloud-backend
    ports:
      - "127.0.0.1:8909:8909"
    environment:
      ENDPOINT_PORT: "8909"
      NODE_ENV: production
      CLOUD_SESSION_TOKEN_PUBLIC: "${sessionTokenPublic}"
      CLERK_PUB_JWT_URL: "${args.clerkJwtUrl}"
      VERSION: FP-MSG-1.0
      FP_DEBUG: "false"
      MAX_IDLE_TIME: "300"
      BLOB_PROXY_URL: "https://${vmHost}/sync"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8909/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  dashboard:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dashboard
    container_name: fireproof-dashboard
    ports:
      - "127.0.0.1:7370:7370"
    environment:
      PORT: "7370"
      NODE_ENV: production
      ENVIRONMENT: production
      CLOUD_SESSION_TOKEN_PUBLIC: "${sessionTokenPublic}"
      CLOUD_SESSION_TOKEN_SECRET: "${sessionTokenSecret}"
      CLERK_SECRET_KEY: "${args.clerkSecretKey}"
      CLERK_PUBLISHABLE_KEY: "${args.clerkPublishableKey}"
      VITE_CLERK_PUBLISHABLE_KEY: "${args.clerkPublishableKey}"
      CLERK_PUB_JWT_URL: "${args.clerkJwtUrl}"
      DEVICE_ID_CA_PRIV_KEY: "${devicePrivKey}"
      DEVICE_ID_CA_CERT: "${deviceCert}"
      MAX_LEDGERS: "50"
      MAX_TENANTS: "100"
      MAX_ADMIN_USERS: "10"
      MAX_MEMBER_USERS: "50"
      MAX_INVITES: "100"
      MAX_APPID_BINDINGS: "50"
      FP_ENDPOINT: http://cloud-backend:8909
    depends_on:
      cloud-backend:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:7370/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  wrangler_state:

networks:
  default:
    name: fireproof-network
`;

    // Escape the content for shell
    const escapedDockerCompose = dockerComposeContent.replace(/'/g, "'\\''");
    await runCommand(client, `mkdir -p /opt/fireproof/core && echo '${escapedDockerCompose}' > /opt/fireproof/core/docker-compose.yaml`);
    console.log('  ✓ docker-compose.yaml created');

    // 5. Build and start Docker services
    console.log('  Building Docker images (this may take several minutes)...');
    const buildResult = await runCommand(client, 'cd /opt/fireproof/core && sudo docker compose build 2>&1');
    if (buildResult.code !== 0 && buildResult.stderr && !buildResult.stderr.includes('Warning')) {
      console.log(`  ⚠ Build output: ${buildResult.stderr || buildResult.stdout}`);
    }

    console.log('  Starting Docker services...');
    await runCommand(client, 'cd /opt/fireproof/core && sudo docker compose up -d');

    // Verify services are running
    const psResult = await runCommand(client, 'cd /opt/fireproof/core && sudo docker compose ps --format json 2>/dev/null || sudo docker compose ps');
    if (psResult.stdout.includes('fireproof-dashboard') || psResult.stdout.includes('running')) {
      console.log('  ✓ Docker services started');
    } else {
      console.log('  ⚠ Services may still be starting. Check with: ssh ' + vmHost + ' "cd /opt/fireproof/core && sudo docker compose ps"');
    }

    // 6. Configure nginx proxy
    console.log('  Configuring nginx...');
    const nginxConf = `# Fireproof Connect - auto-generated by deploy-exe.js
# Token API: /api -> localhost:7370
# Cloud Sync: /sync -> localhost:8909 (WebSocket)

location /api {
    proxy_pass http://127.0.0.1:7370;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /sync {
    proxy_pass http://127.0.0.1:8909;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}`;

    const escapedNginxConf = nginxConf.replace(/'/g, "'\\''");
    await runCommand(client, `echo '${escapedNginxConf}' | sudo tee /etc/nginx/vibes-connect.conf`);

    // Add include directive to main config if not already present
    const includeCheck = await runCommand(client, 'grep -q "include /etc/nginx/vibes-connect.conf" /etc/nginx/sites-available/default && echo "EXISTS" || echo "NOT_FOUND"');
    if (includeCheck.stdout.includes('NOT_FOUND')) {
      await runCommand(client, `sudo sed -i '/^[[:space:]]*server[[:space:]]*{/a\\    include /etc/nginx/vibes-connect.conf;' /etc/nginx/sites-available/default`);
    }

    // Test and reload nginx
    const nginxTest = await runCommand(client, 'sudo nginx -t 2>&1');
    if (nginxTest.code === 0) {
      await runCommand(client, 'sudo systemctl reload nginx');
      console.log('  ✓ nginx configured');
    } else {
      console.log('  ⚠ nginx config test failed. Manual configuration may be needed.');
      console.log(`     Error: ${nginxTest.stderr || nginxTest.stdout}`);
    }

    client.end();
    console.log('  ✓ Connect services setup complete');

    // Store Connect info for summary
    args._connectInfo = {
      tokenApi: `https://${vmHost}/api`,
      cloudSync: `wss://${vmHost}/sync`,
      sessionTokenPublic,
      clerkPublishableKey: args.clerkPublishableKey
    };

  } catch (err) {
    throw new Error(`Connect services setup failed: ${err.message}`);
  }
}

async function verifyDeployment(args) {
  console.log('\nVerifying deployment...');

  const url = `https://${args.name}.exe.xyz`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'vibes-deploy-exe/1.0' }
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('text/html')) {
      console.log(`  ✓ ${url} is responding (HTTP ${response.status})`);
      return true;
    } else {
      console.log(`  ⚠ ${url} returned unexpected response: ${response.status}`);
      return false;
    }
  } catch (err) {
    console.log(`  ✗ ${url} is not responding: ${err.message}`);
    console.log('  This may be due to DNS propagation. Try again in a few minutes.');
    return false;
  }
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

  console.log(`
${'━'.repeat(60)}
  exe.dev DEPLOYMENT
${'━'.repeat(60)}
`);

  console.log(`  VM Name: ${args.name}`);
  if (!args.skipFile) console.log(`  File: ${args.file}`);
  if (args.skipFile) console.log(`  File Upload: Skipped`);
  if (args.domain) console.log(`  Domain: ${args.domain}`);
  if (args.aiKey) {
    console.log(`  AI Proxy: Enabled`);
    console.log(`  Multi-tenant: ${args.multiTenant}`);
    if (args.multiTenant) console.log(`  Tenant Limit: $${args.tenantLimit}/month`);
  }
  if (args.clerkKey && args.clerkWebhookSecret) {
    console.log(`  Registry: Enabled`);
    if (args.reserved.length > 0) console.log(`  Reserved: ${args.reserved.join(', ')}`);
    if (Object.keys(args.preallocated).length > 0) console.log(`  Preallocated: ${Object.keys(args.preallocated).join(', ')}`);
  }
  if (args.connect) {
    console.log(`  Connect: Enabled`);
    console.log(`  Clerk Publishable Key: ${args.clerkPublishableKey ? args.clerkPublishableKey.substring(0, 15) + '...' : 'NOT SET'}`);
    console.log(`  Clerk JWT URL: ${args.clerkJwtUrl || 'NOT SET'}`);
  }
  if (args.dryRun) console.log(`  Mode: DRY RUN`);

  try {
    // Run deployment phases
    await phase1PreFlight(args);
    await phase2CreateVM(args);
    await phase3ServerSetup(args);
    await phase4FileUpload(args);
    await phase5AIProxy(args);
    await phase6Registry(args);
    await phase7Handoff(args);
    await phase8PublicAccess(args);
    await phase9CustomDomain(args);
    await phase10Connect(args);

    // Verification
    if (!args.skipVerify && !args.dryRun) {
      console.log('\n  Waiting 5 seconds for deployment to propagate...');
      await new Promise(r => setTimeout(r, 5000));
      await verifyDeployment(args);
    }

    // Save deployment config
    const config = loadConfig();
    config.deployments[args.name] = {
      file: args.skipFile ? null : args.file,
      domain: args.domain,
      aiEnabled: !!args.aiKey,
      multiTenant: args.multiTenant,
      registryEnabled: !!(args.clerkKey && args.clerkWebhookSecret),
      connectEnabled: !!args.connect,
      reserved: args.reserved,
      deployedAt: new Date().toISOString()
    };
    saveConfig(config);

    const hasRegistry = args.clerkKey && args.clerkWebhookSecret;
    const hasConnect = args.connect && args._connectInfo;
    console.log(`
${'━'.repeat(60)}
  DEPLOYMENT COMPLETE
${'━'.repeat(60)}
${!args.skipFile ? `
  Your app is live at:
    https://${args.name}.exe.xyz
` : ''}${args.aiKey ? `
  AI Proxy:
    Endpoint: https://${args.name}.exe.xyz/api/ai/chat
    Mode: ${args.multiTenant ? `Multi-tenant ($${args.tenantLimit}/month per tenant)` : 'Single-user'}` : ''}
${hasRegistry ? `
  Subdomain Registry:
    Check: https://${args.name}.exe.xyz/check/{subdomain}
    Claim: POST https://${args.name}.exe.xyz/claim
    Webhook: https://${args.name}.exe.xyz/webhook` : ''}
${hasConnect ? `
  Fireproof Connect Services:
    Token API: ${args._connectInfo.tokenApi}
    Cloud Sync: ${args._connectInfo.cloudSync}

  Update your .env file:
    VITE_CLERK_PUBLISHABLE_KEY=${args._connectInfo.clerkPublishableKey}
    VITE_TOKEN_API_URI=${args._connectInfo.tokenApi}
    VITE_CLOUD_BACKEND_URL=fpcloud://${args.name}.exe.xyz/sync?protocol=wss

  To check Docker status:
    ssh ${args.name}.exe.xyz "cd /opt/fireproof/core && sudo docker compose ps"

  To view logs:
    ssh ${args.name}.exe.xyz "cd /opt/fireproof/core && sudo docker compose logs -f"
` : ''}
  To continue development on the VM (Claude is pre-installed):
    ssh ${args.name}.exe.xyz -t "cd /var/www/html && claude"
${args.domain ? `
  Custom domain: https://${args.domain} (after DNS setup)` : ''}

  To redeploy after changes:
    node scripts/deploy-exe.js --name ${args.name}${!args.skipFile ? ` --file ${args.file}` : ''}${args.aiKey ? ` --ai-key <key>${args.multiTenant ? ' --multi-tenant' : ''}` : ''}${hasRegistry ? ` --clerk-key <key> --clerk-webhook-secret <secret>` : ''}${hasConnect ? ` --connect --clerk-publishable-key "..." --clerk-secret-key "..." --clerk-jwt-url "..."` : ''}
`);

  } catch (err) {
    console.error(`\n✗ Deployment failed: ${err.message}`);
    process.exit(1);
  }
}

main();
