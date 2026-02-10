#!/usr/bin/env node
/**
 * deploy-connect.js - Deploy Fireproof Connect to a dedicated Studio VM
 *
 * This is a thin wrapper that:
 * 1. SSHs to the Studio VM
 * 2. Clones the fireproof repo (selem/docker-for-all branch)
 * 3. Creates .env with credentials
 * 4. Runs ./docker/start.sh to start services
 *
 * No local reimplementation of Docker compose - we delegate to upstream.
 *
 * Usage:
 *   node scripts/deploy-connect.js \
 *     --studio <codename> \
 *     --clerk-publishable-key "pk_test_..." \
 *     --clerk-secret-key "sk_test_..."
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ensureDeps } from './lib/ensure-deps.js';
import { parseArgs as parseCliArgs, formatHelp, handleHelpAndErrors } from './lib/cli-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await ensureDeps(__filename);

import {
  connect,
  runCommand,
  setPublic,
  setPort,
} from './lib/exe-ssh.js';

import {
  preFlightSSH,
  createAndSetupVM,
  verifyDeployment as verifyURL
} from './lib/deploy-utils.js';

import { generateSessionTokens, generateDeviceCAKeys } from './lib/crypto-utils.js';

// ============== Argument Parsing ==============

const deployConnectSchema = [
  { name: 'studio', flag: '--studio', type: 'string', required: true, description: 'Studio VM name (becomes <codename>.exe.xyz)' },
  { name: 'clerkPublishableKey', flag: '--clerk-publishable-key', type: 'string', required: true, description: 'Clerk publishable key (pk_test_... or pk_live_...)' },
  { name: 'clerkSecretKey', flag: '--clerk-secret-key', type: 'string', required: true, description: 'Clerk secret key (sk_test_... or sk_live_...)' },
  { name: 'dryRun', flag: '--dry-run', type: 'boolean', description: 'Show what would be done without executing' },
];

const deployConnectMeta = {
  name: 'Deploy Fireproof Connect to a Studio VM',
  description: 'Deploys the full Fireproof sync stack to a dedicated exe.dev VM.',
  usage: 'node scripts/deploy-connect.js --studio <codename> [options]',
  sections: [
    { title: 'Required', entries: deployConnectSchema.slice(0, 3) },
    { title: 'Optional', entries: [...deployConnectSchema.slice(3), { flag: '--help', alias: '-h', type: 'boolean', description: 'Show this help message' }] },
  ],
  notes: [
    'Prerequisites:',
    '  - SSH key in ~/.ssh/ (id_ed25519, id_rsa, or id_ecdsa)',
    '  - exe.dev account (run \'ssh exe.dev\' to create one)',
    '  - Clerk account with API keys',
    '',
    'What It Does:',
    '  1. Creates/connects to the Studio VM',
    '  2. Clones fireproof repo (selem/docker-for-all branch)',
    '  3. Generates security tokens (session tokens, CA keys)',
    '  4. Creates .env with all credentials',
    '  5. Runs ./docker/start.sh to start services',
    '  6. Writes local .connect file for app configuration',
  ],
  examples: [
    'node scripts/deploy-connect.js \\',
    '  --studio marcus-studio \\',
    '  --clerk-publishable-key "pk_test_abc123..." \\',
    '  --clerk-secret-key "sk_test_xyz789..."',
  ],
};

function parseArgs(argv) {
  const { args } = parseCliArgs(deployConnectSchema, argv.slice(2));

  // Map _help to help for backward compatibility
  args.help = args._help || false;
  delete args._help;
  delete args._errors; // Errors handled in main()

  return args;
}

function printHelp() {
  console.log('\n' + formatHelp(deployConnectMeta, deployConnectSchema));
}

/**
 * Derive JWT URL from Clerk publishable key
 * Format: pk_test_<base64> or pk_live_<base64>
 * The base64 portion decodes to the Clerk domain
 */
