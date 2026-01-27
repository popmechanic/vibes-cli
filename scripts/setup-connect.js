#!/usr/bin/env node
/**
 * setup-connect.js - Set up Fireproof Connect with Clerk authentication
 *
 * Usage:
 *   node scripts/setup-connect.js \
 *     --clerk-publishable-key "pk_test_..." \
 *     --clerk-secret-key "sk_test_..." \
 *     --clerk-jwt-url "https://your-app.clerk.accounts.dev/.well-known/jwks.json" \
 *     --mode fresh|quick-dev|import \
 *     --import-file /path/to/credentials.txt
 *
 * Modes:
 *   fresh     - Generate all new session tokens and CA keys (default)
 *   quick-dev - Use preset dev tokens from dev-credentials.json
 *   import    - Load session tokens from a colleague's exported file
 *
 * This script:
 * 1. Validates Clerk key formats
 * 2. Generates or loads session tokens and device CA keys
 * 3. Creates docker-compose.yaml in ./fireproof/core/
 * 4. Creates .env in project root
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const { subtle } = webcrypto;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base58btc alphabet (multibase compatible)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes to base58
 */
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
  // Leading zeros become '1'
  let result = '';
  for (const byte of uint8) {
    if (byte === 0) result += '1';
    else break;
  }
  // Convert digits to characters
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

/**
 * Encode a JWK object to base58btc (matching Fireproof's jwk2env format)
 * Format: 'z' + base58btc(utf8(JSON.stringify(jwk)))
 */
function jwkToEnv(jwk) {
  const jsonStr = JSON.stringify(jwk);
  const bytes = new TextEncoder().encode(jsonStr);
  return 'z' + base58Encode(bytes);
}

/**
 * Generate EC P-256 key pair and return as JWK-encoded env strings
 */
async function generateSessionTokens() {
  // Generate EC P-256 key pair for signing
  const keyPair = await subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true, // extractable
    ['sign', 'verify']
  );

  // Export keys as JWK
  const publicJwk = await subtle.exportKey('jwk', keyPair.publicKey);
  const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey);

  // Add algorithm hint for Fireproof
  publicJwk.alg = 'ES256';
  privateJwk.alg = 'ES256';

  // Encode as base58btc
  const publicEnv = jwkToEnv(publicJwk);
  const privateEnv = jwkToEnv(privateJwk);

  return { publicEnv, privateEnv };
}

/**
 * Generate Device CA key pair and certificate
 */
async function generateDeviceCAKeys() {
  // Generate EC P-256 key pair for CA
  const keyPair = await subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true,
    ['sign', 'verify']
  );

  // Export private key as JWK
  const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey);
  privateJwk.alg = 'ES256';
  const privKey = jwkToEnv(privateJwk);

  // Export public key as JWK for the certificate
  const publicJwk = await subtle.exportKey('jwk', keyPair.publicKey);

  // Generate a self-signed certificate JWT
  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  // Generate a key ID from the public key
  const kidBytes = new Uint8Array(32);
  webcrypto.getRandomValues(kidBytes);
  const kid = base58Encode(kidBytes);

  const header = {
    alg: 'ES256',
    typ: 'CERT+JWT',
    kid: kid,
    x5c: []
  };

  const jtiBytes = new Uint8Array(32);
  webcrypto.getRandomValues(jtiBytes);

  const serialBytes = new Uint8Array(32);
  webcrypto.getRandomValues(serialBytes);

  const payload = {
    iss: 'Docker Dev CA',
    sub: 'Docker Dev CA',
    aud: 'certificate-users',
    iat: now,
    nbf: now,
    exp: now + oneYear,
    jti: base58Encode(jtiBytes),
    certificate: {
      version: '3',
      serialNumber: base58Encode(serialBytes),
      subject: {
        commonName: 'Docker Dev CA',
        organization: 'Vibes DIY Development',
        locality: 'Local',
        stateOrProvinceName: 'Development',
        countryName: 'WD'
      },
      issuer: {
        commonName: 'Docker Dev CA',
        organization: 'Vibes DIY Development',
        locality: 'Local',
        stateOrProvinceName: 'Development',
        countryName: 'WD'
      },
      validity: {
        notBefore: new Date(now * 1000).toISOString(),
        notAfter: new Date((now + oneYear) * 1000).toISOString()
      },
      subjectPublicKeyInfo: {
        kty: publicJwk.kty,
        crv: publicJwk.crv,
        x: publicJwk.x,
        y: publicJwk.y
      },
      signatureAlgorithm: 'ES256',
      keyUsage: ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage: ['serverAuth']
    }
  };

  // Create the unsigned JWT parts
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  // Sign the JWT
  const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    dataToSign
  );
  const signatureB64 = Buffer.from(signature).toString('base64url');

  const cert = `${headerB64}.${payloadB64}.${signatureB64}`;

  return { privKey, cert };
}

