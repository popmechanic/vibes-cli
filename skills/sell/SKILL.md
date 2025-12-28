---
name: sell
description: Transform a Vibes app into a multi-tenant SaaS with per-subdomain billing. Adds Clerk authentication, Stripe payments via Clerk Billing, and generates a unified app with landing page, tenant routing, and admin dashboard.
---

**Display this ASCII art immediately when starting:**

```
░▒▓███████▓▒░▒▓████████▓▒░▒▓█▓▒░      ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓██████▓▒░░▒▓██████▓▒░ ░▒▓█▓▒░      ░▒▓█▓▒░
       ░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░
       ░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░      ░▒▓█▓▒░
░▒▓███████▓▒░░▒▓████████▓▒░▒▓████████▓▒░▒▓████████▓▒░
```

# Sell - Transform Vibes to SaaS

**IMPORTANT**: This skill uses `assemble-sell.js` to inject the user's app into a pre-built template. Do NOT generate code manually - always run the assembly script. The template contains security checks, API integration, and proper Clerk/Fireproof patterns that will break if you write your own code.

Convert your Vibes app into a multi-tenant SaaS product with:
- Subdomain-based tenancy (alice.yourdomain.com)
- Clerk authentication + Clerk Billing (Stripe)
- Per-tenant Fireproof database isolation
- Marketing landing page with pricing
- Admin dashboard for tenant management
- **Single unified file with client-side routing**

## Architecture

The sell skill generates a **single index.html** file that handles all routes via client-side subdomain detection:

```
yourdomain.com          → Landing page with pricing
*.yourdomain.com        → Tenant app with auth
admin.yourdomain.com    → Admin dashboard
```

This approach simplifies deployment - you upload one file and it handles everything.

### Single Unified Worker

**IMPORTANT:** The sell skill uses ONE Cloudflare Worker that handles ALL routes via path-based routing:

```
yourdomain.com/api/*       → API endpoints (same worker)
yourdomain.com/webhooks/*  → Clerk webhooks (same worker)
*.yourdomain.com/*         → Subdomain proxy (same worker)
```

Do NOT create separate workers or subdomains for webhooks/API. The webhook URL is `yourdomain.com/webhooks/clerk`, NOT `webhooks.yourdomain.com`.

---

## Workflow Overview

1. **Detect** existing app (app.jsx or riff selection)
2. **Configure** domain, pricing, and Clerk keys
3. **Assemble** unified app with all routes (run assembly script)
4. **Deploy** automatically (check wrangler, run deploy script)
5. **Configure** Clerk (manual - no API available)

**IMPORTANT**: Steps 3 and 4 are automated. After gathering configuration, run the scripts immediately. Do NOT give manual Cloudflare instructions.

---

## Step 1: Detect Existing App

Look for an existing Vibes app to transform:

```bash
# Check current directory
ls -la app.jsx index.html 2>/dev/null

# Check for riff directories
ls -d riff-* 2>/dev/null
```

**Decision tree:**
- Found `app.jsx` → Use directly
- Found multiple `riff-*/app.jsx` → Ask user to select one
- Found nothing → Tell user to run `/vibes:vibes` first

If riffs exist, ask:
> "I found multiple riff variations. Which one would you like to transform into a SaaS product?"

---

## Step 2: Gather Configuration

Ask the user for these details:

1. **App Name** (for database naming)
   - Example: "wedding-photos"
   - Used for: `{app}-admin` and `{app}-{subdomain}` databases

2. **App Title** (display name)
   - Example: "Fantasy Wedding"
   - Used in: headers, landing page

3. **Root Domain**
   - Example: "fantasy.wedding"
   - Subdomains will be: `alice.fantasy.wedding`

4. **Tagline** (for landing page)
   - Example: "Share your wedding photos with guests"

5. **Pricing** (monthly/yearly)
   - Example: $9/month, $89/year
   - Feature list for pricing cards

6. **Clerk Publishable Key**
   - From Clerk Dashboard → API Keys
   - Format: `pk_test_...` or `pk_live_...`

