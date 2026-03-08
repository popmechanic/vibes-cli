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
 *   bun scripts/assemble-sell.js <app.jsx> [output.html] [options]
 *
 * Options:
 *   --app-name <name>     App name for database naming (e.g., "wedding-photos")
 *   --app-title <title>   Display title (e.g., "Wedding Photos")
 *   --domain <domain>     Root domain (e.g., "myapp.exe.xyz")
 *   --billing-mode <mode> Billing mode: "off" (free) or "required" (subscription required)
 *   --features <json>     JSON array of feature strings
 *   --tagline <text>      App tagline for landing page headline
 *   --subtitle <text>     Subheadline text below the tagline
 *   --admin-ids <json>    JSON array of admin user IDs
 *   --reserved <csv>      Comma-separated reserved subdomain names
 *
 * Example:
 *   bun scripts/assemble-sell.js app.jsx index.html \
 *     --app-name wedding-photos \
 *     --app-title "Wedding Photos" \
 *     --domain myapp.exe.xyz \
 *     --admin-ids '["admin-user-uuid"]'
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { TEMPLATES } from './lib/paths.js';
import { stripForTemplate, stripImports } from './lib/strip-code.js';
import { createBackup } from './lib/backup.js';
import { prompt } from './lib/prompt.js';
import { populateConnectConfig } from './lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';
import { APP_PLACEHOLDER } from './lib/assembly-utils.js';
import { parseArgs as parseCliArgs, formatHelp } from './lib/cli-utils.js';

// Parse command line arguments
const assembleSellSchema = [
  { name: 'appName', flag: '--app-name', type: 'string', description: 'App name for database naming (e.g., "wedding-photos")' },
  { name: 'appTitle', flag: '--app-title', type: 'string', description: 'Display title (e.g., "Wedding Photos")' },
  { name: 'domain', flag: '--domain', type: 'string', description: 'Root domain (e.g., "myapp.exe.xyz")' },
  { name: 'billingMode', flag: '--billing-mode', type: 'string', description: 'Billing mode: "off" (free) or "required"' },
  { name: 'features', flag: '--features', type: 'string', description: 'JSON array of feature strings' },
  { name: 'tagline', flag: '--tagline', type: 'string', description: 'App tagline for landing page headline' },
  { name: 'subtitle', flag: '--subtitle', type: 'string', description: 'Subheadline text below the tagline' },
  { name: 'adminIds', flag: '--admin-ids', type: 'string', description: 'JSON array of admin user IDs' },
  { name: 'reserved', flag: '--reserved', type: 'string', description: 'Comma-separated reserved subdomain names' },
  { name: 'registryUrl', flag: '--registry-url', type: 'string', description: 'Cloudflare Worker URL for registry API' },
  { name: 'planQuotas', flag: '--plan-quotas', type: 'string', description: 'JSON map of plan slug to max subdomains (e.g., \'{"starter":1,"growth":3}\')' },
];

const assembleSellMeta = {
  name: 'Sell App Assembler',
  description: 'Assembles a SaaS app from the sell template and user\'s app code.',
  usage: 'bun scripts/assemble-sell.js <app.jsx> [output.html] [options]',
  examples: [
    'bun scripts/assemble-sell.js app.jsx index.html \\',
    '  --app-name wedding-photos \\',
    '  --app-title "Wedding Photos" \\',
    '  --domain myapp.exe.xyz \\',
    '  --admin-ids \'["user_xxx"]\'',
  ],
};

function parseSellArgs(argv) {
  const { args, positionals } = parseCliArgs(assembleSellSchema, argv.slice(2));

  if (args._help) {
    console.log('\n' + formatHelp(assembleSellMeta, assembleSellSchema));
    process.exit(0);
  }

  // Build options object for backward compatibility with rest of script
  const options = {};
  for (const entry of assembleSellSchema) {
    if (args[entry.name] != null) {
      options[entry.name] = args[entry.name];
    }
  }

  return {
    appJsxPath: positionals[0] || null,
    outputPath: positionals[1] || null,
    options,
  };
}

const { appJsxPath, outputPath, options } = parseSellArgs(process.argv);