function deriveJwtUrl(publishableKey) {
  try {
    // Extract the base64 portion after pk_test_ or pk_live_
    const prefix = publishableKey.startsWith('pk_live_') ? 'pk_live_' : 'pk_test_';
    const base64Part = publishableKey.slice(prefix.length);

    // Decode base64 to get the Clerk domain
    const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');

    // The decoded value is typically the Clerk frontend API domain
    // e.g., "clerk.your-app.com" or "your-app.clerk.accounts.dev"
    const domain = decoded.replace(/\$$/, ''); // Remove trailing $ if present

    return `https://${domain}/.well-known/jwks.json`;
  } catch {
    // Fallback: ask user to provide it
    throw new Error(
      'Could not derive JWT URL from publishable key. ' +
      'Please find your JWKS URL in Clerk Dashboard > API Keys.'
    );
  }
}

/**
 * Write local .connect file with studio configuration
 */
function writeConnectFile(config) {
  const connectPath = join(process.cwd(), '.connect');
  const content = `# Fireproof Connect Studio Configuration
# Generated: ${new Date().toISOString()}

studio: ${config.studio}
api_url: ${config.apiUrl}
cloud_url: ${config.cloudUrl}
clerk_publishable_key: ${config.clerkPublishableKey}
`;
  writeFileSync(connectPath, content);
  console.log(`  Created: ${connectPath}`);
}

// ============== Deployment Phases ==============

async function phase1PreFlight(args) {
  console.log('\nPhase 1: Pre-flight checks...');

  // SSH key + connection test (shared)
  await preFlightSSH({ dryRun: args.dryRun });

  // Validate Clerk keys
  if (!args.clerkPublishableKey.startsWith('pk_test_') && !args.clerkPublishableKey.startsWith('pk_live_')) {
    throw new Error('Clerk publishable key must start with pk_test_ or pk_live_');
  }
  if (!args.clerkSecretKey.startsWith('sk_test_') && !args.clerkSecretKey.startsWith('sk_live_')) {
    throw new Error('Clerk secret key must start with sk_test_ or sk_live_');
  }
  console.log('  ✓ Clerk keys validated');
}

async function phase2CreateVM(args) {
  console.log('\nPhase 2: VM Creation...');
  await createAndSetupVM(args.studio, { dryRun: args.dryRun });
}

async function phase3CloneRepo(args) {
  console.log('\nPhase 3: Clone Fireproof Repository...');

  const vmHost = `${args.studio}.exe.xyz`;

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would clone fireproof repo to /opt/fireproof`);
    return;
  }

  const client = await connect(vmHost);

  // Check if repo already exists
  const repoCheck = await runCommand(client, 'test -d /opt/fireproof && echo "EXISTS" || echo "NOT_FOUND"');

  if (repoCheck.stdout.includes('NOT_FOUND')) {
    console.log('  Cloning fireproof repository...');
    const cloneResult = await runCommand(client,
      'sudo git clone --branch selem/docker-for-all https://github.com/fireproof-storage/fireproof.git /opt/fireproof'
    );
    if (cloneResult.code !== 0) {
      throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
    }
    await runCommand(client, 'sudo chown -R exedev:exedev /opt/fireproof');
    console.log('  ✓ Repository cloned');
  } else {
    console.log('  ✓ Repository already exists');
    // Update to latest
    console.log('  Updating to latest...');
    await runCommand(client, 'cd /opt/fireproof && git pull origin selem/docker-for-all || true');
    console.log('  ✓ Repository updated');
  }

  client.end();
}

async function phase4InstallDocker(args) {
  console.log('\nPhase 4: Docker Installation...');

  const vmHost = `${args.studio}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would install Docker if needed');
    return;
  }

  const client = await connect(vmHost);

  // Check if Docker is installed
  const dockerCheck = await runCommand(client, 'which docker || echo "NOT_FOUND"');

  if (dockerCheck.stdout.includes('NOT_FOUND')) {
    console.log('  Installing Docker...');
    await runCommand(client, 'curl -fsSL https://get.docker.com | sudo sh');
    await runCommand(client, 'sudo usermod -aG docker exedev');
    console.log('  ✓ Docker installed');
  } else {
    console.log('  ✓ Docker already installed');
  }

  client.end();
}

