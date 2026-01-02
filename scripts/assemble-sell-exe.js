#!/usr/bin/env node
/**
 * Sell App Assembler for exe.dev (Client-Side Only)
 *
 * Assembles a SaaS app from the exe-specific sell template and user's app code.
 * This version is client-side only - no backend server needed.
 *
 * Creates:
 *   - index.html - Unified app handling landing, tenant, and admin routes
 *
 * Unlike the Cloudflare version, this does NOT create:
 *   - worker.js (no backend)
 *   - wrangler.toml (no Cloudflare)
 *
 * Usage:
 *   node scripts/assemble-sell-exe.js <app.jsx> [output.html] [options]
 *
 * Options:
 *   --clerk-key <key>     Clerk publishable key (required)
 *   --app-name <name>     App name for database naming (e.g., "wedding-photos")
 *   --app-title <title>   Display title (e.g., "Wedding Photos")
 *   --domain <domain>     Root domain (e.g., "myapp.exe.xyz")
 *   --monthly-price <$>   Monthly price (e.g., "$9")
 *   --yearly-price <$>    Yearly price (e.g., "$89")
 *   --features <json>     JSON array of feature strings
 *   --tagline <text>      App tagline for landing page
 *   --admin-ids <json>    JSON array of Clerk user IDs with admin access
 *
 * Example:
 *   node scripts/assemble-sell-exe.js app.jsx index.html \
 *     --clerk-key pk_test_xxx \
 *     --app-name wedding-photos \
 *     --app-title "Wedding Photos" \
 *     --domain myapp.exe.xyz \
 *     --admin-ids '["user_xxx"]'
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { stripForTemplate, stripImports } from './lib/strip-code.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  console.error('Usage: node scripts/assemble-sell-exe.js <app.jsx> [output.html] [options]');
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
if (existsSync(resolvedOutputPath)) {
  const backupPath = resolvedOutputPath.replace(/\.html$/, '.bak.html');
  const existingContent = readFileSync(resolvedOutputPath, 'utf8');
  writeFileSync(backupPath, existingContent);
  console.log(`Backed up existing file to: ${backupPath}`);
}

// Template paths (exe.dev specific)
const templatePath = join(__dirname, '../skills/sell/templates/unified-exe.html');
const adminComponentPath = join(__dirname, '../skills/sell/components/admin-exe.jsx');

// Check templates exist
const templates = [
  { path: templatePath, name: 'unified-exe.html' },
  { path: adminComponentPath, name: 'components/admin-exe.jsx' }
];

for (const t of templates) {
  if (!existsSync(t.path)) {
    console.error(`Template not found: ${t.path}`);
    console.error('Make sure the sell skill templates are installed.');
    process.exit(1);
  }
}

// Read template
let output = readFileSync(templatePath, 'utf8');

// Configuration
const domain = options.domain || 'example.exe.xyz';
const appName = options.appName || 'my-app';

// Configuration replacements
const replacements = {
  '__CLERK_PUBLISHABLE_KEY__': options.clerkKey || 'pk_test_YOUR_KEY_HERE',
  '__APP_NAME__': appName,
  '__APP_TITLE__': options.appTitle || appName,
  '__APP_DOMAIN__': domain,
  '__MONTHLY_PRICE__': options.monthlyPrice || '$9',
  '__YEARLY_PRICE__': options.yearlyPrice || '$89',
  '__APP_TAGLINE__': options.tagline || 'Your own private workspace. Get started in seconds.'
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

// Apply replacements
for (const [placeholder, value] of Object.entries(replacements)) {
  output = output.split(placeholder).join(value);
}

// Read and process app code - strip imports, exports, and template-provided constants
const templateConstants = ['CLERK_PUBLISHABLE_KEY', 'APP_NAME', 'APP_DOMAIN', 'MONTHLY_PRICE', 'YEARLY_PRICE', 'FEATURES', 'APP_TAGLINE', 'ADMIN_USER_IDS'];
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
const appPlaceholder = '__VIBES_APP_CODE__';
if (output.includes(appPlaceholder)) {
  output = output.replace(appPlaceholder, appCode);
} else {
  console.error(`Template missing placeholder: ${appPlaceholder}`);
  process.exit(1);
}

// Read and process admin component - strip imports (template already imports dependencies)
let adminCode = stripImports(readFileSync(adminComponentPath, 'utf8').trim());

// Insert admin code at placeholder
const adminPlaceholder = '__ADMIN_CODE__';
if (output.includes(adminPlaceholder)) {
  output = output.replace(adminPlaceholder, adminCode);
} else {
  console.error(`Template missing placeholder: ${adminPlaceholder}`);
  process.exit(1);
}

// Write main output
writeFileSync(resolvedOutputPath, output);
console.log(`\n✓ Created: ${resolvedOutputPath}`);

// Print deployment guide
console.log(`
══════════════════════════════════════════════════════════════════
  ${appName.toUpperCase()} - exe.dev DEPLOYMENT GUIDE (Client-Side Only)
══════════════════════════════════════════════════════════════════

This is a client-side only SaaS app. No backend server required.

STEP 1: DEPLOY TO exe.dev
─────────────────────────

  # Find the plugin directory
  VIBES_DIR=\`node ~/.claude/plugins/cache/vibes-cli/vibes/*/scripts/find-plugin.js\`

  # Deploy the app
  node "\${VIBES_DIR}scripts/deploy-exe.js" --name ${appName} --file index.html

  Your app will be live at: https://${appName}.exe.xyz

STEP 2: SET UP CLERK
────────────────────

  1. Go to https://dashboard.clerk.com
  2. Create a new application (or use existing)
  3. Enable "Passkey" authentication
  4. Get your Publishable Key
  5. Re-run assembly with your key:

     node assemble-sell-exe.js app.jsx index.html \\
       --clerk-key pk_live_YOUR_KEY \\
       --app-name ${appName} \\
       --domain ${domain}

STEP 3: SET UP WILDCARD DNS (Optional - for subdomains)
───────────────────────────────────────────────────────

  For tenant subdomains (e.g., alice.${domain}), you need:

  1. Custom domain pointing to your exe.dev VM
  2. Wildcard DNS: *.${domain} → VM IP
  3. Wildcard SSL certificate (via certbot DNS-01)

  See exe.dev docs for wildcard SSL setup.

STEP 4: CONFIGURE BILLING (Optional)
────────────────────────────────────

  Set up Clerk Billing for paid subscriptions:
  https://clerk.com/docs/billing

WHAT WORKS
──────────
  ✓ Landing page with subdomain claim
  ✓ Clerk authentication (passkeys)
  ✓ Tenant app with database isolation
  ✓ Admin dashboard (config view only)
  ✓ Subscription gating via Clerk Billing

LIMITATIONS (vs Cloudflare version)
───────────────────────────────────
  • No backend API for tenant list aggregation
  • Admin stats show "N/A" (use Clerk dashboard)
  • No webhook processing (uses Clerk metadata)

══════════════════════════════════════════════════════════════════
`);