7. **Admin User IDs** (array of Clerk user IDs)
   - From Clerk Dashboard → Users → click user → copy ID
   - Admins bypass subscription gate

---

## Step 3: Assemble (DO NOT GENERATE CODE)

**CRITICAL**: You MUST use the assembly script. Do NOT generate your own HTML/JSX code. The template has been carefully designed with proper security, API endpoints, and Clerk integration that will break if you generate code manually.

### 3.1 What app.jsx Should Contain

The app.jsx should contain ONLY the user's App component - not SaaS infrastructure. The template provides:
- CONFIG, CLERK_PUBLISHABLE_KEY, APP_NAME, etc.
- ClerkProvider, TenantProvider, SubscriptionGate
- Landing page, admin dashboard, routing

**The assembly script automatically strips:**
- Import statements (template imports everything)
- `export default` (template renders App directly)
- `CONFIG` declarations (template provides its own)
- Template constant declarations

### 3.2 Update App for Tenant Context

The user's app needs to use `useTenant()` for database scoping. Check if their app has a hardcoded database name:

```jsx
// BEFORE: Hardcoded name
const { useLiveQuery } = useFireproof("my-app");

// AFTER: Tenant-aware
const { dbName } = useTenant();
const { useLiveQuery } = useFireproof(dbName);
```

If the app uses a hardcoded name, update it to use `useTenant()`:

1. Find the `useFireproof("...")` call
2. Add `const { dbName } = useTenant();` before it
3. Change to `useFireproof(dbName)`

The template makes `useTenant` available globally via `window.useTenant`.

### 3.3 Assemble Unified App

Run the assembly script to generate the unified files:

```bash
# Find latest plugin version
VIBES_DIR="$(ls -d ~/.claude/plugins/cache/vibes-diy/vibes/*/ | sort -V | tail -1)"

# Run assembly
node "${VIBES_DIR}scripts/assemble-sell.js" app.jsx index.html \
  --clerk-key "pk_test_xxx" \
  --app-name "wedding-photos" \
  --app-title "Fantasy Wedding" \
  --domain "fantasy.wedding" \
  --tagline "Share your wedding photos with guests" \
  --monthly-price "$9" \
  --yearly-price "$89" \
  --features '["Photo sharing","Guest uploads","Live gallery"]' \
  --admin-ids '["user_xxx"]'
```

**The assembly script generates THREE files:**
1. `index.html` - Unified app (landing + tenant + admin)
2. `worker.js` - Cloudflare Worker for subdomain routing + API
3. `wrangler.toml` - Worker configuration template

**WARNING**: If the assembly script fails or isn't available, DO NOT attempt to write the HTML manually. The template is complex and contains critical security patterns. Ask the user to ensure the plugin is installed correctly.

---

## Step 4: Deploy (AUTOMATED)

**IMPORTANT**: After assembly, IMMEDIATELY proceed with automated deployment. Do NOT give the user manual Cloudflare steps. The deploy script handles everything.

### 4.1 Check for Wrangler

First, check if wrangler is installed:

```bash
which wrangler || echo "not installed"
```

If wrangler is not installed, install it:

```bash
npm install -g wrangler
```

If wrangler is installed but not authenticated:

```bash
wrangler login
```

**DO NOT run individual wrangler commands** like:
- `wrangler kv namespace create` - deploy script handles this
- `wrangler zones list` - doesn't exist
- `wrangler pages project add-custom-domain` - doesn't exist
- `wrangler deploy` directly - deploy script handles this

**ONLY run the deploy script** - it handles KV creation, deployment, DNS, and routes automatically. The script gracefully handles "already exists" errors.

### 4.2 Run Automated Deployment

**USE `deploy-sell.js` (not `sell.js`)** - it works interactively without needing a config file:

```bash
# Find latest plugin version
VIBES_DIR="$(ls -d ~/.claude/plugins/cache/vibes-diy/vibes/*/ | sort -V | tail -1)"

# Run automated deployment - prompts for everything interactively
node "${VIBES_DIR}scripts/deploy-sell.js"
```