// Validate app.jsx path
if (!appJsxPath) {
  console.error('Usage: bun scripts/assemble-sell.js <app.jsx> [output.html] [options]');
  console.error('\nProvide the path to your app.jsx file.');
  console.error('Run with --help for full usage.');
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

// Connect URLs from registry (if available) — injected at deploy time
let envVars = {};
const registryAppName = options.appName || null;
if (registryAppName) {
  const { getApp } = await import('./lib/registry.js');
  const app = getApp(registryAppName);
  if (app?.connect) {
    envVars.VITE_API_URL = app.connect.apiUrl;
    envVars.VITE_CLOUD_URL = app.connect.cloudUrl;
    console.log(`Connect config: from registry (app: ${registryAppName})`);
  }
}
if (!envVars.VITE_API_URL) {
  console.log('Note: No Connect URLs — will be set at deploy time');
}

// Configuration replacements
const replacements = {
  '__OIDC_AUTHORITY__': OIDC_AUTHORITY,
  '__OIDC_CLIENT_ID__': OIDC_CLIENT_ID,
  '__APP_NAME__': appName,
  '__APP_TITLE__': options.appTitle || appName,
  '__APP_DOMAIN__': domain,
  '__BILLING_MODE__': options.billingMode || 'off',
  '__APP_TAGLINE__': options.tagline || 'SHIP FASTER.<br>LOOK BETTER.',
  '__APP_SUBTITLE__': options.subtitle || 'The first design-native framework for the next generation of SaaS. Zero config, infinite style.',
  '__REGISTRY_URL__': options.registryUrl || envVars.VITE_REGISTRY_URL || '',
  '__PLAN_QUOTAS__': options.planQuotas || '{}'
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

// Populate Connect config placeholders (from registry if available)
// Must run before placeholder validation so Connect placeholders are replaced
console.log('Connect mode: OIDC auth + cloud sync enabled');
output = populateConnectConfig(output, envVars, true);

// Inject hardcoded OIDC constants (same for every app)
output = output.split('__VITE_OIDC_AUTHORITY__').join(OIDC_AUTHORITY);
output = output.split('__VITE_OIDC_CLIENT_ID__').join(OIDC_CLIENT_ID);

// Known safe patterns that aren't config placeholders
// __PURE__ is a tree-shaking comment used by bundlers
// __esModule is used by transpilers for ES module compatibility
// __VIBES_CONFIG__ is a runtime config object populated by the template
// __VIBES_OIDC_TOKEN__ is the runtime OIDC access token
// __VIBES_SYNC_STATUS__ is the runtime sync status bridge variable
// __VIBES_SYNC_ERROR__ is the runtime sync error bridge variable
// __VIBES_THEMES__ is the runtime theme registration array set by app.jsx
// __VIBES_SHARED_LEDGER__ is the runtime shared ledger ID bridge variable (invite URL → bundle)
// __VIBES_LEDGER_MAP__ is the runtime per-database ledger map for multi-tenant isolation
// __VIBES_APP_CODE__ and __ADMIN_CODE__ are injection placeholders consumed below
// __OIDC_LOAD_ERROR__ is a runtime error variable set by initApp() on OIDC load failure
const SAFE_PLACEHOLDER_PATTERNS = [
  '__PURE__',
  '__esModule',
  '__VIBES_CONFIG__',
  '__VIBES_OIDC_TOKEN__',
  '__OIDC_LOAD_ERROR__',
  '__VIBES_SYNC_STATUS__',
  '__VIBES_SYNC_ERROR__',
  '__VIBES_THEMES__',
  '__VIBES_SHARED_LEDGER__',
  '__VIBES_LEDGER_MAP__',
  '__VIBES_INVITE_ID__',
  '__VIBES_THEME_PRESETS__',
  '__VIBES_APP_CODE__',
  '__ADMIN_CODE__',
  '__VIBES_REGISTRY_URL__'
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
  console.error('\nFix: Check your config options');
  process.exit(1);
}

// Read and process app code - strip imports, exports, and template-provided constants
const templateConstants = ['OIDC_AUTHORITY', 'OIDC_CLIENT_ID', 'APP_NAME', 'APP_DOMAIN', 'BILLING_MODE', 'FEATURES', 'APP_TAGLINE', 'ADMIN_USER_IDS'];
let appCode = stripForTemplate(readFileSync(resolvedAppPath, 'utf8'), templateConstants);

// Check if app uses hardcoded database name
const firepoolMatch = appCode.match(/useFireproof(?:Clerk)?\s*\(\s*["']([^"']+)["']\s*\)/)
if (firepoolMatch) {
  const originalDbName = firepoolMatch[1];
  console.log(`Note: Found hardcoded database name "${originalDbName}".`);
  console.log('      The unified template uses dynamic database naming via useTenant().dbName');
  console.log('      You may need to update your App component to use: const { dbName } = useTenant();');
}

// Insert app code at placeholder
if (output.includes(APP_PLACEHOLDER)) {
  output = output.replace(APP_PLACEHOLDER, appCode);
} else {
  console.error(`Template missing placeholder: ${APP_PLACEHOLDER}`);
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

STEP 1: DEPLOY TO CLOUDFLARE WORKERS
─────────────────────────────────────

  Run /vibes:cloudflare to deploy, or manually:

  bun "\${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \\
    --name ${appName} --file index.html

  Auth is automatic — a browser window opens for Pocket ID login
  on first deploy. Tokens are cached at ~/.vibes/auth.json.

STEP 2: SET UP DNS (Required for custom domains)
─────────────────────────────────────────────────

  The app is immediately available at the Workers URL.
  For a custom domain, configure in Cloudflare dashboard:

  Workers & Pages → your worker → Settings → Domains & Routes

  For wildcard subdomains (*.${domain}), add a wildcard route.

  Note: Until a custom domain with wildcard SSL is configured,
  use ?subdomain= query parameters for tenant routing.

STEP 3: CONFIGURE BILLING (if --billing-mode required)
───────────────────────────────────────────────────────

  Billing integration with Stripe is planned for phase 2.
  For now, use --billing-mode off (the default).

WHAT WORKS
──────────
  ✓ Landing page with subdomain claim
  ✓ Passkey authentication (via Pocket ID)
  ✓ Tenant app with database isolation
  ✓ Admin dashboard (config view only)

══════════════════════════════════════════════════════════════════
`);

// Print billing-specific guidance when billing is enabled
if ((options.billingMode || 'off') === 'required') {
  console.log(`
══════════════════════════════════════════════════════════════════
  BILLING MODE: REQUIRED
══════════════════════════════════════════════════════════════════

  NOTE: Stripe billing integration is planned for phase 2.
  For now, billing is stubbed — all users get access regardless
  of subscription status.

══════════════════════════════════════════════════════════════════
`);
}