async function phase4bPatchNginx(args) {
  console.log('\nPhase 4b: Patch nginx config (WebSocket, body size, CORS)...');

  const vmHost = `${args.studio}.exe.xyz`;
  const nginxConf = '/opt/fireproof/docker/nginx.conf';

  if (args.dryRun) {
    console.log('  [DRY RUN] Would check nginx.conf and patch if needed:');
    console.log('    - WebSocket upgrade headers on /fp block');
    console.log('    - client_max_body_size (for blob uploads)');
    console.log('    - CORS headers (allow cross-origin requests from Vibes apps)');
    return;
  }

  const client = await connect(vmHost);

  // Read the current config to detect what's already present
  const configResult = await runCommand(client, `cat ${nginxConf}`);
  const config = configResult.stdout || '';

  // 1. WebSocket headers on /fp
  // Detect: look for "Upgrade" inside the /fp location block
  const fpBlock = config.match(/location = \/fp\s*\{[^}]+\}/s);
  const hasWsOnFp = fpBlock && fpBlock[0].includes('Upgrade');

  if (hasWsOnFp) {
    console.log('  ✓ WebSocket headers on /fp already present (upstream)');
  } else {
    const wsSedCmd = `sudo sed -i '/location = \\/fp/,/}/ {
      /proxy_set_header X-Forwarded-Proto/a\\
          proxy_set_header Upgrade \\$http_upgrade;\\
          proxy_set_header Connection \\$connection_upgrade;\\
          proxy_read_timeout 86400s;\\
          proxy_send_timeout 86400s;
    }' ${nginxConf}`;

    const wsResult = await runCommand(client, wsSedCmd);
    if (wsResult.code !== 0) {
      console.log(`  ⚠ WebSocket patch failed: ${wsResult.stderr}`);
    } else {
      console.log('  ✓ WebSocket headers added to /fp block');
    }
  }

  // 2. Body size limit for blob uploads (photos, files)
  // Detect: any client_max_body_size directive
  const hasBodySize = config.includes('client_max_body_size');

  if (hasBodySize) {
    const match = config.match(/client_max_body_size\s+(\S+)/);
    console.log(`  ✓ client_max_body_size already set to ${match ? match[1] : '(present)'} (upstream)`);
  } else {
    const bodySizeCmd = `sudo sed -i '/server {/a\\    client_max_body_size 100m;' ${nginxConf}`;

    const bodySizeResult = await runCommand(client, bodySizeCmd);
    if (bodySizeResult.code !== 0) {
      console.log(`  ⚠ Body size patch failed: ${bodySizeResult.stderr}`);
    } else {
      console.log('  ✓ client_max_body_size set to 100m');
    }
  }

  // 3. CORS headers
  // Detect: any Access-Control-Allow-Origin directive (upstream may do it per-location or in http block)
  const hasCors = config.includes('Access-Control-Allow-Origin');

  if (hasCors) {
    console.log('  ✓ CORS headers already present (upstream)');
  } else {
    // Add to http block so it applies to all locations (/blob, /api, /fp, /ws).
    // Using * for origin because Clerk JWT auth is enforced by the Fireproof backend.
    const corsCmd = `sudo sed -i '/http {/a\\    add_header Access-Control-Allow-Origin * always;\\n    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;\\n    add_header Access-Control-Allow-Headers "DNT, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Content-Type, Range, Authorization" always;\\n    add_header Access-Control-Expose-Headers "Content-Length, Content-Range" always;' ${nginxConf}`;

    const corsResult = await runCommand(client, corsCmd);
    if (corsResult.code !== 0) {
      console.log(`  ⚠ CORS patch failed: ${corsResult.stderr}`);
    } else {
      console.log('  ✓ CORS headers added to http block');
    }
  }

  // 5. Strip upstream CORS headers to prevent duplication
  // Upstream backends (dashboard, cloud-backend) add their own CORS headers.
  // nginx http block also adds them, causing "multiple values" browser errors.
  // proxy_hide_header strips upstream headers so nginx is the single CORS source.
  const hasHideHeader = config.includes('proxy_hide_header Access-Control-Allow-Origin');

  if (hasHideHeader) {
    console.log('  ✓ proxy_hide_header directives already present');
  } else {
    const hideHeaderCmd = `sudo sed -i '/listen 8080;/a\\
    \\\\n    # Strip upstream CORS headers to prevent duplication (nginx http block adds its own)\\
    proxy_hide_header Access-Control-Allow-Origin;\\
    proxy_hide_header Access-Control-Allow-Methods;\\
    proxy_hide_header Access-Control-Allow-Headers;\\
    proxy_hide_header Access-Control-Max-Age;' ${nginxConf}`;

    const hideHeaderResult = await runCommand(client, hideHeaderCmd);
    if (hideHeaderResult.code !== 0) {
      console.log(`  ⚠ proxy_hide_header patch failed: ${hideHeaderResult.stderr}`);
    } else {
      console.log('  ✓ proxy_hide_header directives added to server block');
    }
  }

  // 6. Validate the config (whether we patched or not)
  const validateResult = await runCommand(client, `sudo docker exec fireproof-proxy nginx -t 2>&1 || sudo nginx -t 2>&1`);
  if (validateResult.code !== 0) {
    console.log(`  ⚠ nginx config validation failed: ${validateResult.stdout || validateResult.stderr}`);
    console.log('  Deployment will continue — upstream nginx.conf structure may have changed.');
  } else {
    console.log('  ✓ nginx config validated');
  }

  client.end();
}

