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

// Write main output
writeFileSync(resolvedOutputPath, output);
console.log(`\nCreated: ${resolvedOutputPath}`);

// Generate worker.js
const workerCode = `/**
 * Cloudflare Worker for ${appName}
 *
 * Handles:
 * - Wildcard subdomain proxying to Pages
 * - /api/tenants - List all tenants
 * - /api/stats - Get stats
 * - /api/tenants/register - Register tenant subdomain
 * - /webhooks/clerk - Clerk webhook handler
 *
 * Environment Variables (set in wrangler.toml or dashboard):
 * - PAGES_HOSTNAME: Your Pages project hostname (e.g., "myapp.pages.dev")
 * - CLERK_SECRET_KEY: Your Clerk secret key (set via wrangler secret)
 *
 * KV Namespace:
 * - TENANTS: KV namespace for tenant data
 */

// Dynamic CORS headers (reflect origin for credentials support)
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const corsHeaders = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Handle API routes
    if (pathname.startsWith('/api/')) {
      return handleAPI(request, env, pathname, corsHeaders);
    }

    // Handle Clerk webhooks
    if (pathname === '/webhooks/clerk') {
      return handleClerkWebhook(request, env);
    }

    // Proxy to Pages
    return proxyToPages(request, env, url.hostname, corsHeaders);
  }
};

async function handleAPI(request, env, pathname, corsHeaders) {
  // Get all tenants
  if (pathname === '/api/tenants' && request.method === 'GET') {
    try {
      const listResult = await env.TENANTS.get('tenants:list');
      const subdomains = listResult ? JSON.parse(listResult) : [];

      const tenants = [];
      for (const subdomain of subdomains) {
        const tenant = await env.TENANTS.get(\`tenant:\${subdomain}\`);
        if (tenant) {
          tenants.push(JSON.parse(tenant));
        }
      }

      return new Response(JSON.stringify({ tenants }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Get stats (includes billing metrics)
  if (pathname === '/api/stats' && request.method === 'GET') {
    try {
      const [tenantCount, userCount, subscriberCount, mrr] = await Promise.all([
        env.TENANTS.get('stats:tenantCount'),
        env.TENANTS.get('stats:userCount'),
        env.TENANTS.get('stats:subscriberCount'),
        env.TENANTS.get('stats:mrr')
      ]);

      return new Response(JSON.stringify({
        tenantCount: parseInt(tenantCount || '0'),
        userCount: parseInt(userCount || '0'),
        subscriberCount: parseInt(subscriberCount || '0'),
        mrr: parseFloat(mrr || '0')
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // Register tenant
  if (pathname === '/api/tenants/register' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { subdomain, userId, email, plan } = body;

      if (!subdomain || !userId) {
        return new Response(JSON.stringify({ error: 'Missing subdomain or userId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check if subdomain is taken
      const existing = await env.TENANTS.get(\`tenant:\${subdomain}\`);
      if (existing) {
        return new Response(JSON.stringify({ error: 'Subdomain already taken' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create tenant
      const tenant = {
        subdomain,
        userId,
        email,
        plan: plan || 'pro',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      await env.TENANTS.put(\`tenant:\${subdomain}\`, JSON.stringify(tenant));

      // Update tenant list
      const listResult = await env.TENANTS.get('tenants:list');
      const subdomains = listResult ? JSON.parse(listResult) : [];
      if (!subdomains.includes(subdomain)) {
        subdomains.push(subdomain);
        await env.TENANTS.put('tenants:list', JSON.stringify(subdomains));

        // Update count
        await env.TENANTS.put('stats:tenantCount', String(subdomains.length));
      }

      return new Response(JSON.stringify({ success: true, tenant }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleClerkWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.json();
    const eventType = body.type;
    const data = body.data;

    console.log(\`Clerk webhook: \${eventType}\`);

    // User events
    if (eventType === 'user.created') {
      const user = {
        id: data.id,
        email: data.email_addresses?.[0]?.email_address,
        firstName: data.first_name,
        lastName: data.last_name,
        createdAt: new Date().toISOString()
      };

      await env.TENANTS.put(\`user:\${data.id}\`, JSON.stringify(user));

      const count = parseInt(await env.TENANTS.get('stats:userCount') || '0');
      await env.TENANTS.put('stats:userCount', String(count + 1));
    }

    if (eventType === 'user.deleted') {
      await env.TENANTS.delete(\`user:\${data.id}\`);

      const count = parseInt(await env.TENANTS.get('stats:userCount') || '0');
      await env.TENANTS.put('stats:userCount', String(Math.max(0, count - 1)));
    }

    // Billing events - Subscription lifecycle
    if (eventType === 'subscription.created') {
      await handleSubscriptionCreated(env, data);
    }

    if (eventType === 'subscription.updated') {
      await handleSubscriptionUpdated(env, data);
    }

    if (eventType === 'subscription.canceled') {
      await handleSubscriptionCanceled(env, data);
    }

    // Billing events - Invoices
    if (eventType === 'invoice.paid') {
      await handleInvoicePaid(env, data);
    }

    if (eventType === 'invoice.payment_failed') {
      await handleInvoicePaymentFailed(env, data);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// === Billing Event Handlers ===

async function handleSubscriptionCreated(env, subscriptionData) {
  const userId = subscriptionData.user_id || subscriptionData.subscriber_id;
  const subscription = {
    id: subscriptionData.id,
    status: subscriptionData.status || 'active',
    planId: subscriptionData.plan_id,
    billingPeriod: subscriptionData.billing_period || 'monthly',
    amount: subscriptionData.amount,
    createdAt: subscriptionData.created_at || Date.now(),
    currentPeriodEnd: subscriptionData.current_period_end
  };

  // Store subscription
  await env.TENANTS.put(\`subscription:\${userId}\`, JSON.stringify(subscription));

  // Update tenant's subscription status
  await updateTenantSubscriptionStatus(env, userId, 'active', subscription.billingPeriod);

  // Update subscriber count
  const countStr = await env.TENANTS.get('stats:subscriberCount') || '0';
  await env.TENANTS.put('stats:subscriberCount', String(parseInt(countStr) + 1));

  // Update MRR
  await updateMRR(env);
}

async function handleSubscriptionUpdated(env, subscriptionData) {
  const userId = subscriptionData.user_id || subscriptionData.subscriber_id;
  const existingStr = await env.TENANTS.get(\`subscription:\${userId}\`);
  const existing = existingStr ? JSON.parse(existingStr) : {};

  const subscription = {
    ...existing,
    id: subscriptionData.id,
    status: subscriptionData.status,
    planId: subscriptionData.plan_id,
    billingPeriod: subscriptionData.billing_period || existing.billingPeriod,
    amount: subscriptionData.amount,
    updatedAt: Date.now(),
    currentPeriodEnd: subscriptionData.current_period_end
  };

  await env.TENANTS.put(\`subscription:\${userId}\`, JSON.stringify(subscription));

  // Update tenant status based on subscription status
  const tenantStatus = subscription.status === 'active' ? 'active' :
                       subscription.status === 'past_due' ? 'past_due' : 'canceled';
  await updateTenantSubscriptionStatus(env, userId, tenantStatus, subscription.billingPeriod);

  await updateMRR(env);
}

async function handleSubscriptionCanceled(env, subscriptionData) {
  const userId = subscriptionData.user_id || subscriptionData.subscriber_id;

  // Update subscription status
  const existingStr = await env.TENANTS.get(\`subscription:\${userId}\`);
  if (existingStr) {
    const subscription = JSON.parse(existingStr);
    subscription.status = 'canceled';
    subscription.canceledAt = Date.now();
    await env.TENANTS.put(\`subscription:\${userId}\`, JSON.stringify(subscription));
  }

  // Update tenant status
  await updateTenantSubscriptionStatus(env, userId, 'canceled');

  // Update subscriber count
  const countStr = await env.TENANTS.get('stats:subscriberCount') || '1';
  await env.TENANTS.put('stats:subscriberCount', String(Math.max(0, parseInt(countStr) - 1)));

  await updateMRR(env);
}

async function handleInvoicePaid(env, invoiceData) {
  const userId = invoiceData.user_id || invoiceData.subscriber_id;

  const invoice = {
    id: invoiceData.id,
    userId,
    amount: invoiceData.amount_paid || invoiceData.total,
    currency: invoiceData.currency || 'usd',
    paidAt: invoiceData.paid_at || Date.now(),
    status: 'paid'
  };

  await env.TENANTS.put(\`invoice:\${invoice.id}\`, JSON.stringify(invoice));

  // Track monthly revenue
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const revenueStr = await env.TENANTS.get(\`revenue:\${monthKey}\`) || '0';
  const newRevenue = parseInt(revenueStr) + (invoice.amount || 0);
  await env.TENANTS.put(\`revenue:\${monthKey}\`, String(newRevenue));
}

async function handleInvoicePaymentFailed(env, invoiceData) {
  const userId = invoiceData.user_id || invoiceData.subscriber_id;
  await updateTenantSubscriptionStatus(env, userId, 'past_due');
}

// === Helper Functions ===

async function updateTenantSubscriptionStatus(env, userId, status, billingPeriod = null) {
  const listStr = await env.TENANTS.get('tenants:list') || '[]';
  const subdomains = JSON.parse(listStr);

  for (const subdomain of subdomains) {
    const tenantStr = await env.TENANTS.get(\`tenant:\${subdomain}\`);
    if (tenantStr) {
      const tenant = JSON.parse(tenantStr);
      if (tenant.userId === userId) {
        tenant.subscriptionStatus = status;
        if (billingPeriod) tenant.billingPeriod = billingPeriod;
        tenant.subscriptionUpdatedAt = Date.now();
        await env.TENANTS.put(\`tenant:\${subdomain}\`, JSON.stringify(tenant));
        break;
      }
    }
  }
}

async function updateMRR(env) {
  const listStr = await env.TENANTS.get('tenants:list') || '[]';
  const subdomains = JSON.parse(listStr);

  let mrr = 0;
  // Default prices - these should match your plan configuration
  const monthlyPrice = 9;
  const yearlyPrice = 89;

  for (const subdomain of subdomains) {
    const tenantStr = await env.TENANTS.get(\`tenant:\${subdomain}\`);
    if (tenantStr) {
      const tenant = JSON.parse(tenantStr);
      if (tenant.subscriptionStatus === 'active') {
        if (tenant.billingPeriod === 'yearly') {
          mrr += yearlyPrice / 12;
        } else {
          mrr += monthlyPrice;
        }
      }
    }
  }

  await env.TENANTS.put('stats:mrr', String(Math.round(mrr * 100) / 100));
}

async function proxyToPages(request, env, hostname, corsHeaders) {
  // Construct Pages URL
  const pagesUrl = new URL(request.url);
  pagesUrl.hostname = env.PAGES_HOSTNAME || '${pagesProject}.pages.dev';

  // Clone request with new URL
  const proxyRequest = new Request(pagesUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual'
  });

  const response = await fetch(proxyRequest);

  // Clone response with CORS headers
  const newHeaders = new Headers(response.headers);
  // Don't override CORS on HTML pages
  if (!newHeaders.get('Content-Type')?.includes('text/html')) {
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  }

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}
`;

