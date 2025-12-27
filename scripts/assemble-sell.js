#!/usr/bin/env node
/**
 * Sell App Assembler
 *
 * Assembles a unified SaaS app from the sell template and user's app code.
 * Creates a single index.html that handles landing, tenant, and admin routes
 * via client-side subdomain detection.
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
 *     --admin-ids '["user_xxx"]'
 *
 * Deployment:
 *   The output file handles all routes via client-side subdomain detection:
 *   - Root domain (fantasy.wedding) → Landing page with pricing
 *   - Subdomains (alice.fantasy.wedding) → Tenant app with auth
 *   - Admin subdomain (admin.fantasy.wedding) → Admin dashboard
 *
 *   For Cloudflare Pages with wildcard subdomains, you'll need a Worker
 *   to proxy *.domain.com to your Pages deployment.
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

// Backup existing index.html if it exists
if (existsSync(resolvedOutputPath)) {
  const backupPath = resolvedOutputPath.replace(/\.html$/, '.bak.html');
  const existingContent = readFileSync(resolvedOutputPath, 'utf8');
  writeFileSync(backupPath, existingContent);
  console.log(`Backed up existing file to: ${backupPath}`);
}

// Template path - use the unified template
const templatePath = join(__dirname, '../skills/sell/templates/unified.html');

// Check template exists
if (!existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  console.error('Make sure the sell skill templates are installed.');
  process.exit(1);
}

// Read template
let output = readFileSync(templatePath, 'utf8');

// Configuration replacements
const replacements = {
  '__CLERK_PUBLISHABLE_KEY__': options.clerkKey || 'pk_test_YOUR_KEY_HERE',
  '__APP_NAME__': options.appName || 'my-app',
  '__APP_TITLE__': options.appTitle || options.appName || 'My App',
  '__APP_DOMAIN__': options.domain || 'example.com',
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

// Write output
writeFileSync(resolvedOutputPath, output);
console.log(`\nCreated: ${resolvedOutputPath}`);

// Print deployment guide
console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEPLOYMENT GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your unified SaaS app is ready! This single file handles:
  • Landing page at ${options.domain || 'yourdomain.com'}
  • Tenant apps at *.${options.domain || 'yourdomain.com'}
  • Admin dashboard at admin.${options.domain || 'yourdomain.com'}

CLOUDFLARE PAGES DEPLOYMENT:
─────────────────────────────
1. Create a Cloudflare Pages project (Direct Upload)
2. Upload your ${resolvedOutputPath} file
3. Add your custom domain in Pages settings

WILDCARD SUBDOMAIN SETUP:
─────────────────────────────
Cloudflare Pages doesn't support wildcard custom domains directly.
Create a Cloudflare Worker to proxy subdomains:

1. Go to Workers & Pages → Create → Create Worker
2. Replace the code with:

   export default {
     async fetch(request) {
       const url = new URL(request.url);
       url.hostname = 'YOUR-PROJECT.pages.dev';
       return fetch(url, request);
     }
   }

3. Deploy the Worker
4. Go to Worker Settings → Triggers → Add Route
5. Add route: *.${options.domain || 'yourdomain.com'}/*

DNS RECORDS:
─────────────────────────────
Add these DNS records in Cloudflare:
  • A record: @ → 192.0.2.1 (proxied) - for root domain
  • Worker route handles *.${options.domain || 'yourdomain.com'}/*

CLERK SETUP:
─────────────────────────────
1. Create a Clerk application at clerk.com
2. Enable Clerk Billing and connect Stripe
3. Create subscription plans (pro, basic, etc.)
4. Update the publishable key if using placeholder

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
