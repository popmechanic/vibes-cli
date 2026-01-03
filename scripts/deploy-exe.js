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
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

import {
  findSSHKey,
  connect,
  runCommand,
  runExeCommand,
  uploadFile,
  createVM,
  setPublic,
  testConnection
} from './lib/exe-ssh.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(homedir(), '.vibes-deploy-exe.json');

// ============== Argument Parsing ==============

function parseArgs(argv) {
  const args = {
    name: null,
    domain: null,
    file: 'index.html',
    dryRun: false,
    skipVerify: false,
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
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--skip-verify') {
      args.skipVerify = true;
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
  --help             Show this help message

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

  // Check HTML file exists
  if (!existsSync(args.file)) {
    throw new Error(`HTML file not found: ${args.file}`);
  }
  console.log(`  ✓ HTML file found: ${args.file}`);

  // Test exe.dev connection
  console.log('  Testing exe.dev connection...');
  if (args.dryRun) {
    console.log('  [DRY RUN] Would test SSH connection to exe.dev');
  } else {
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Cannot connect to exe.dev. Run "ssh exe.dev" manually to set up your account.');
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
}

async function phase3ServerSetup(args) {
  console.log('\nPhase 3: Server Setup...');

  const vmHost = `${args.name}.runvm.dev`;

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

  const vmHost = `${args.name}.runvm.dev`;
  const remotePath = '/var/www/html/index.html';

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would upload ${args.file} to ${vmHost}:${remotePath}`);
    return;
  }

  console.log(`  Uploading ${args.file} to ${vmHost}...`);

  try {
    // First upload to tmp, then move with sudo (in case of permission issues)
    const tmpPath = '/tmp/vibes-index.html';

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

async function phase5PublicAccess(args) {
  console.log('\nPhase 5: Public Access...');

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

async function phase6CustomDomain(args) {
  if (!args.domain) {
    console.log('\nPhase 6: Custom Domain... SKIPPED (no --domain provided)');
    return;
  }

  console.log('\nPhase 6: Custom Domain Setup...');
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

     ssh ${args.name}.runvm.dev
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
  console.log(`  File: ${args.file}`);
  if (args.domain) console.log(`  Domain: ${args.domain}`);
  if (args.dryRun) console.log(`  Mode: DRY RUN`);

  try {
    // Run deployment phases
    await phase1PreFlight(args);
    await phase2CreateVM(args);
    await phase3ServerSetup(args);
    await phase4FileUpload(args);
    await phase5PublicAccess(args);
    await phase6CustomDomain(args);

    // Verification
    if (!args.skipVerify && !args.dryRun) {
      console.log('\n  Waiting 5 seconds for deployment to propagate...');
      await new Promise(r => setTimeout(r, 5000));
      await verifyDeployment(args);
    }

    // Save deployment config
    const config = loadConfig();
    config.deployments[args.name] = {
      file: args.file,
      domain: args.domain,
      deployedAt: new Date().toISOString()
    };
    saveConfig(config);

    console.log(`
${'━'.repeat(60)}
  DEPLOYMENT COMPLETE
${'━'.repeat(60)}

  Your Vibes app is now live at:
    https://${args.name}.exe.xyz

  ${args.domain ? `Custom domain: https://${args.domain} (after DNS setup)` : ''}

  To redeploy after changes:
    node scripts/deploy-exe.js --name ${args.name} --file ${args.file}

  To SSH into your VM:
    ssh ${args.name}.runvm.dev
`);

  } catch (err) {
    console.error(`\n✗ Deployment failed: ${err.message}`);
    process.exit(1);
  }
}

main();