const workerPath = join(outputDir, 'worker.js');
writeFileSync(workerPath, workerCode);
console.log(`Created: ${workerPath}`);

// Generate wrangler.toml
const wranglerConfig = `# Cloudflare Worker configuration for ${appName}
#
# Prerequisites:
#   1. Create KV namespace: wrangler kv namespace create TENANTS
#   2. Copy the namespace ID below
#   3. Update PAGES_HOSTNAME with your Pages project URL
#   4. Deploy: wrangler deploy
#   5. Set secret: wrangler secret put CLERK_SECRET_KEY

name = "${pagesProject}-wildcard"
main = "worker.js"
compatibility_date = "2024-12-01"

[vars]
PAGES_HOSTNAME = "${pagesProject}.pages.dev"

# Create this KV namespace with: wrangler kv namespace create TENANTS
# Then copy the ID below
[[kv_namespaces]]
binding = "TENANTS"
id = "YOUR_KV_NAMESPACE_ID"

# Worker routes - add these MANUALLY in Cloudflare Dashboard if they don't apply
# Dashboard: Workers & Pages > ${pagesProject}-wildcard > Settings > Triggers > Routes
routes = [
  { pattern = "*.${domain}/*", zone_name = "${domain}" },
  { pattern = "${domain}/api/*", zone_name = "${domain}" },
  { pattern = "${domain}/webhooks/*", zone_name = "${domain}" }
]
`;

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

⚠️  Routes in wrangler.toml may not apply automatically.
    Add them manually if subdomain routing doesn't work.

1. Go to Workers & Pages → ${pagesProject}-wildcard
2. Settings → Triggers → Routes → Add route

Add these THREE routes:
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