async function phase5GenerateCredentials(args) {
  console.log('\nPhase 5: Generate Security Credentials...');

  if (args.dryRun) {
    console.log('  [DRY RUN] Would generate session tokens and CA keys');
    return {
      sessionTokenPublic: '[GENERATED]',
      sessionTokenSecret: '[GENERATED]',
      devicePrivKey: '[GENERATED]',
      deviceCert: '[GENERATED]',
      jwtUrl: '[DERIVED]'
    };
  }

  console.log('  Generating session tokens...');
  const { publicEnv: sessionTokenPublic, privateEnv: sessionTokenSecret } = await generateSessionTokens();

  console.log('  Generating device CA keys...');
  const { privKey: devicePrivKey, cert: deviceCert } = await generateDeviceCAKeys({
    issuer: 'exe.dev Connect CA',
    organization: 'Vibes DIY',
    locality: 'Cloud',
    state: 'Production'
  });

  console.log('  Deriving JWT URL...');
  const jwtUrl = deriveJwtUrl(args.clerkPublishableKey);

  console.log('  ✓ Credentials generated');

  return { sessionTokenPublic, sessionTokenSecret, devicePrivKey, deviceCert, jwtUrl };
}

async function phase6WriteEnv(args, credentials) {
  console.log('\nPhase 6: Write Environment Configuration...');

  const vmHost = `${args.studio}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would write .env to /opt/fireproof/.env');
    console.log(`  [DRY RUN] BLOB_PROXY_URL=https://${vmHost}`);
    return;
  }

  const client = await connect(vmHost);

  // Create .env content
  let envContent = `# Fireproof Connect - Generated by deploy-connect.js
# ${new Date().toISOString()}

# Clerk Authentication
CLERK_PUBLISHABLE_KEY=${args.clerkPublishableKey}
VITE_CLERK_PUBLISHABLE_KEY=${args.clerkPublishableKey}
CLERK_SECRET_KEY=${args.clerkSecretKey}
CLERK_PUB_JWT_URL=${credentials.jwtUrl}

# Session Tokens (for inter-service auth)
CLOUD_SESSION_TOKEN_PUBLIC=${credentials.sessionTokenPublic}
CLOUD_SESSION_TOKEN_SECRET=${credentials.sessionTokenSecret}

# Device CA (for device identity)
DEVICE_ID_CA_PRIV_KEY=${credentials.devicePrivKey}
DEVICE_ID_CA_CERT=${credentials.deviceCert}
`;

  // Blob proxy URL (exe.dev proxies 443 → 8080, so public URL has no port)
  envContent += `
# Blob Proxy (for cross-VM app hosting)
BLOB_PROXY_URL=https://${vmHost}
`;

  // Write .env file
  console.log('  Writing .env...');
  // Use heredoc with single-quoted delimiter to prevent variable expansion
  await runCommand(client, `cat <<'ENVEOF' > /opt/fireproof/.env\n${envContent}\nENVEOF`);
  await runCommand(client, 'chmod 600 /opt/fireproof/.env');

  console.log('  ✓ Environment configured');

  client.end();
}

