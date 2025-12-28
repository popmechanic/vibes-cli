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
const deploymentGuidePath = join(__dirname, '../skills/sell/templates/deployment-guide.txt');

// Check templates exist
const templates = [
  { path: templatePath, name: 'unified.html' },
  { path: workerTemplatePath, name: 'worker/index.js' },
  { path: wranglerTemplatePath, name: 'worker/wrangler.toml' },
  { path: adminComponentPath, name: 'components/admin.jsx' },
  { path: deploymentGuidePath, name: 'deployment-guide.txt' }
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

// Parse numeric prices for worker env vars (strip $ and non-digits)
const monthlyPriceNum = (options.monthlyPrice || '$9').replace(/\D/g, '') || '9';
const yearlyPriceNum = (options.yearlyPrice || '$89').replace(/\D/g, '') || '89';

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
  .split('__APP_DOMAIN__').join(domain)
  .split('__MONTHLY_PRICE_NUM__').join(monthlyPriceNum)
  .split('__YEARLY_PRICE_NUM__').join(yearlyPriceNum);

const wranglerPath = join(outputDir, 'wrangler.toml');
writeFileSync(wranglerPath, wranglerConfig);
console.log(`Created: ${wranglerPath}`);

// Print comprehensive deployment guide from template
let deploymentGuide = readFileSync(deploymentGuidePath, 'utf8');
deploymentGuide = deploymentGuide
  .split('__APP_NAME_UPPER__').join(appName.toUpperCase())
  .split('__APP_NAME__').join(appName)
  .split('__APP_DOMAIN__').join(domain)
  .split('__PAGES_PROJECT__').join(pagesProject);
console.log(deploymentGuide);
