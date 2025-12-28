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

---

## Workflow Overview

1. **Detect** existing app (app.jsx or riff selection)
2. **Configure** domain, pricing, and Clerk keys
3. **Generate** unified app with all routes
4. **Guide** through Cloudflare deployment

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

### 3.1 Update App for Tenant Context

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

### 3.2 Assemble Unified App

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

**After running the assembly script**, tell the user:
> "I've generated three files: `index.html`, `worker.js`, and `wrangler.toml`. Follow the deployment guide printed by the script."

**WARNING**: If the assembly script fails or isn't available, DO NOT attempt to write the HTML manually. The template is complex and contains critical security patterns. Ask the user to ensure the plugin is installed correctly.

---

## Step 4: Cloudflare Deployment

The assembly script prints a comprehensive deployment guide. Here's the summary:

### 4.1 Deploy to Cloudflare Pages

1. **Go to Cloudflare Dashboard** → Workers & Pages
2. **Create** → Pages → **Upload assets** (Direct Upload)
3. **Name your project** (e.g., "fantasywedding")
4. **Upload** the generated `index.html`
5. **Deploy** - note the `*.pages.dev` URL

**Test your Pages deployment immediately:**
```
https://yourproject.pages.dev              → Landing page
https://yourproject.pages.dev?subdomain=test → Tenant app
https://yourproject.pages.dev?subdomain=admin → Admin dashboard
```

The `?subdomain=` parameter works on pages.dev before you configure custom domains.

### 4.2 Create KV Namespace

The worker needs KV storage for tenant data:

```bash
wrangler kv namespace create TENANTS
```

Copy the namespace ID and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TENANTS"
id = "YOUR_KV_NAMESPACE_ID"  # ← paste ID here
```

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

### 4.4 Configure DNS (IMPORTANT - Order Matters!)

In Cloudflare Dashboard → DNS → Records:

1. **DELETE any existing A/AAAA record for @ (root domain)**
   - You cannot add CNAME if A record exists

2. **Add CNAME for root domain:**
   - Type: CNAME
   - Name: @
   - Target: yourproject.pages.dev
   - Proxy: ON (orange cloud)

3. **Add CNAME for wildcard:**
   - Type: CNAME
   - Name: *
   - Target: yourproject.pages.dev
   - Proxy: ON (orange cloud)

### 4.5 Add Custom Domain to Pages

1. Go to Workers & Pages → [your project] → **Custom domains**
2. Click **Set up a custom domain**
3. Enter: `yourdomain.com`
4. Follow prompts (DNS should already be configured)

### 4.6 Add Worker Routes (MANUAL - Routes May Not Apply Automatically!)

**IMPORTANT:** Routes in wrangler.toml often don't apply. Add them manually:

1. Go to Workers & Pages → [your worker] → Settings → Domains & Routes
2. Click **Add route** and add these THREE routes:

| Pattern | Zone |
|---------|------|
| `*.yourdomain.com/*` | yourdomain.com |
| `yourdomain.com/api/*` | yourdomain.com |
| `yourdomain.com/webhooks/*` | yourdomain.com |

All three routes are required:
- Wildcard handles subdomain routing
- /api/* handles admin dashboard API calls from root domain
- /webhooks/* handles Clerk webhook events

---

## Step 5: Clerk Setup

Provide these instructions to the user:

### 5.1 Create Clerk Application

1. Go to [clerk.com](https://clerk.com) and sign in
2. Create a new application
3. Copy the **Publishable Key**

### 5.2 Enable Clerk Billing

1. In Clerk Dashboard, go to **Billing**
2. Click **Connect Stripe**
3. Complete Stripe onboarding
4. Create subscription plans:
   - **pro** - $9/month
   - **yearly** - $89/year (or use plan names that match your `has()` checks)

### 5.3 Add Authorized Domains

1. Go to **Domains** in Clerk settings
2. Add your production domains:
   - `yourdomain.com`
   - `*.yourdomain.com` (if supported)
   - `yourproject.pages.dev`

### 5.4 Get Your Admin User ID

1. Sign up on your app
2. Go to Clerk Dashboard → **Users**
3. Click your user
4. Copy the **User ID** (e.g., `user_xxx`)
5. Add it to the `--admin-ids` array

### 5.5 Configure Clerk Webhooks (Required for User Tracking)

Set up webhooks so the admin dashboard can track users:

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
    "use-vibes": "https://esm.sh/use-vibes@0.18.9?deps=react@18.3.1",
    "@clerk/clerk-react": "https://esm.sh/@clerk/clerk-react@5?deps=react@18.3.1,react-dom@18.3.1"
  }
}
```

**IMPORTANT:** Clerk@5 defaults to React 19, which causes version conflicts. The `?deps=react@18.3.1` parameter pins React 18 for all packages.

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