async function phase7StartServices(args) {
  console.log('\nPhase 7: Start Docker Services...');

  const vmHost = `${args.studio}.exe.xyz`;

  if (args.dryRun) {
    console.log('  [DRY RUN] Would run ./docker/start.sh');
    return;
  }

  const client = await connect(vmHost);

  // Check if start.sh exists
  const startCheck = await runCommand(client, 'test -f /opt/fireproof/docker/start.sh && echo "EXISTS" || echo "NOT_FOUND"');

  if (startCheck.stdout.includes('NOT_FOUND')) {
    throw new Error('docker/start.sh not found. Is the repo cloned correctly?');
  }

  // Make start.sh executable and run it
  console.log('  Starting services (this may take a few minutes on first run)...');
  await runCommand(client, 'chmod +x /opt/fireproof/docker/start.sh');

  // Run start.sh with a longer timeout
  const startResult = await runCommand(client, 'cd /opt/fireproof && sudo ./docker/start.sh 2>&1 | tail -20');

  if (startResult.code !== 0 && startResult.stderr && !startResult.stderr.includes('Warning')) {
    console.log(`  Output: ${startResult.stdout || startResult.stderr}`);
  }

  // Wait a moment for services to initialize
  console.log('  Waiting for services to initialize...');
  await new Promise(r => setTimeout(r, 5000));

  // Verify services are running
  const psResult = await runCommand(client, 'cd /opt/fireproof && sudo docker compose ps 2>/dev/null || sudo docker ps --filter "name=fireproof"');
  if (psResult.stdout.includes('Up') || psResult.stdout.includes('running')) {
    console.log('  ✓ Docker services started');
  } else {
    console.log('  ⚠ Services may still be starting. Check with:');
    console.log(`     ssh ${vmHost} "cd /opt/fireproof && sudo docker compose ps"`);
  }

  client.end();
}

async function phase8SetPublic(args) {
  console.log('\nPhase 8: Enable Public Access...');

  if (args.dryRun) {
    console.log(`  [DRY RUN] Would run: share set-public ${args.studio}`);
    console.log(`  [DRY RUN] Would run: share port ${args.studio} 8080`);
    return;
  }

  // Step 1: Set public access
  console.log(`  Setting public access for ${args.studio}...`);
  let result = await setPublic(args.studio);

  if (!result.success) {
    console.log(`  First attempt failed: ${result.message}`);
    console.log('  Retrying in 2 seconds...');
    await new Promise(r => setTimeout(r, 2000));
    result = await setPublic(args.studio);
  }

  if (!result.success) {
    console.log(`
  ⚠ ACTION REQUIRED: Public access not enabled
  Run these commands manually:
    ssh exe.dev share set-public ${args.studio}
    ssh exe.dev share port ${args.studio} 8080
`);
    return;
  }

  // Step 2: Set port to 8080 (where nginx proxy listens)
  console.log(`  Setting proxy port to 8080...`);
  let portResult = await setPort(args.studio, 8080);

  if (!portResult.success) {
    console.log(`  First attempt failed: ${portResult.message}`);
    console.log('  Retrying in 2 seconds...');
    await new Promise(r => setTimeout(r, 2000));
    portResult = await setPort(args.studio, 8080);
  }

  if (portResult.success) {
    console.log('  ✓ Public access enabled on port 8080');
  } else {
    console.log(`
  ⚠ ACTION REQUIRED: Port not configured
  Run this command manually:
    ssh exe.dev share port ${args.studio} 8080
`);
  }
}

