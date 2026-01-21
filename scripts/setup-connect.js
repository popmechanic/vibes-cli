#!/usr/bin/env node
/**
 * setup-connect.js - Set up Fireproof Connect with Clerk authentication
 *
 * Usage:
 *   node scripts/setup-connect.js \
 *     --clerk-publishable-key "pk_test_..." \
 *     --clerk-secret-key "sk_test_..." \
 *     --clerk-jwt-url "https://your-app.clerk.accounts.dev"
 *
 * This script:
 * 1. Validates Clerk key formats
 * 2. Generates session tokens and device CA keys
 * 3. Creates docker-compose.yaml in ./fireproof/core/
 * 4. Creates .env in project root
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base58 alphabet (Bitcoin-style)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes to base58
 */
function base58Encode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
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
  for (const byte of bytes) {
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
 * Generate a random base58 string with prefix
 */
function generateBase58Token(byteLength, prefix = 'z') {
  const bytes = randomBytes(byteLength);
  return prefix + base58Encode(bytes);
}

/**
 * Generate EC P-256 key pair components for JWT
 * This creates deterministic-looking but random values for dev environments
 */
function generateDeviceCAKeys() {
  // Generate private key (base58 encoded)
  const privKeyBytes = randomBytes(96);
  const privKey = 'z33' + base58Encode(privKeyBytes);

  // Generate a mock JWT certificate
  // In production, this would be a properly signed JWT
  // For dev, we create a valid JWT structure with random data
  const header = {
    alg: 'ES256',
    typ: 'CERT+JWT',
    kid: base58Encode(randomBytes(32)),
    x5c: []
  };

  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  const payload = {
    iss: 'Docker Dev CA',
    sub: 'Docker Dev CA',
    aud: 'certificate-users',
    iat: now,
    nbf: now,
    exp: now + oneYear,
    jti: base58Encode(randomBytes(32)),
    certificate: {
      version: '3',
      serialNumber: base58Encode(randomBytes(32)),
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
        kty: 'EC',
        crv: 'P-256',
        x: Buffer.from(randomBytes(32)).toString('base64url'),
        y: Buffer.from(randomBytes(32)).toString('base64url')
      },
      signatureAlgorithm: 'ES256',
      keyUsage: ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage: ['serverAuth']
    }
  };

  // Create the JWT (header.payload.signature)
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from(randomBytes(64)).toString('base64url');

  const cert = `${headerB64}.${payloadB64}.${signature}`;

  return { privKey, cert };
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
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--clerk-publishable-key' && args[i + 1]) {
      result.clerkPublishableKey = args[++i];
    } else if (args[i] === '--clerk-secret-key' && args[i + 1]) {
      result.clerkSecretKey = args[++i];
    } else if (args[i] === '--clerk-jwt-url' && args[i + 1]) {
      result.clerkJwtUrl = args[++i];
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      result.outputDir = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      result.help = true;
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
  --clerk-jwt-url <url>          Clerk JWT URL (https://your-app.clerk.accounts.dev)

Optional:
  --output-dir <path>            Output directory (default: current directory)
  --help, -h                     Show this help message

Example:
  node setup-connect.js \\
    --clerk-publishable-key "pk_test_abc123" \\
    --clerk-secret-key "sk_test_xyz789" \\
    --clerk-jwt-url "https://my-app.clerk.accounts.dev"
`);
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

  const outputDir = args.outputDir || process.cwd();

  console.log('Setting up Fireproof Connect...\n');

  // Generate security keys
  console.log('Generating security keys...');
  const sessionTokenPublic = generateBase58Token(96, 'z');
  const sessionTokenSecret = generateBase58Token(120, 'z33');
  const { privKey: devicePrivKey, cert: deviceCert } = generateDeviceCAKeys();

  // Find plugin directory for templates
  const pluginDir = dirname(__dirname);
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
1. Clone the Fireproof repository (if not already done):
   git clone --branch selem/docker-for-all https://github.com/fireproof-storage/fireproof.git ./fireproof

2. Start the Docker services:
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
