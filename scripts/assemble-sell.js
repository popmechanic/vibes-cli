#!/usr/bin/env node
/**
 * Sell App Assembler
 *
 * Assembles a SaaS app from the sell template and user's app code.
 * Creates a client-side only app - no backend server needed.
 *
 * Creates:
 *   - index.html - Unified app handling landing, tenant, and admin routes
 *
 * Usage:
 *   node scripts/assemble-sell.js <app.jsx> [output.html] [options]
 *
 * Options:
 *   --clerk-key <key>     Clerk publishable key (optional - uses .env if not provided)
 *   --app-name <name>     App name for database naming (e.g., "wedding-photos")
 *   --app-title <title>   Display title (e.g., "Wedding Photos")
 *   --domain <domain>     Root domain (e.g., "myapp.exe.xyz")
 *   --billing-mode <mode> Billing mode: "off" (free) or "required" (subscription required)
 *   --features <json>     JSON array of feature strings
 *   --tagline <text>      App tagline for landing page headline
 *   --subtitle <text>     Subheadline text below the tagline
 *   --admin-ids <json>    JSON array of Clerk user IDs with admin access
 *   --reserved <csv>      Comma-separated reserved subdomain names
 *
 * Example:
 *   node scripts/assemble-sell.js app.jsx index.html \
 *     --clerk-key pk_test_xxx \
 *     --app-name wedding-photos \
 *     --app-title "Wedding Photos" \
 *     --domain myapp.exe.xyz \
 *     --admin-ids '["user_xxx"]'
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { TEMPLATES } from './lib/paths.js';
import { stripForTemplate, stripImports } from './lib/strip-code.js';
import { createBackup } from './lib/backup.js';
import { prompt } from './lib/prompt.js';
import { loadEnvFile, validateClerkKey, populateConnectConfig } from './lib/env-utils.js';

// Parse command line arguments
function parseArgs(argv) {
  const args = {
    appJsxPath: null,
    outputPath: null,
    options: {}
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      args.options[key] = value;
      i += 2;
    } else if (!args.appJsxPath) {
      args.appJsxPath = arg;
      i++;
    } else if (!args.outputPath) {
      args.outputPath = arg;
      i++;
    } else {
      i++;
    }
  }

  return args;
}

const { appJsxPath, outputPath, options } = parseArgs(process.argv);

// Validate app.jsx path
if (!appJsxPath) {
  console.error('Usage: node scripts/assemble-sell.js <app.jsx> [output.html] [options]');
  console.error('\nProvide the path to your app.jsx file.');
  console.error('Run with no arguments to see full usage.');
  process.exit(1);
}

const resolvedAppPath = resolve(appJsxPath);
if (!existsSync(resolvedAppPath)) {
  console.error(`App file not found: ${resolvedAppPath}`);
  process.exit(1);
}

// Default output path
const resolvedOutputPath = resolve(outputPath || 'index.html');

// Backup existing index.html if it exists
const sellBackupPath = createBackup(resolvedOutputPath);
if (sellBackupPath) {
  console.log(`Backed up existing file to: ${sellBackupPath}`);
}

// Template paths (centralized in lib/paths.js)
const templatePath = TEMPLATES.sellUnified;
const adminComponentPath = TEMPLATES.adminComponent;

// Check templates exist
const templateChecks = [
  { path: templatePath, name: 'unified.html' },
  { path: adminComponentPath, name: 'components/admin-exe.jsx' }
];

for (const t of templateChecks) {
  if (!existsSync(t.path)) {
    console.error(`Template not found: ${t.path}`);
    console.error('Make sure the sell skill templates are installed.');
    process.exit(1);
  }
}

// Read template
let output = readFileSync(templatePath, 'utf8');

// Configuration - prompt for domain if not provided
let domain = options.domain;
if (!domain) {
  console.log('\n⚠ No --domain provided. This is required for SaaS apps.\n');
  domain = await prompt('Enter domain (e.g., myapp.exe.xyz): ');
  if (!domain) {
    console.error('Error: Domain is required. Provide via --domain or enter when prompted.');
    process.exit(1);
  }
}
const appName = options.appName || 'my-app';

// Load env vars from .env BEFORE replacements (so we can use as fallback for Clerk key)
const outputDir = dirname(resolve(outputPath || 'index.html'));
const envVars = loadEnvFile(outputDir);

// Check if .env file exists at all
const envPath = resolve(outputDir, '.env');
if (!existsSync(envPath)) {
  console.error(`
╔════════════════════════════════════════════════════════════════╗
║  ERROR: .env file not found                                    ║
╠════════════════════════════════════════════════════════════════╣
║  The sell skill requires Fireproof Connect to be configured.   ║
║                                                                 ║
║  SOLUTION: Run /vibes:connect first to set up your sync        ║
║  backend, then return to /vibes:sell.                          ║
║                                                                 ║
║  Expected: ${envPath.length > 50 ? '...' + envPath.slice(-47) : envPath.padEnd(50)} ║
╚════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// Validate Connect credentials - fail fast if invalid
const hasValidConnect = validateClerkKey(envVars.VITE_CLERK_PUBLISHABLE_KEY) &&
                        envVars.VITE_API_URL;

if (!hasValidConnect) {
  console.error(`
╔════════════════════════════════════════════════════════════════╗
║  ERROR: Invalid Clerk credentials in .env                      ║
╠════════════════════════════════════════════════════════════════╣
║  The .env file exists but is missing required values.          ║
║                                                                 ║
║  Required in .env:                                              ║
║    VITE_CLERK_PUBLISHABLE_KEY=pk_test_... or pk_live_...       ║
║    VITE_API_URL=https://your-studio.exe.xyz/api                ║
║    VITE_CLOUD_URL=fpcloud://your-studio.exe.xyz?protocol=wss   ║
║                                                                 ║
║  Current values:                                                ║
║    VITE_CLERK_PUBLISHABLE_KEY=${(envVars.VITE_CLERK_PUBLISHABLE_KEY || '(not set)').substring(0, 30).padEnd(30)}    ║
║    VITE_API_URL=${(envVars.VITE_API_URL || '(not set)').substring(0, 40).padEnd(40)}    ║
║                                                                 ║
║  SOLUTION: Run /vibes:connect to configure your sync backend.  ║
╚════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// Configuration replacements
// Use --clerk-key if provided, otherwise fall back to .env value (validated above)
const replacements = {
  '__CLERK_PUBLISHABLE_KEY__': options.clerkKey || envVars.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE',
  '__APP_NAME__': appName,
  '__APP_TITLE__': options.appTitle || appName,
  '__APP_DOMAIN__': domain,
  '__BILLING_MODE__': options.billingMode || 'off',
  '__APP_TAGLINE__': options.tagline || 'SHIP FASTER.<br>LOOK BETTER.',
  '__APP_SUBTITLE__': options.subtitle || 'The first design-native framework for the next generation of SaaS. Zero config, infinite style.'
};

// Handle JSON values - features
if (options.features) {
  try {
    const features = JSON.parse(options.features);
    replacements['__FEATURES__'] = JSON.stringify(features);
  } catch (e) {
    console.warn('Warning: Could not parse --features as JSON, using default');
    replacements['__FEATURES__'] = '["Unlimited usage", "Private workspace", "Custom subdomain"]';
  }
} else {
  replacements['__FEATURES__'] = '["Unlimited usage", "Private workspace", "Custom subdomain"]';
}

// Handle JSON values - admin IDs
if (options.adminIds) {
  try {
    const adminIds = JSON.parse(options.adminIds);
    replacements['__ADMIN_USER_IDS__'] = JSON.stringify(adminIds);
  } catch (e) {
    console.warn('Warning: Could not parse --admin-ids as JSON, using empty array');
    replacements['__ADMIN_USER_IDS__'] = '[]';
  }
} else {
  replacements['__ADMIN_USER_IDS__'] = '[]';
}

// Handle reserved subdomain names (comma-separated)
if (options.reserved) {
  const reserved = options.reserved.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  replacements['__RESERVED_SUBDOMAINS__'] = JSON.stringify(reserved);
} else {
  replacements['__RESERVED_SUBDOMAINS__'] = '[]';
}

// Apply replacements
for (const [placeholder, value] of Object.entries(replacements)) {
  output = output.split(placeholder).join(value);
}

// Populate Connect config placeholders from .env (envVars loaded earlier)
// Must run before placeholder validation so Connect placeholders are replaced
console.log('Connect mode: Clerk auth + cloud sync enabled');
output = populateConnectConfig(output, envVars, true);

// Known safe patterns that aren't config placeholders
// __PURE__ is a tree-shaking comment used by bundlers
// __esModule is used by transpilers for ES module compatibility
// __VIBES_CONFIG__ is a runtime config object populated by the template
// __CLERK_LOAD_ERROR__ is a runtime error variable
// __VIBES_SYNC_STATUS__ is the runtime sync status bridge variable
// __VIBES_APP_CODE__ and __ADMIN_CODE__ are injection placeholders consumed below
const SAFE_PLACEHOLDER_PATTERNS = [
  '__PURE__',
  '__esModule',
  '__VIBES_CONFIG__',
  '__CLERK_LOAD_ERROR__',
  '__VIBES_SYNC_STATUS__',
  '__VIBES_APP_CODE__',
  '__ADMIN_CODE__'
];

// Validate template BEFORE injecting app/admin code
// This prevents user-generated dunder patterns from triggering false positives
function validateSellTemplate(html) {
  const errors = [];

  // Check for unreplaced config placeholders using whitelist approach
  const allMatches = html.match(/__[A-Z_]+__/g) || [];
  const unreplaced = allMatches.filter(m => !SAFE_PLACEHOLDER_PATTERNS.includes(m));
  if (unreplaced.length > 0) {
    errors.push(`Unreplaced placeholders: ${[...new Set(unreplaced)].join(', ')}`);
  }

  return errors;
}

const templateErrors = validateSellTemplate(output);
if (templateErrors.length > 0) {
  console.error('Sell assembly failed (template validation):');
  templateErrors.forEach(e => console.error(`  - ${e}`));
  console.error('\nFix: Check your config options and .env file');
  process.exit(1);
}

// Read and process app code - strip imports, exports, and template-provided constants
const templateConstants = ['CLERK_PUBLISHABLE_KEY', 'APP_NAME', 'APP_DOMAIN', 'BILLING_MODE', 'FEATURES', 'APP_TAGLINE', 'ADMIN_USER_IDS'];
let appCode = stripForTemplate(readFileSync(resolvedAppPath, 'utf8'), templateConstants);

// Check if app uses hardcoded database name
const firepoolMatch = appCode.match(/useFireproof\s*\(\s*["']([^"']+)["']\s*\)/);
if (firepoolMatch) {
  const originalDbName = firepoolMatch[1];
  console.log(`Note: Found hardcoded database name "${originalDbName}".`);
  console.log('      The unified template uses dynamic database naming via useTenant().dbName');
  console.log('      You may need to update your App component to use: const { dbName } = useTenant();');
}

// Insert app code at placeholder
const appPlaceholder = '// __VIBES_APP_CODE__';
if (output.includes(appPlaceholder)) {
  output = output.replace(appPlaceholder, appCode);
} else {
  console.error(`Template missing placeholder: ${appPlaceholder}`);
  process.exit(1);
}

// Read and process admin component - strip imports (template already imports dependencies)
let adminCode = stripImports(readFileSync(adminComponentPath, 'utf8').trim());

// Insert admin code at placeholder (optional - template may have inline admin)
const adminPlaceholder = '__ADMIN_CODE__';
if (output.includes(adminPlaceholder)) {
  output = output.replace(adminPlaceholder, adminCode);
} else {
  console.log('Note: Template has inline admin dashboard, skipping admin component injection');
}

// Validate final output - lightweight check for App component
function validateSellAssembly(html, app) {
  const errors = [];

  if (!app || app.trim().length === 0) {
    errors.push('App code is empty');
  }

  if (!html.includes('export default function') && !html.includes('function App')) {
    errors.push('No App component found');
  }

  return errors;
}

const validationErrors = validateSellAssembly(output, appCode);
if (validationErrors.length > 0) {
  console.error('Sell assembly failed:');
  validationErrors.forEach(e => console.error(`  - ${e}`));
  console.error('\nFix: Check your app.jsx and admin component for errors');
  process.exit(1);
}

// Write main output
writeFileSync(resolvedOutputPath, output);
console.log(`\n✓ Created: ${resolvedOutputPath}`);

// Print deployment guide
console.log(`
══════════════════════════════════════════════════════════════════
  ${appName.toUpperCase()} - DEPLOYMENT GUIDE
══════════════════════════════════════════════════════════════════

This is a client-side only SaaS app. No backend server required.

STEP 1: DEPLOY TO exe.dev
─────────────────────────

  Run /vibes:exe to deploy to exe.dev, or manually:

  node "\${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" --name ${appName} --file index.html

  Your app will be live at: https://${appName}.exe.xyz

STEP 2: SET UP CLERK (REQUIRED BEFORE TESTING)
───────────────────────────────────────────────

  See CLERK-SETUP.md for complete instructions. Critical settings:

  Dashboard → User & Authentication → Email:
    ✅ Sign-up with email: ON
    ⚠️  Require email address: OFF (critical - signup fails otherwise!)
    ✅ Verify at sign-up: ON
    ✅ Email verification code: CHECKED

  Dashboard → User & Authentication → Passkeys:
    ✅ Sign-in with passkey: ON
    ✅ Allow autofill: ON
    ✅ Show passkey button: ON
    ✅ Add passkey to account: ON

  Get your Publishable Key and re-run assembly:

     node assemble-sell.js app.jsx index.html \\
       --clerk-key pk_live_YOUR_KEY \\
       --app-name ${appName} \\
       --domain ${domain}

STEP 3: SET UP DNS (Required for custom domains)
─────────────────────────────────────────────────

  Configure your DNS provider with these records:

  ┌────────┬──────┬─────────────────────────┐
  │ Type   │ Name │ Value                   │
  ├────────┼──────┼─────────────────────────┤
  │ ALIAS  │ @    │ exe.xyz                 │
  │ CNAME  │ *    │ ${appName}.exe.xyz      │
  └────────┴──────┴─────────────────────────┘

  This routes both apex (${domain}) and wildcards
  (*.${domain}) through exe.dev's proxy, which
  handles SSL termination automatically.

  Note: If your DNS provider doesn't support ALIAS,
  use ?subdomain= query parameters instead.

STEP 4: CONFIGURE BILLING (if --billing-mode required)
───────────────────────────────────────────────────────

  1. Go to Clerk Dashboard → Billing → Get Started
  2. Create subscription plans (pro, basic, monthly, yearly, starter, free)
  3. Connect your Stripe account
  4. Re-run assembly with --billing-mode required:

     node assemble-sell.js app.jsx index.html \\
       --billing-mode required \\
       ... other options

  See CLERK-SETUP.md for detailed billing configuration.

WHAT WORKS
──────────
  ✓ Landing page with subdomain claim
  ✓ Clerk authentication (passkeys)
  ✓ Tenant app with database isolation
  ✓ Admin dashboard (config view only)
  ✓ Subscription gating via Clerk Billing

══════════════════════════════════════════════════════════════════
`);
