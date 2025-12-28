#!/usr/bin/env node
/**
 * Sell App Assembler
 *
 * Assembles a unified SaaS app from the sell template and user's app code.
 * Creates:
 *   - index.html - Unified app handling landing, tenant, and admin routes
 *   - worker.js - Cloudflare Worker for subdomain proxy + API
 *   - wrangler.toml - Worker configuration template
 *
 * Usage:
 *   node scripts/assemble-sell.js <app.jsx> [output.html] [options]
 *
 * Options:
 *   --clerk-key <key>     Clerk publishable key (required)
 *   --app-name <name>     App name for database naming (e.g., "wedding-photos")
 *   --app-title <title>   Display title (e.g., "Wedding Photos")
 *   --domain <domain>     Root domain (e.g., "fantasy.wedding")
 *   --monthly-price <$>   Monthly price (e.g., "$9")
 *   --yearly-price <$>    Yearly price (e.g., "$89")
 *   --features <json>     JSON array of feature strings
 *   --tagline <text>      App tagline for landing page
 *   --admin-ids <json>    JSON array of Clerk user IDs with admin access
 *   --pages-project <name> Cloudflare Pages project name (for worker config)
 *
 * Example:
 *   node scripts/assemble-sell.js app.jsx index.html \
 *     --clerk-key pk_test_xxx \
 *     --app-name wedding-photos \
 *     --app-title "Wedding Photos" \
 *     --domain fantasy.wedding \
 *     --monthly-price "$9" \
 *     --yearly-price "$89" \
 *     --features '["Photo sharing","Guest uploads","Live gallery"]' \
 *     --admin-ids '["user_xxx"]' \
 *     --pages-project my-saas
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

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
const outputDir = dirname(resolvedOutputPath);

// Backup existing index.html if it exists
if (existsSync(resolvedOutputPath)) {
  const backupPath = resolvedOutputPath.replace(/\.html$/, '.bak.html');
  const existingContent = readFileSync(resolvedOutputPath, 'utf8');
  writeFileSync(backupPath, existingContent);
  console.log(`Backed up existing file to: ${backupPath}`);
}

// Template paths
const templatePath = join(__dirname, '../skills/sell/templates/unified.html');
const workerTemplatePath = join(__dirname, '../skills/sell/worker/index.js');
const wranglerTemplatePath = join(__dirname, '../skills/sell/worker/wrangler.toml');
const adminComponentPath = join(__dirname, '../skills/sell/components/admin.jsx');

// Check templates exist
const templates = [
  { path: templatePath, name: 'unified.html' },
  { path: workerTemplatePath, name: 'worker/index.js' },
  { path: wranglerTemplatePath, name: 'worker/wrangler.toml' },
  { path: adminComponentPath, name: 'components/admin.jsx' }
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
const domain = options.domain || 'example.com';
const appName = options.appName || 'my-app';
const pagesProject = options.pagesProject || appName.replace(/[^a-z0-9-]/gi, '-');

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

// Read and process app code
let appCode = readFileSync(resolvedAppPath, 'utf8').trim();

// Remove import statements - the unified template already imports React, useFireproof, etc.
// This prevents "Identifier 'React' has already been declared" errors
appCode = appCode.replace(/^import\s+.*?from\s+["'].*?["'];?\s*$/gm, '');
appCode = appCode.replace(/^import\s+["'].*?["'];?\s*$/gm, ''); // Side-effect imports

// Remove any existing export default - we'll use the App function directly
appCode = appCode.replace(/^export\s+default\s+/m, '');

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

// Read and process admin component
let adminCode = readFileSync(adminComponentPath, 'utf8').trim();

// Remove any import statements from admin.jsx (template already imports dependencies)
adminCode = adminCode.replace(/^import\s+.*?from\s+["'].*?["'];?\s*$/gm, '');
adminCode = adminCode.replace(/^import\s+["'].*?["'];?\s*$/gm, ''); // Side-effect imports

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
console.log(`\nCreated: ${resolvedOutputPath}`);

// Generate worker.js from template
const workerName = `${pagesProject}-wildcard`;
let workerCode = readFileSync(workerTemplatePath, 'utf8');
workerCode = workerCode
  .split('__APP_NAME__').join(appName)
  .split('__PAGES_PROJECT__').join(pagesProject);

const workerPath = join(outputDir, 'worker.js');
writeFileSync(workerPath, workerCode);
console.log(`Created: ${workerPath}`);

// Generate wrangler.toml from template
let wranglerConfig = readFileSync(wranglerTemplatePath, 'utf8');
wranglerConfig = wranglerConfig
  .split('__APP_NAME__').join(appName)
  .split('__WORKER_NAME__').join(workerName)
  .split('__PAGES_PROJECT__').join(pagesProject)
  .split('__APP_DOMAIN__').join(domain);

const wranglerPath = join(outputDir, 'wrangler.toml');
writeFileSync(wranglerPath, wranglerConfig);
console.log(`Created: ${wranglerPath}`);

// Print comprehensive deployment guide
console.log(`
${'━'.repeat(70)}
  DEPLOYMENT GUIDE FOR ${appName.toUpperCase()}
${'━'.repeat(70)}

Your unified SaaS app is ready! Files created:
  • index.html  - Unified app (landing + tenant + admin)
  • worker.js   - Cloudflare Worker for subdomain routing + API
  • wrangler.toml - Worker configuration

${'─'.repeat(70)}
  STEP 1: DEPLOY TO CLOUDFLARE PAGES
${'─'.repeat(70)}

1. Go to Cloudflare Dashboard → Workers & Pages
2. Create → Pages → Upload assets (Direct Upload)
3. Name your project: "${pagesProject}"
4. Upload index.html
5. Deploy - note your *.pages.dev URL

Test your Pages deployment:
  https://${pagesProject}.pages.dev           → Landing page
  https://${pagesProject}.pages.dev?subdomain=test → Tenant app
  https://${pagesProject}.pages.dev?subdomain=admin → Admin dashboard

${'─'.repeat(70)}
  STEP 2: CREATE KV NAMESPACE
${'─'.repeat(70)}

Run this command to create a KV namespace for tenant data:

  wrangler kv namespace create TENANTS

Copy the namespace ID and update wrangler.toml:

  [[kv_namespaces]]
  binding = "TENANTS"
  id = "YOUR_KV_NAMESPACE_ID"  ← paste ID here

${'─'.repeat(70)}
  STEP 3: DEPLOY THE WORKER
${'─'.repeat(70)}

1. Ensure wrangler.toml has:
   - Correct PAGES_HOSTNAME (${pagesProject}.pages.dev)
   - KV namespace ID from step 2

2. Deploy the worker:
   wrangler deploy

3. Set your Clerk secret key:
   wrangler secret put CLERK_SECRET_KEY
   (paste your sk_test_xxx or sk_live_xxx key)

${'─'.repeat(70)}
  STEP 4: CONFIGURE DNS
${'─'.repeat(70)}

In Cloudflare Dashboard → DNS → Records:

1. DELETE any existing A/AAAA record for @ (root domain)
   ⚠️  You cannot add CNAME if A record exists

2. Add CNAME for root domain:
   Type: CNAME
   Name: @
   Target: ${pagesProject}.pages.dev
   Proxy: ON (orange cloud)

3. Add CNAME for wildcard:
   Type: CNAME
   Name: *
   Target: ${pagesProject}.pages.dev
   Proxy: ON (orange cloud)

${'─'.repeat(70)}
  STEP 5: ADD CUSTOM DOMAIN TO PAGES
${'─'.repeat(70)}

1. Go to Workers & Pages → ${pagesProject} → Custom domains
2. Click "Set up a custom domain"
3. Enter: ${domain}
4. Follow prompts (DNS may already be configured)

${'─'.repeat(70)}
  STEP 6: ADD WORKER ROUTES (MANUAL - IMPORTANT!)
${'─'.repeat(70)}

⚠️  CRITICAL: ONE worker handles ALL routes.
    Do NOT create separate workers or subdomains for webhooks/API.

    CORRECT: ${domain}/webhooks/clerk (path on root domain)
    WRONG:   webhooks.${domain}/clerk (separate subdomain)

⚠️  Routes in wrangler.toml may not apply automatically.
    Add them manually if subdomain routing doesn't work.

1. Go to Workers & Pages → ${pagesProject}-wildcard
2. Settings → Triggers → Routes → Add route

Add these THREE routes to the SAME worker:
┌─────────────────────────────────────┬────────────────┐
│ Pattern                             │ Zone           │
├─────────────────────────────────────┼────────────────┤
│ *.${domain}/*                       │ ${domain}      │
│ ${domain}/api/*                     │ ${domain}      │
│ ${domain}/webhooks/*                │ ${domain}      │
└─────────────────────────────────────┴────────────────┘

${'─'.repeat(70)}
  STEP 7: CONFIGURE CLERK
${'─'.repeat(70)}

1. Go to Clerk Dashboard (clerk.com)
2. Add authorized domains:
   - ${domain}
   - *.${domain} (if supported)
   - ${pagesProject}.pages.dev

3. Enable Clerk Billing:
   - Dashboard → Billing → Connect Stripe
   - Create plans: "pro", "monthly", "yearly" etc.

4. Set up webhooks (for user and billing tracking):
   - Dashboard → Webhooks → Add Endpoint
   - URL: https://${domain}/webhooks/clerk
     (NOTE: This is a PATH on root domain, NOT a subdomain!)
   - User events: user.created, user.deleted
   - Billing events: subscription.created, subscription.updated,
     subscription.canceled, invoice.paid, invoice.payment_failed

5. Get your Admin User ID:
   - Sign up on your app
   - Dashboard → Users → click your user → copy User ID
   - Re-run assemble with: --admin-ids '["user_xxx"]'

${'─'.repeat(70)}
  TESTING CHECKLIST
${'─'.repeat(70)}

After deployment, verify these URLs work:

Landing Page:
  https://${domain}
  → Shows pricing cards, signup flow

Tenant App:
  https://test.${domain}
  → Shows sign-in screen, then your app after auth

Admin Dashboard:
  https://admin.${domain}
  → Shows admin login, then tenant list

API Endpoints:
  curl https://${domain}/api/stats
  → {"tenantCount":0,"userCount":0,"monthlyRevenue":null}

  curl https://${domain}/api/tenants
  → {"tenants":[]}

${'─'.repeat(70)}
  TROUBLESHOOTING
${'─'.repeat(70)}

"522 Connection Timed Out"
  → DNS pointing to non-existent origin. Check CNAME targets.

"Unexpected token '<'" in console
  → Babel not loading. Check script type is "text/babel".

"Cannot read properties of null (reading 'useEffect')"
  → React version mismatch. Check import map uses React 18.

Subdomains return 404
  → Worker route not configured. Add *.${domain}/* route manually.

API returns HTML instead of JSON
  → Root domain API route missing. Add ${domain}/api/* route.

Admin shows "Access Denied"
  → User ID not in --admin-ids. Check Clerk user ID is correct.

${'━'.repeat(70)}
`);