**DO NOT use `sell.js deploy`** - it requires a config file created by `sell.js init`. Use `deploy-sell.js` instead.

**NEVER run `wrangler deploy` directly** - it will cause route conflicts with existing workers.

The script will prompt for Cloudflare API token if needed, then automate:
- KV namespace creation
- wrangler.toml update with namespace ID
- Worker deployment
- Clerk secret configuration
- DNS record creation (CNAME for @ and *)
- Worker route configuration
- Pages deployment
- Endpoint verification

### 4.3 Clerk Configuration (Manual - No API Available)

After deployment completes, **IMMEDIATELY provide the Clerk setup instructions from Step 5 below**. Do NOT web search for Clerk documentation - all instructions are in this file.

Tell the user:
> "Cloudflare deployment is complete. Now let's configure Clerk. Here are the steps:"

Then provide the Step 5 instructions verbatim.

---

## Alternative: Config-Based CLI (sell.js)

**Only use if you need repeatable deployments.** For most cases, use `deploy-sell.js` instead.

The `sell.js` script requires a config file - don't use it without running `init` first:

```bash
VIBES_DIR="$(ls -d ~/.claude/plugins/cache/vibes-diy/vibes/*/ | sort -V | tail -1)"

# REQUIRED FIRST: Create config file
node "${VIBES_DIR}scripts/sell.js" init

# Then deploy
node "${VIBES_DIR}scripts/sell.js" deploy
```

---

## Legacy Deploy (Separate Scripts)

```bash
# Find latest plugin version
VIBES_DIR="$(ls -d ~/.claude/plugins/cache/vibes-diy/vibes/*/ | sort -V | tail -1)"

# Run automated deployment
node "${VIBES_DIR}scripts/deploy-sell.js"
```

This script automates:
- **KV namespace creation** (parses ID automatically)
- **wrangler.toml update** (inserts namespace ID)
- **Worker deployment** (runs `wrangler deploy`)
- **Secret configuration** (sets CLERK_SECRET_KEY)
- **DNS configuration** (creates CNAME records via Cloudflare API)
- **Worker routes** (configures all 3 routes via API)
- **Verification** (tests endpoints after deployment)

### Requirements

1. **Wrangler CLI** installed: `npm install -g wrangler`
2. **Cloudflare API Token** with permissions:
   - Zone:DNS:Edit
   - Zone:Zone:Read
   - Account:Workers KV Storage:Edit
   - Account:Workers Scripts:Edit
3. **Domain** already added to Cloudflare

### Usage Options

```bash
# First deployment (interactive prompts)
node scripts/deploy-sell.js

# Redeploy existing project
node scripts/deploy-sell.js --project fantasy-wedding

# Skip specific phases
node scripts/deploy-sell.js --skip-dns --skip-routes

# Verify deployment status
node scripts/deploy-sell.js --project fantasy-wedding --verify-only
```

The script saves configuration to `~/.vibes-deploy.json` for subsequent deployments.

**After automated deployment**, you still need to configure Clerk manually (see Step 5 below).

If you prefer manual deployment or need finer control, follow Step 4 below instead.

---

## Step 4: Cloudflare Deployment (Manual)

**IMPORTANT: Always use Wrangler CLI for Cloudflare operations.** Do not use the Cloudflare Dashboard unless Wrangler fails. Wrangler is faster, scriptable, and less error-prone.

```bash
# Ensure Wrangler is installed and authenticated
npm install -g wrangler
wrangler login
```

### 4.1 Deploy to Cloudflare Pages

Use Wrangler to deploy the Pages site:

```bash
# Deploy index.html to Pages (creates project if needed)
wrangler pages deploy . --project-name yourproject
```

Note the `*.pages.dev` URL from the output.

**Test your Pages deployment immediately:**
```
https://yourproject.pages.dev              → Landing page
https://yourproject.pages.dev?subdomain=test → Tenant app
https://yourproject.pages.dev?subdomain=admin → Admin dashboard
```

