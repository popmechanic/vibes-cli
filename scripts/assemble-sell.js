#!/usr/bin/env node
/**
 * Sell App Assembler
 *
 * Assembles sell templates with configuration and app code.
 *
 * Usage:
 *   node scripts/assemble-sell.js <template-type> [output.html] [options]
 *
 * Template types:
 *   tenant   - Multi-tenant app wrapper (requires --app-jsx)
 *   landing  - Marketing landing page
 *   admin    - Admin dashboard
 *
 * Options:
 *   --app-jsx <path>      Path to original app.jsx (required for tenant)
 *   --clerk-key <key>     Clerk publishable key
 *   --app-name <name>     App name (e.g., "wedding-photos")
 *   --domain <domain>     Root domain (e.g., "fantasy.wedding")
 *   --monthly-price <$>   Monthly price (e.g., "$9")
 *   --yearly-price <$>    Yearly price (e.g., "$89")
 *   --features <json>     JSON array of feature strings
 *   --tagline <text>      App tagline for landing page
 *   --admin-ids <json>    JSON array of Clerk user IDs with admin access
 *
 * Examples:
 *   node scripts/assemble-sell.js tenant app.html --app-jsx app.jsx --clerk-key pk_test_xxx --app-name wedding-photos --domain fantasy.wedding
 *   node scripts/assemble-sell.js landing index.html --clerk-key pk_test_xxx --app-name wedding-photos --domain fantasy.wedding --monthly-price "$9" --yearly-price "$89" --features '["Feature 1","Feature 2"]'
 *   node scripts/assemble-sell.js admin admin.html --clerk-key pk_test_xxx --app-name wedding-photos --domain fantasy.wedding --admin-ids '["user_xxx"]'
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
function parseArgs(argv) {
  const args = {
    templateType: null,
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
    } else if (!args.templateType) {
      args.templateType = arg;
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

const { templateType, outputPath, options } = parseArgs(process.argv);

// Validate template type
const validTypes = ['tenant', 'landing', 'admin'];
if (!templateType || !validTypes.includes(templateType)) {
  console.error(`Usage: node scripts/assemble-sell.js <${validTypes.join('|')}> [output.html] [options]`);
  console.error('\nRun with --help for more information.');
  process.exit(1);
}

// Default output paths
const defaultOutputs = {
  tenant: 'app.html',
  landing: 'index.html',
  admin: 'admin.html'
};

const resolvedOutputPath = resolve(outputPath || defaultOutputs[templateType]);

// Template paths
const templatePaths = {
  tenant: join(__dirname, '../skills/sell/templates/tenant.html'),
  landing: join(__dirname, '../skills/sell/templates/landing.html'),
  admin: join(__dirname, '../skills/sell/templates/admin.html')
};

const templatePath = templatePaths[templateType];

// Check template exists
if (!existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}

// Read template
let output = readFileSync(templatePath, 'utf8');

// Configuration replacements
const replacements = {
  '__CLERK_PUBLISHABLE_KEY__': options.clerkKey || 'pk_test_YOUR_KEY_HERE',
  '__APP_NAME__': options.appName || 'my-app',
  '__APP_DOMAIN__': options.domain || 'example.com',
  '__MONTHLY_PRICE__': options.monthlyPrice || '$9',
  '__YEARLY_PRICE__': options.yearlyPrice || '$89',
  '__APP_TAGLINE__': options.tagline || 'Your own private workspace. Get started in seconds.'
};

// Handle JSON values
if (options.features) {
  try {
    const features = JSON.parse(options.features);
    replacements['__FEATURES__'] = JSON.stringify(features);
  } catch (e) {
    replacements['__FEATURES__'] = '["Unlimited usage", "Private workspace", "Custom subdomain"]';
  }
} else {
  replacements['__FEATURES__'] = '["Unlimited usage", "Private workspace", "Custom subdomain"]';
}

if (options.adminIds) {
  try {
    const adminIds = JSON.parse(options.adminIds);
    replacements['__ADMIN_USER_IDS__'] = JSON.stringify(adminIds);
  } catch (e) {
    replacements['__ADMIN_USER_IDS__'] = '[]';
  }
} else {
  replacements['__ADMIN_USER_IDS__'] = '[]';
}

// Apply replacements
for (const [placeholder, value] of Object.entries(replacements)) {
  output = output.split(placeholder).join(value);
}

// For tenant template, embed the original app code
if (templateType === 'tenant') {
  const appJsxPath = options.appJsx;

  if (!appJsxPath) {
    console.error('Error: --app-jsx is required for tenant template');
    console.error('Usage: node scripts/assemble-sell.js tenant app.html --app-jsx app.jsx [other options]');
    process.exit(1);
  }

  const resolvedAppPath = resolve(appJsxPath);

  if (!existsSync(resolvedAppPath)) {
    console.error(`App file not found: ${resolvedAppPath}`);
    process.exit(1);
  }

  let appCode = readFileSync(resolvedAppPath, 'utf8').trim();

  // Remove import statements - the tenant template already imports React, useFireproof, etc.
  // This prevents "Identifier 'React' has already been declared" errors
  appCode = appCode.replace(/^import\s+.*?from\s+["'].*?["'];?\s*$/gm, '');
  appCode = appCode.replace(/^import\s+["'].*?["'];?\s*$/gm, ''); // Side-effect imports

  // Remove any existing export default - we'll use the App function directly
  appCode = appCode.replace(/^export\s+default\s+/m, '');

  // If the app uses useFireproof with a hardcoded name, make it tenant-aware
  // Replace useFireproof("xxx") with useFireproof(useTenant().dbName)
  // This is a simple replacement - complex cases may need manual adjustment
  const firepoolMatch = appCode.match(/useFireproof\s*\(\s*["']([^"']+)["']\s*\)/);
  if (firepoolMatch) {
    const originalDbName = firepoolMatch[1];
    console.log(`Note: Found hardcoded database name "${originalDbName}". The tenant template uses dynamic database naming via useTenant().`);
  }

  // Insert app code at placeholder
  const appPlaceholder = '// __VIBES_APP_CODE__';
  if (output.includes(appPlaceholder)) {
    output = output.replace(appPlaceholder, appCode);
  } else {
    console.error(`Template missing placeholder: ${appPlaceholder}`);
    process.exit(1);
  }
}

// Write output
writeFileSync(resolvedOutputPath, output);
console.log(`Created: ${resolvedOutputPath}`);

// Print next steps
console.log('\nNext steps:');
if (templateType === 'tenant') {
  console.log('1. Update the Clerk publishable key if using placeholder');
  console.log('2. Deploy to your static host');
  console.log('3. Configure wildcard DNS for *.yourdomain.com');
}
if (templateType === 'landing') {
  console.log('1. Update pricing and features if using defaults');
  console.log('2. Deploy to your root domain');
}
if (templateType === 'admin') {
  console.log('1. Add your Clerk user ID to the admin list');
  console.log('2. Deploy to admin.yourdomain.com');
}