async function phase9WriteConnect(args) {
  console.log('\nPhase 9: Write Local Configuration...');

  if (args.dryRun) {
    console.log('  [DRY RUN] Would write .connect file');
    return;
  }

  writeConnectFile({
    studio: args.studio,
    apiUrl: `https://${args.studio}.exe.xyz/api/`,
    cloudUrl: `fpcloud://${args.studio}.exe.xyz?protocol=wss`,
    clerkPublishableKey: args.clerkPublishableKey
  });

  console.log('  ✓ Configuration saved');
}

async function verifyDeploymentPhase(args) {
  console.log('\nVerifying deployment...');
  const url = `https://${args.studio}.exe.xyz`;
  // 404 is fine for Connect - nginx is responding, just no index.html
  return verifyURL(url, {
    userAgent: 'vibes-deploy-connect/1.0',
    acceptStatus: [200, 404]
  });
}

// ============== Main ==============

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required arguments
  if (!args.studio) {
    console.error('Error: --studio is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  if (!args.clerkPublishableKey) {
    console.error('Error: --clerk-publishable-key is required');
    process.exit(1);
  }

  if (!args.clerkSecretKey) {
    console.error('Error: --clerk-secret-key is required');
    process.exit(1);
  }

  console.log(`
${'━'.repeat(60)}
  FIREPROOF CONNECT STUDIO DEPLOYMENT
${'━'.repeat(60)}
`);

  console.log(`  Studio: ${args.studio}`);
  console.log(`  Clerk Key: ${args.clerkPublishableKey.substring(0, 15)}...`);
  if (args.dryRun) console.log('  Dry Run: Yes');

  try {
    // Run deployment phases
    await phase1PreFlight(args);
    await phase2CreateVM(args);
    await phase3CloneRepo(args);
    await phase4InstallDocker(args);
    await phase4bPatchNginx(args);
    const credentials = await phase5GenerateCredentials(args);
    await phase6WriteEnv(args, credentials);
    await phase7StartServices(args);
    await phase8SetPublic(args);
    await phase9WriteConnect(args);

    // Verification
    if (!args.dryRun) {
      console.log('\n  Waiting 5 seconds for deployment to propagate...');
      await new Promise(r => setTimeout(r, 5000));
      await verifyDeploymentPhase(args);
    }

    const vmHost = `${args.studio}.exe.xyz`;
    console.log(`
${'━'.repeat(60)}
  DEPLOYMENT COMPLETE
${'━'.repeat(60)}

  Your Connect Studio is live!

  Endpoints:
    Token API:  https://${vmHost}/api/
    Cloud Sync: fpcloud://${vmHost}?protocol=wss

  Update your app's .env:
    VITE_CLERK_PUBLISHABLE_KEY=${args.clerkPublishableKey}
    VITE_API_URL=https://${vmHost}/api/
    VITE_CLOUD_URL=fpcloud://${vmHost}?protocol=wss

  Check Docker status:
    ssh ${vmHost} "cd /opt/fireproof && sudo docker compose ps"

  View logs:
    ssh ${vmHost} "cd /opt/fireproof && sudo docker compose logs -f"
`);

  } catch (err) {
    console.error(`\n✗ Deployment failed: ${err.message}`);
    process.exit(1);
  }
}

main();