The `?subdomain=` parameter works on pages.dev before you configure custom domains.

### 4.2 Create KV Namespace

**IMPORTANT: Create a NEW KV namespace for EACH deployment.** Do NOT reuse a KV namespace from another project - this will cause tenant data to mix between domains.

```bash
# Create a NEW namespace for this project
wrangler kv namespace create TENANTS
```

Copy the namespace ID and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TENANTS"
id = "YOUR_KV_NAMESPACE_ID"  # ← paste the NEW ID here
```

KV keys are prefixed with APP_DOMAIN (e.g., `fantasy.wedding:tenant:alice`) to isolate data, but using separate namespaces per project is still recommended.

### 4.3 Deploy the Worker

1. **Ensure wrangler.toml has:**
   - Correct `PAGES_HOSTNAME` (yourproject.pages.dev)
   - KV namespace ID from step 4.2

2. **Deploy:**
   ```bash
   wrangler deploy
   ```

3. **Set Clerk secret key:**
   ```bash
   wrangler secret put CLERK_SECRET_KEY
   # paste your sk_test_xxx or sk_live_xxx key
   ```

### 4.4 Configure DNS (via Cloudflare API)

Use the Cloudflare API to configure DNS. First, get your Zone ID and API token:

```bash
# Set your credentials
export CF_API_TOKEN="your-api-token"
export CF_ZONE_ID="your-zone-id"  # Find in Cloudflare Dashboard → Overview → right sidebar

# Delete any existing A/AAAA records for root (required before adding CNAME)
# List records first to find IDs:
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?type=A&name=yourdomain.com" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[].id'

# Delete each A record by ID:
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/RECORD_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN"

# Add CNAME for root domain
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"@","content":"yourproject.pages.dev","proxied":true}'