/**
 * Parse an import file with key=value format
 * Handles common variations: export prefix, quoted values, whitespace around =
 * Returns object with session token and CA credentials
 */
function parseImportFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Import file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const credentials = {};

  // Key name mappings for common variations
  const keyMappings = {
    // Short names (without prefix)
    'SESSION_TOKEN_PUBLIC': 'CLOUD_SESSION_TOKEN_PUBLIC',
    'SESSION_TOKEN_SECRET': 'CLOUD_SESSION_TOKEN_SECRET',
    'CA_PRIV_KEY': 'DEVICE_ID_CA_PRIV_KEY',
    'CA_CERT': 'DEVICE_ID_CA_CERT',
    // Already correct names (pass through)
    'CLOUD_SESSION_TOKEN_PUBLIC': 'CLOUD_SESSION_TOKEN_PUBLIC',
    'CLOUD_SESSION_TOKEN_SECRET': 'CLOUD_SESSION_TOKEN_SECRET',
    'DEVICE_ID_CA_PRIV_KEY': 'DEVICE_ID_CA_PRIV_KEY',
    'DEVICE_ID_CA_CERT': 'DEVICE_ID_CA_CERT'
  };

  for (const line of content.split('\n')) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Strip 'export ' prefix (common in Docker .env files)
    if (trimmed.startsWith('export ')) {
      trimmed = trimmed.slice(7);
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    let key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip quotes from value (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Map key variations to expected names
    const mappedKey = keyMappings[key] || key;
    credentials[mappedKey] = value;
  }

  // Validate required keys
  const required = [
    'CLOUD_SESSION_TOKEN_PUBLIC',
    'CLOUD_SESSION_TOKEN_SECRET',
    'DEVICE_ID_CA_PRIV_KEY',
    'DEVICE_ID_CA_CERT'
  ];

  const missing = required.filter(k => !credentials[k]);
  if (missing.length > 0) {
    throw new Error(`Import file missing required keys: ${missing.join(', ')}\nFound keys: ${Object.keys(credentials).join(', ')}`);
  }

  return {
    sessionTokenPublic: credentials.CLOUD_SESSION_TOKEN_PUBLIC,
    sessionTokenSecret: credentials.CLOUD_SESSION_TOKEN_SECRET,
    devicePrivKey: credentials.DEVICE_ID_CA_PRIV_KEY,
    deviceCert: credentials.DEVICE_ID_CA_CERT
  };
}

/**
 * Load quick-dev credentials from the defaults file
 */
function loadQuickDevCredentials(pluginDir) {
  const defaultsPath = join(pluginDir, 'skills', 'vibes', 'defaults', 'dev-credentials.json');

  if (!existsSync(defaultsPath)) {
    throw new Error(
      `Quick-dev credentials not found at: ${defaultsPath}\n` +
      `Create from example: cp skills/vibes/defaults/dev-credentials.example.json skills/vibes/defaults/dev-credentials.json`
    );
  }

  const content = readFileSync(defaultsPath, 'utf-8');
  const credentials = JSON.parse(content);

  return {
    sessionTokenPublic: credentials.CLOUD_SESSION_TOKEN_PUBLIC,
    sessionTokenSecret: credentials.CLOUD_SESSION_TOKEN_SECRET,
    devicePrivKey: credentials.DEVICE_ID_CA_PRIV_KEY,
    deviceCert: credentials.DEVICE_ID_CA_CERT
  };
}

