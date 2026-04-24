#!/usr/bin/env node
/**
 * Factory App Assembler
 *
 * Assembles a factory SaaS app from the factory template and user's app code.
 * Creates a client-side only app - no backend server needed.
 *
 * Creates:
 *   - index.html - Unified app handling landing, tenant, and admin routes
 *
 * Usage:
 *   bun scripts/assemble-factory.js <app.jsx> [output.html] [options]
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
 *   bun scripts/assemble-factory.js app.jsx index.html \
 *     --app-name wedding-photos \
 *     --app-title "Wedding Photos" \
 *     --domain myapp.exe.xyz \
 *     --admin-ids '["admin-user-uuid"]'
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { PLUGIN_ROOT } from './lib/paths.js';
import { stripForTemplate, stripImports } from './lib/strip-code.js';
import { createBackup } from './lib/backup.js';
import { prompt } from './lib/prompt.js';
import { populateConnectConfig } from './lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from './lib/auth-constants.js';
import { APP_PLACEHOLDER, injectCode } from './lib/assembly-utils.js';
import { parseArgs as parseCliArgs, formatHelp } from './lib/cli-utils.js';
import { validateFactoryTemplate, validateFactoryAssembly } from './lib/factory-assembly-validation.js';

// Parse command line arguments
const assembleFactorySchema = [
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

const assembleFactoryMeta = {
  name: 'Factory App Assembler',
  description: 'Assembles a factory SaaS app from the factory template and user\'s app code.',
  usage: 'bun scripts/assemble-factory.js <app.jsx> [output.html] [options]',
  examples: [
    'bun scripts/assemble-factory.js app.jsx index.html \\',
    '  --app-name wedding-photos \\',
    '  --app-title "Wedding Photos" \\',
    '  --domain myapp.exe.xyz \\',
    '  --admin-ids \'["user_xxx"]\'',
  ],
};

function parseFactoryArgs(argv) {
  const { args, positionals } = parseCliArgs(assembleFactorySchema, argv.slice(2));

  if (args._help) {
    console.log('\n' + formatHelp(assembleFactoryMeta, assembleFactorySchema));
    process.exit(0);
  }

  // Build options object for backward compatibility with rest of script
  const options = {};
  for (const entry of assembleFactorySchema) {
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

const { appJsxPath, outputPath, options } = parseFactoryArgs(process.argv);

// Validate app.jsx path
if (!appJsxPath) {
  console.error('Usage: bun scripts/assemble-factory.js <app.jsx> [output.html] [options]');
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
const factoryBackupPath = createBackup(resolvedOutputPath);
if (factoryBackupPath) {
  console.log(`Backed up existing file to: ${factoryBackupPath}`);
}

// Template paths — factory skill owns its own templates under skills/factory/
const templatePath = join(PLUGIN_ROOT, 'skills/factory/templates/unified.html');
const adminComponentPath = join(PLUGIN_ROOT, 'skills/factory/components/admin-exe.jsx');

// Check templates exist
const templateChecks = [
  { path: templatePath, name: 'unified.html' },
  { path: adminComponentPath, name: 'components/admin-exe.jsx' }
];

for (const t of templateChecks) {
  if (!existsSync(t.path)) {
    console.error(`Template not found: ${t.path}`);
    console.error('Make sure the factory skill templates are installed.');
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
    console.log(`App config: from registry (app: ${registryAppName})`);
  }
}
if (!envVars.VITE_API_URL) {
  console.log('Note: No app config URLs — will be set at deploy time');
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
  '__PLAN_QUOTAS__': options.planQuotas || '{}',
  // Factory mode: when billing is required, route AI calls through the factory
  // worker (which emits Stripe meter events) instead of the legacy proxy.
  // Substituted as a literal `true`/`false` (no quotes in the template).
  '__FACTORY_MODE__': (options.billingMode === 'required') ? 'true' : 'false',
  // factoryBase: formerly substituted by deploy-api-factory at deploy time,
  // which left non-factory deploys (share.vibesos.com) with an unresolved
  // literal in __APP_CONFIG__. Inject it at assembly so the value survives
  // either deploy path.
  '__FACTORY_API_URL__': 'https://factory.vibesos.com'
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

// Populate app config placeholders (from registry if available)
// Must run before placeholder validation so app config placeholders are replaced
console.log('App config mode: OIDC auth + cloud sync enabled');
output = populateConnectConfig(output, envVars, true);

// Inject hardcoded OIDC constants (same for every app)
output = output.split('__VITE_OIDC_AUTHORITY__').join(OIDC_AUTHORITY);
output = output.split('__VITE_OIDC_CLIENT_ID__').join(OIDC_CLIENT_ID);
output = output.split('__VITE_DEPLOY_API_URL__').join(DEPLOY_API_URL);
output = output.split('__VITE_AI_PROXY_URL__').join(AI_PROXY_URL);

// Known safe patterns that aren't config placeholders
// __PURE__ is a tree-shaking comment used by bundlers
// __esModule is used by transpilers for ES module compatibility
// __VIBES_CONFIG__ is a runtime config object populated by the template
// __VIBES_OIDC_TOKEN__ is the runtime OIDC access token
// __VIBES_SYNC_STATUS__ is the runtime sync status bridge variable
// __VIBES_SYNC_ERROR__ is the runtime sync error bridge variable
// Placeholder allow-list + validators live in scripts/lib/factory-assembly-validation.js
// so the test suite can assert against the same source of truth.
const templateErrors = validateFactoryTemplate(output);
if (templateErrors.length > 0) {
  console.error('Factory assembly failed (template validation):');
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
  output = injectCode(output, APP_PLACEHOLDER, appCode);
} else {
  console.error(`Template missing placeholder: ${APP_PLACEHOLDER}`);
  process.exit(1);
}

// Read and process admin component - strip imports (template already imports dependencies)
let adminCode = stripImports(readFileSync(adminComponentPath, 'utf8').trim());

// Insert admin code at placeholder (optional - template may have inline admin)
const adminPlaceholder = '__ADMIN_CODE__';
if (output.includes(adminPlaceholder)) {
  output = injectCode(output, adminPlaceholder, adminCode);
} else {
  console.log('Note: Template has inline admin dashboard, skipping admin component injection');
}

const validationErrors = validateFactoryAssembly(output, appCode);
if (validationErrors.length > 0) {
  console.error('Factory assembly failed:');
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