# Add CNAME for wildcard
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"*","content":"yourproject.pages.dev","proxied":true}'
```

### 4.5 Add Custom Domain to Pages

```bash
# Add custom domain to Pages project
wrangler pages project list  # Find your project name
# Custom domains must be added via dashboard for now:
# Workers & Pages → [project] → Custom domains → Set up a custom domain
```

### 4.6 Add Worker Routes (via Cloudflare API)

**CRITICAL: ONE Worker, THREE Routes**

The sell skill uses a **single unified worker** that handles ALL routes. Do NOT create separate workers or subdomains for webhooks/API. Everything runs through ONE worker with path-based routing:

```
yourdomain.com/api/*       → Same worker (API endpoints)
yourdomain.com/webhooks/*  → Same worker (Clerk webhooks)
*.yourdomain.com/*         → Same worker (subdomain proxy)
```

**WRONG:** Creating `webhooks.yourdomain.com` or `api.yourdomain.com`
**RIGHT:** Using `yourdomain.com/webhooks/*` and `yourdomain.com/api/*`

Use the Cloudflare API to add routes (wrangler.toml routes often don't apply):

```bash
# Add all three routes to the SAME worker
WORKER_NAME="yourproject-wildcard"
DOMAIN="yourdomain.com"

# Wildcard subdomain route
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"pattern\":\"*.$DOMAIN/*\",\"script\":\"$WORKER_NAME\"}"

# API route (path-based, NOT subdomain)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"pattern\":\"$DOMAIN/api/*\",\"script\":\"$WORKER_NAME\"}"

# Webhooks route (path-based, NOT subdomain)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"pattern\":\"$DOMAIN/webhooks/*\",\"script\":\"$WORKER_NAME\"}"
```

All three routes point to the same worker:
- Wildcard handles subdomain routing (alice.yourdomain.com)
- /api/* handles admin dashboard API calls from root domain
- /webhooks/* handles Clerk webhook events at yourdomain.com/webhooks/clerk

---

## Step 5: Clerk Setup (PROVIDE THESE INSTRUCTIONS AFTER DEPLOYMENT)

**IMPORTANT**: After Cloudflare deployment completes, provide these instructions to the user. Do NOT web search - everything needed is here.

**NO REBUILD REQUIRED**: Clerk setup is done in the Clerk Dashboard only. The app already has Clerk integration built in - you just need to configure your Clerk account. Do NOT regenerate or reassemble the app.

### 5.1 Create Clerk Application

1. Go to [clerk.com](https://clerk.com) and sign in
2. Create a new application
3. Copy the **Publishable Key**

### 5.2 Enable Clerk Billing

1. In Clerk Dashboard, go to **Billing**
2. Create subscription plans:
   - **monthly** or **pro** - matches `has({ plan: 'monthly' })` or `has({ plan: 'pro' })`
   - **yearly** - matches `has({ plan: 'yearly' })`

   Plan names must match what your app checks with `has({ plan: 'planname' })`

### 5.3 Get Your Admin User ID

1. Sign up on your app
2. Go to Clerk Dashboard → **Users**
3. Click your user
4. Copy the **User ID** (e.g., `user_2abc123xyz`)

Then paste the User ID here and I'll update the app configuration.

### 5.4 Configure Clerk Webhooks (Required for User Tracking)

Set up webhooks so the admin dashboard can track users:

**NOTE:** The webhook URL uses a **path** on your root domain, NOT a subdomain:
- **CORRECT:** `https://yourdomain.com/webhooks/clerk`
- **WRONG:** `https://webhooks.yourdomain.com/clerk`

1. Go to Clerk Dashboard → **Webhooks** → **Add Endpoint**
2. Enter endpoint URL: `https://yourdomain.com/webhooks/clerk`
3. Subscribe to events:
   - `user.created` (required)
   - `user.deleted` (required)
4. Click **Create**

**Optional: Verify Webhook Signatures (Production)**

For production, verify webhook signatures:

1. After creating the endpoint, copy the **Signing Secret** (whsec_...)
2. Add to wrangler.toml:
   ```toml
   [vars]
   CLERK_WEBHOOK_SECRET = "whsec_..."
   ```

**Test the webhook:**
```bash
curl -X POST https://yourdomain.com/webhooks/clerk \
  -H "Content-Type: application/json" \
  -d '{"type":"user.created","data":{"id":"test"}}'
# Should return: {"received":true}
```

**IMPORTANT: Webhook Behavior**

The `user.created` event **only fires for NEW Clerk account signups** - users who just created their Clerk account for the first time. It does NOT fire when:
- An existing Clerk user signs into your app for the first time
- A user creates a new subdomain/tenant

This means your user count in the admin dashboard may not reflect all active users. To track actual subdomain usage, the template includes a `TenantRegistration` component that calls `/api/tenants/register` when a user visits their subdomain.

---

## Deployment Checklist

Use this checklist to ensure complete deployment:

### Pre-Deployment
- [ ] Have Clerk account with publishable key
- [ ] Have custom domain DNS pointed to Cloudflare
- [ ] Know your Clerk admin user ID(s)

### Cloudflare Setup
- [ ] Create KV namespace: `wrangler kv namespace create TENANTS`
- [ ] Update wrangler.toml with KV namespace ID
- [ ] Set secrets: `wrangler secret put CLERK_SECRET_KEY`
- [ ] Deploy worker: `wrangler deploy`
- [ ] **Verify routes in Dashboard** (add manually if needed)

### Clerk Setup
- [ ] Create webhook endpoint for `https://yourdomain.com/webhooks/clerk`
- [ ] Subscribe to `user.created` and `user.deleted` events
- [ ] Test webhook with curl
- [ ] Add authorized domains in Clerk settings

### Pages Setup
- [ ] Create Pages project
- [ ] Upload index.html
- [ ] Configure custom domain
- [ ] Verify Pages hostname matches `PAGES_HOSTNAME` in wrangler.toml

### Verification
- [ ] Root domain shows landing page
- [ ] Subdomain shows app with Clerk auth
- [ ] Admin subdomain shows dashboard (for admin users)
- [ ] API endpoints return JSON (test with curl)
- [ ] Tenant registration works on first subdomain visit
- [ ] Stats update after new signups

---

## Key Components

### Client-Side Routing

The unified template uses `getRouteInfo()` to detect subdomain and route:

```javascript
function getRouteInfo() {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  const params = new URLSearchParams(window.location.search);
  const testSubdomain = params.get('subdomain');

  // Handle localhost testing with ?subdomain= param
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    if (testSubdomain === 'admin') return { route: 'admin', subdomain: null };
    if (testSubdomain) return { route: 'tenant', subdomain: testSubdomain };
    return { route: 'landing', subdomain: null };
  }

  // Handle pages.dev testing (before custom domain is set up)
  if (hostname.endsWith('.pages.dev')) {
    if (testSubdomain === 'admin') return { route: 'admin', subdomain: null };
    if (testSubdomain) return { route: 'tenant', subdomain: testSubdomain };
    return { route: 'landing', subdomain: null };
  }

  // Production: detect subdomain from hostname
  if (parts.length <= 2 || parts[0] === 'www') {
    return { route: 'landing', subdomain: null };
  }
  if (parts[0] === 'admin') {
    return { route: 'admin', subdomain: null };
  }
  return { route: 'tenant', subdomain: parts[0] };
}
```

### TenantContext

Provides database scoping for tenant apps:

```javascript
const TenantContext = createContext(null);

function TenantProvider({ children }) {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  const subdomain = parts.length > 2 ? parts[0] : null;
  const isRoot = !subdomain || subdomain === 'www' || subdomain === 'admin';
  const dbName = isRoot ? `${APP_NAME}-default` : `${APP_NAME}-${subdomain}`;

  return (
    <TenantContext.Provider value={{ subdomain, isRoot, dbName, appName: APP_NAME, domain: APP_DOMAIN }}>
      {children}
    </TenantContext.Provider>
  );
}
```

### SubscriptionGate with Admin Bypass

Admins can bypass subscription checks.

**SECURITY WARNING**: Do NOT add fallbacks like `|| ADMIN_USER_IDS.length === 0` to admin checks. An empty admin list means NO admin access, not "everyone is admin". The template is secure - do not modify the admin authorization logic.

```javascript
function SubscriptionGate({ children }) {
  const { has, isLoaded, userId } = useAuth();

  if (!isLoaded) {
    return <div>Loading...</div>;
  }

  // Admin bypass
  const isAdmin = ADMIN_USER_IDS.includes(userId);
  const hasSubscription = isAdmin ||
    has({ plan: 'pro' }) ||
    has({ plan: 'basic' }) ||
    has({ plan: 'monthly' }) ||
    has({ plan: 'yearly' }) ||
    has({ plan: 'starter' });

  if (!hasSubscription) {
    return <SubscriptionRequired />;
  }

  return children;
}
```

---

## Testing

Test different routes by adding `?subdomain=` parameter:

**Localhost:**
```
http://localhost:5500/index.html              → Landing page
http://localhost:5500/index.html?subdomain=test → Tenant app
http://localhost:5500/index.html?subdomain=admin → Admin dashboard
```

**Pages.dev (before custom domain):**
```
https://yourproject.pages.dev              → Landing page
https://yourproject.pages.dev?subdomain=test → Tenant app
https://yourproject.pages.dev?subdomain=admin → Admin dashboard
```

The `?subdomain=` parameter works on both localhost and pages.dev, allowing you to test all routes before configuring DNS.

---

## Import Map

The unified template uses pinned React 18 versions to prevent conflicts with Clerk:

```json
{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1?deps=react@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "use-fireproof": "https://esm.sh/use-fireproof@0.20.0-dev-preview-50?deps=react@18.3.1",
    "use-vibes": "https://esm.sh/use-vibes@0.18.9?deps=react@18.3.1"
  }
}
```

**IMPORTANT:**
- Clerk@5 defaults to React 19, which causes version conflicts. The `?deps=react@18.3.1` parameter pins React 18 for all packages.
- `@clerk/clerk-react` is imported directly via URL in the code (not via import map) because Babel standalone doesn't properly resolve bare specifiers from import maps.

---

## Data Flow

### How Tenants are Tracked

1. **User signs up** on landing page via Clerk
2. **User picks subdomain** in CheckoutFlow
3. **Subdomain saved** to user's `unsafeMetadata` in Clerk
4. **Admin dashboard** calls `/api/tenants` (Worker endpoint)
5. **Worker fetches** all Clerk users via Clerk Backend API
6. **Worker filters** users with `subdomain` in metadata
7. **Dashboard displays** tenant list with email, subdomain, plan

This approach uses Clerk as the single source of truth - no separate database to sync.

### API Endpoint

The Worker provides:

```
GET /api/tenants
→ Returns: { tenants: [{ id, subdomain, email, status, plan, imageUrl }] }
```

The admin dashboard fetches this endpoint and refreshes every 30 seconds.

---

## Troubleshooting

### "522 Connection Timed Out"
- DNS pointing to non-existent origin
- Check CNAME targets point to yourproject.pages.dev
- Ensure DNS records are proxied (orange cloud)

### "Unexpected token '<'" in console
- JSX not being transpiled by Babel
- Check that `<script type="text/babel" data-type="module">` is present
- Verify Babel standalone is loading

### "Cannot read properties of null (reading 'useEffect')"
- React version mismatch between packages
- Ensure import map uses pinned React 18 versions with `?deps=react@18.3.1`
- Clerk@5 defaults to React 19 - must pin with deps parameter

### "Subscription Required" loop
- Check that admin user ID is correct and in the `ADMIN_USER_IDS` array
- Verify Clerk Billing is set up with matching plan names
- Redeploy after updating the file

### Subdomains return 404
- Worker route not configured
- Add `*.yourdomain.com/*` route manually in Cloudflare Dashboard
- Go to Workers & Pages → [worker] → Settings → Domains & Routes

### API returns HTML instead of JSON
- Root domain API route missing
- Add `yourdomain.com/api/*` route manually (separate from wildcard route)
- Add `yourdomain.com/webhooks/*` route for Clerk webhooks

### Clerk not loading
- Add your domain to Clerk's authorized domains
- Check publishable key is correct (not secret key)
- Verify ClerkProvider wraps the app

### "A record with that host already exists" (DNS)
- Cannot add CNAME while A record exists
- DELETE the existing A record first, then add CNAME

### Admin shows "Access Denied"
- User ID not in --admin-ids array
- Check Clerk Dashboard → Users → click user → copy User ID
- Re-run assembly with correct --admin-ids

### Admin dashboard shows 0 tenants
- Ensure the Worker is deployed and running
- Check KV namespace is created and ID is in wrangler.toml
- Verify webhook route is configured
- Test endpoint: `curl https://yourdomain.com/api/tenants`

### API returns "CLERK_SECRET_KEY not configured"
- Set the secret via `wrangler secret put CLERK_SECRET_KEY`
- Or add it in Cloudflare dashboard under Worker Settings → Variables

### Database not isolated
- Verify `useTenant()` is used in the App component
- Check `useFireproof(dbName)` uses the tenant database name

### CORS errors on API calls
- Static `Access-Control-Allow-Origin: *` doesn't work with credentials
- The worker now reflects the requesting origin dynamically
- If you see CORS errors, redeploy the worker with the latest generated code

### Secrets set incorrectly
- Common mistake: `wrangler secret put sk_test_xxx` (passing secret as name)
- Correct: `wrangler secret put CLERK_SECRET_KEY` (then paste value when prompted)
- The command prompts for the value, don't pass it as an argument

### Tenant count shows 0 but users exist
- `user.created` webhook only fires for NEW Clerk signups
- Existing Clerk users don't trigger the webhook
- Tenant registration (via `/api/tenants/register`) tracks actual subdomain visits
- Check if TenantRegistration component is working in browser dev tools