/**
 * Export credentials to a shareable file format
 */
function exportCredentials(filePath, credentials) {
  const content = `# Fireproof Connect Credentials
# Generated: ${new Date().toISOString()}
# Share this file with team members to use the same sync backend
#
# Usage: node setup-connect.js --mode import --import-file ${filePath}

CLOUD_SESSION_TOKEN_PUBLIC=${credentials.sessionTokenPublic}
CLOUD_SESSION_TOKEN_SECRET=${credentials.sessionTokenSecret}
DEVICE_ID_CA_PRIV_KEY=${credentials.devicePrivKey}
DEVICE_ID_CA_CERT=${credentials.deviceCert}
`;
  writeFileSync(filePath, content);
  console.log(`Credentials exported to: ${filePath}`);
}

/**
 * Validate Clerk key formats
 */
function validateClerkKeys(publishableKey, secretKey, jwtUrl) {
  const errors = [];

  if (!publishableKey) {
    errors.push('Missing --clerk-publishable-key');
  } else if (!publishableKey.startsWith('pk_test_') && !publishableKey.startsWith('pk_live_')) {
    errors.push('Clerk publishable key must start with pk_test_ or pk_live_');
  }

  if (!secretKey) {
    errors.push('Missing --clerk-secret-key');
  } else if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
    errors.push('Clerk secret key must start with sk_test_ or sk_live_');
  }

  if (!jwtUrl) {
    errors.push('Missing --clerk-jwt-url');
  } else {
    try {
      const url = new URL(jwtUrl);
      if (url.protocol !== 'https:') {
        errors.push('Clerk JWT URL must use HTTPS');
      }
    } catch {
      errors.push('Clerk JWT URL must be a valid URL');
    }
  }

  return errors;
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = { mode: 'fresh' }; // default mode
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--clerk-publishable-key' && args[i + 1]) {
      result.clerkPublishableKey = args[++i];
    } else if (args[i] === '--clerk-secret-key' && args[i + 1]) {
      result.clerkSecretKey = args[++i];
    } else if (args[i] === '--clerk-jwt-url' && args[i + 1]) {
      result.clerkJwtUrl = args[++i];
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      result.outputDir = args[++i];
    } else if (args[i] === '--mode' && args[i + 1]) {
      const mode = args[++i];
      if (['fresh', 'quick-dev', 'import'].includes(mode)) {
        result.mode = mode;
      } else {
        console.error(`Invalid mode: ${mode}. Valid modes: fresh, quick-dev, import`);
        process.exit(1);
      }
    } else if (args[i] === '--import-file' && args[i + 1]) {
      result.importFile = args[++i];
    } else if (args[i] === '--export-file' && args[i + 1]) {
      result.exportFile = args[++i];
    } else if (args[i] === '--deploy' && args[i + 1]) {
      const target = args[++i];
      if (['local', 'exe'].includes(target)) {
        result.deployTarget = target;
      } else {
        console.error(`Invalid deploy target: ${target}. Valid targets: local, exe`);
        process.exit(1);
      }
    } else if (args[i] === '--vm-name' && args[i + 1]) {
      result.vmName = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      result.help = true;
    } else if (args[i] === '--skip-clone') {
      result.skipClone = true;
    }
  }
  return result;
}

function printUsage() {
  console.log(`
Usage: node setup-connect.js [options]

Required:
  --clerk-publishable-key <key>  Clerk publishable key (pk_test_... or pk_live_...)
  --clerk-secret-key <key>       Clerk secret key (sk_test_... or sk_live_...)
  --clerk-jwt-url <url>          Clerk JWKS URL (https://your-app.clerk.accounts.dev/.well-known/jwks.json)

Optional:
  --mode <mode>                  Credential mode: fresh (default), quick-dev, or import
  --import-file <path>           File with credentials to import (for --mode import)
  --export-file <path>           Export credentials to file for sharing with team
  --output-dir <path>            Output directory (default: current directory)
  --skip-clone                   Skip cloning Fireproof repo (use if already cloned)
  --deploy <target>              Deploy target: local (default) or exe (exe.dev VM)
  --vm-name <name>               VM name for exe.dev deployment (default: fireproof-connect)
  --help, -h                     Show this help message

Modes:
  fresh      Generate all new session tokens and CA keys (default)
  quick-dev  Use preset dev tokens from dev-credentials.json (for quick local testing)
  import     Load session tokens from a colleague's exported credentials file

Deploy Targets:
  local      Set up Docker for local development (default)
  exe        Deploy to exe.dev VM (no local Docker required)

Example:
  # Fresh setup for local Docker (generates new keys)
  node setup-connect.js \\
    --clerk-publishable-key "pk_test_abc123" \\
    --clerk-secret-key "sk_test_xyz789" \\
    --clerk-jwt-url "https://my-app.clerk.accounts.dev/.well-known/jwks.json"

  # Deploy to exe.dev VM (no local Docker required)
  node setup-connect.js \\
    --clerk-publishable-key "pk_test_abc123" \\
    --clerk-secret-key "sk_test_xyz789" \\
    --clerk-jwt-url "https://my-app.clerk.accounts.dev/.well-known/jwks.json" \\
    --deploy exe --vm-name myconnect

  # Import colleague's credentials
  node setup-connect.js \\
    --clerk-publishable-key "pk_test_abc123" \\
    --clerk-secret-key "sk_test_xyz789" \\
    --clerk-jwt-url "https://my-app.clerk.accounts.dev/.well-known/jwks.json" \\
    --mode import --import-file ./team-credentials.txt
`);
}

/**
 * Clone the Fireproof repository if not already present
 */
async function cloneFireproofRepo(outputDir) {
  const repoDir = join(outputDir, 'fireproof');

  if (existsSync(repoDir)) {
    console.log(`Fireproof repo already exists at: ${repoDir}`);
    return true;
  }

  console.log('Cloning Fireproof repository...');
  const { execSync } = await import('child_process');
  try {
    execSync(
      'git clone --branch selem/docker-for-all https://github.com/fireproof-storage/fireproof.git fireproof',
      { cwd: outputDir, stdio: 'inherit' }
    );
    console.log('Repository cloned successfully.');
    return true;
  } catch (error) {
    console.error('Failed to clone repository:', error.message);
    return false;
  }
}

/**
 * Apply CORS fix to the cloud backend server.ts
 * The upstream repo has incomplete CORS headers that cause browser errors
 */
async function applyCorsFix(repoDir) {
  const serverPath = join(repoDir, 'cloud', 'backend', 'cf-d1', 'server.ts');

  if (!existsSync(serverPath)) {
    console.log('Note: cf-d1/server.ts not found, skipping CORS patch');
    return;
  }

  let content = readFileSync(serverPath, 'utf-8');

  // Check if already patched
  if (content.includes('X-Requested-With')) {
    console.log('CORS headers already patched.');
    return;
  }

  console.log('Applying CORS fix to server.ts...');

  // Apply CORS_HEADERS fix
  const oldCorsHeaders = `const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};`;

  const newCorsHeaders = `const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-FP-*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Max-Age": "86400",
};`;

  content = content.replace(oldCorsHeaders, newCorsHeaders);

  // Apply Durable Object response CORS fix
  const oldDOFetch = 'return getRoomDurableObject(env, "V1").fetch(req);';
  const newDOFetch = `const response = await getRoomDurableObject(env, "V1").fetch(req);

      // Add CORS headers to Durable Object response
      const newHeaders = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });`;

  content = content.replace(oldDOFetch, newDOFetch);

  writeFileSync(serverPath, content);
  console.log('Applied CORS fix to server.ts');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Validate arguments
  const errors = validateClerkKeys(
    args.clerkPublishableKey,
    args.clerkSecretKey,
    args.clerkJwtUrl
  );

  if (errors.length > 0) {
    console.error('Validation errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nRun with --help for usage information.');
    process.exit(1);
  }

  // Validate import mode has required file
  if (args.mode === 'import' && !args.importFile) {
    console.error('Error: --import-file is required when using --mode import');
    process.exit(1);
  }

  const outputDir = args.outputDir || process.cwd();
  const pluginDir = dirname(__dirname);

  // Handle exe.dev deployment
  if (args.deployTarget === 'exe') {
    console.log('Deploying Fireproof Connect to exe.dev...\n');

    const vmName = args.vmName || 'fireproof-connect';
    const deployExePath = join(pluginDir, 'scripts', 'deploy-exe.js');

    // Build the command arguments
    const deployArgs = [
      'node',
      deployExePath,
      '--name', vmName,
      '--connect',
      '--skip-file',
      '--clerk-publishable-key', args.clerkPublishableKey,
      '--clerk-secret-key', args.clerkSecretKey,
      '--clerk-jwt-url', args.clerkJwtUrl
    ];

    console.log(`Running: node deploy-exe.js --name ${vmName} --connect --skip-file ...`);

    const { execSync } = await import('child_process');
    try {
      execSync(deployArgs.slice(1).map(a => a.includes(' ') ? `"${a}"` : a).join(' '), {
        cwd: pluginDir,
        stdio: 'inherit',
        env: { ...process.env }
      });

      // Create/update local .env with remote URLs
      const envPath = join(outputDir, '.env');
      const envContent = `# Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=${args.clerkPublishableKey}

# Fireproof Connect (exe.dev)
VITE_TOKEN_API_URI=https://${vmName}.exe.xyz/api
VITE_CLOUD_BACKEND_URL=fpcloud://${vmName}.exe.xyz/sync?protocol=wss
`;

      if (existsSync(envPath)) {
        const existingEnv = readFileSync(envPath, 'utf-8');
        if (existingEnv.includes('VITE_CLERK_PUBLISHABLE_KEY')) {
          // Update existing values
          let updatedEnv = existingEnv
            .replace(/VITE_CLERK_PUBLISHABLE_KEY=.*/g, `VITE_CLERK_PUBLISHABLE_KEY=${args.clerkPublishableKey}`)
            .replace(/VITE_TOKEN_API_URI=.*/g, `VITE_TOKEN_API_URI=https://${vmName}.exe.xyz/api`)
            .replace(/VITE_CLOUD_BACKEND_URL=.*/g, `VITE_CLOUD_BACKEND_URL=fpcloud://${vmName}.exe.xyz/sync?protocol=wss`);
          writeFileSync(envPath, updatedEnv);
          console.log(`Updated: ${envPath}`);
        } else {
          writeFileSync(envPath, existingEnv + '\n' + envContent);
          console.log(`Appended to: ${envPath}`);
        }
      } else {
        writeFileSync(envPath, envContent);
        console.log(`Created: ${envPath}`);
      }

      console.log('\nexe.dev deployment complete!');
      process.exit(0);
    } catch (error) {
      console.error('Deployment failed:', error.message);
      process.exit(1);
    }
  }

  console.log('Setting up Fireproof Connect...\n');
  console.log(`Mode: ${args.mode}`);

  // Get credentials based on mode
  let sessionTokenPublic, sessionTokenSecret, devicePrivKey, deviceCert;

  if (args.mode === 'import') {
    console.log(`Importing credentials from: ${args.importFile}`);
    const imported = parseImportFile(args.importFile);
    sessionTokenPublic = imported.sessionTokenPublic;
    sessionTokenSecret = imported.sessionTokenSecret;
    devicePrivKey = imported.devicePrivKey;
    deviceCert = imported.deviceCert;
    console.log('Credentials imported successfully.');
  } else if (args.mode === 'quick-dev') {
    console.log('Loading quick-dev preset credentials...');
    const quickDev = loadQuickDevCredentials(pluginDir);
    sessionTokenPublic = quickDev.sessionTokenPublic;
    sessionTokenSecret = quickDev.sessionTokenSecret;
    devicePrivKey = quickDev.devicePrivKey;
    deviceCert = quickDev.deviceCert;
    console.log('Quick-dev credentials loaded.');
  } else {
    // fresh mode (default)
    console.log('Generating fresh security keys...');
    const sessionTokens = await generateSessionTokens();
    const deviceCA = await generateDeviceCAKeys();
    sessionTokenPublic = sessionTokens.publicEnv;
    sessionTokenSecret = sessionTokens.privateEnv;
    devicePrivKey = deviceCA.privKey;
    deviceCert = deviceCA.cert;
    console.log('Fresh credentials generated.');
  }

  // Export credentials if requested
  if (args.exportFile) {
    exportCredentials(args.exportFile, {
      sessionTokenPublic,
      sessionTokenSecret,
      devicePrivKey,
      deviceCert
    });
  }

  // Clone Fireproof repo if not skipped
  if (!args.skipClone) {
    const cloned = await cloneFireproofRepo(outputDir);
    if (!cloned) {
      console.error('Cannot proceed without Fireproof repository.');
      console.error('To skip cloning (if repo already exists elsewhere), use --skip-clone');
      process.exit(1);
    }

    // Apply CORS fix to the cloned repo
    const repoDir = join(outputDir, 'fireproof');
    await applyCorsFix(repoDir);
  }

  // Find plugin directory for templates
  const templateDir = join(pluginDir, 'skills', 'connect', 'templates');

  // Read templates
  const dockerComposeTemplate = readFileSync(
    join(templateDir, 'docker-compose.yaml'),
    'utf-8'
  );
  const envTemplate = readFileSync(
    join(templateDir, 'env.template'),
    'utf-8'
  );

  // Replace placeholders in docker-compose.yaml
  let dockerCompose = dockerComposeTemplate
    .replace(/__CLOUD_SESSION_TOKEN_PUBLIC__/g, sessionTokenPublic)
    .replace(/__CLOUD_SESSION_TOKEN_SECRET__/g, sessionTokenSecret)
    .replace(/__CLERK_SECRET_KEY__/g, args.clerkSecretKey)
    .replace(/__CLERK_PUBLISHABLE_KEY__/g, args.clerkPublishableKey)
    .replace(/__CLERK_PUB_JWT_URL__/g, args.clerkJwtUrl)
    .replace(/__DEVICE_ID_CA_PRIV_KEY__/g, devicePrivKey)
    .replace(/__DEVICE_ID_CA_CERT__/g, deviceCert);

  // Replace placeholders in .env
  let envContent = envTemplate
    .replace(/__CLERK_PUBLISHABLE_KEY__/g, args.clerkPublishableKey);

  // Ensure output directories exist
  const dockerComposeDir = join(outputDir, 'fireproof', 'core');
  if (!existsSync(dockerComposeDir)) {
    console.log(`Creating directory: ${dockerComposeDir}`);
    mkdirSync(dockerComposeDir, { recursive: true });
  }

  // Write docker-compose.yaml
  const dockerComposePath = join(dockerComposeDir, 'docker-compose.yaml');
  writeFileSync(dockerComposePath, dockerCompose);
  console.log(`Created: ${dockerComposePath}`);

  // Write .env file
  const envPath = join(outputDir, '.env');

  // If .env exists, append or update
  if (existsSync(envPath)) {
    const existingEnv = readFileSync(envPath, 'utf-8');

    // Check if our variables are already there
    if (existingEnv.includes('VITE_CLERK_PUBLISHABLE_KEY')) {
      console.log(`Updating existing .env file: ${envPath}`);
      // Replace existing values
      let updatedEnv = existingEnv
        .replace(/VITE_CLERK_PUBLISHABLE_KEY=.*/g, `VITE_CLERK_PUBLISHABLE_KEY=${args.clerkPublishableKey}`)
        .replace(/VITE_TOKEN_API_URI=.*/g, 'VITE_TOKEN_API_URI=http://localhost:7370/api')
        .replace(/VITE_CLOUD_BACKEND_URL=.*/g, 'VITE_CLOUD_BACKEND_URL=fpcloud://localhost:8909?protocol=ws');
      writeFileSync(envPath, updatedEnv);
    } else {
      // Append to existing file
      console.log(`Appending to existing .env file: ${envPath}`);
      writeFileSync(envPath, existingEnv + '\n' + envContent);
    }
  } else {
    writeFileSync(envPath, envContent);
    console.log(`Created: ${envPath}`);
  }

  console.log(`
Setup complete!

Next steps:
Start the Docker services:
  cd fireproof/core && docker compose up --build

Services will be available at:
  - Token API: http://localhost:7370/api
  - Cloud Sync: fpcloud://localhost:8909?protocol=ws

Apps generated with /vibes:vibes will now use authenticated sync.
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
