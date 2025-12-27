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

Run the assembly script to generate the unified index.html. Use the path relative to the skill directory:

```bash
# From the user's project directory, the script is at:
node ~/.claude/plugins/cache/vibes-diy/vibes/*/scripts/assemble-sell.js app.jsx index.html \
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

Note: The `*` glob matches any installed version. If multiple versions exist, use the highest numbered directory.

**After running the assembly script**, tell the user:
> "I've generated `index.html` - a unified file that handles the landing page, tenant apps, and admin dashboard. Deploy this single file to your host."

**WARNING**: If the assembly script fails or isn't available, DO NOT attempt to write the HTML manually. The template is complex and contains critical security patterns. Ask the user to ensure the plugin is installed correctly.

---

## Step 4: Cloudflare Deployment

### 4.1 Cloudflare Pages Setup

1. **Go to Cloudflare Dashboard** → Workers & Pages
2. **Create** → Pages → **Upload assets** (Direct Upload)
3. **Name your project** (e.g., "fantasywedding")
4. **Upload** the generated `index.html`
5. **Deploy** - note the `*.pages.dev` URL

### 4.2 Add Custom Domain

1. Go to your Pages project → **Custom domains**
2. Click **Set up a custom domain**
3. Enter your root domain (e.g., `fantasy.wedding`)
4. Cloudflare will prompt for DNS changes if needed

### 4.3 Deploy API Worker

The sell skill includes a Cloudflare Worker that:
1. Proxies wildcard subdomain requests to Pages
2. Provides `/api/tenants` endpoint for the admin dashboard

**Deploy the Worker:**

1. **Install Wrangler** (if not already installed):
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Navigate to the worker directory:**
   ```bash
   cd ${PLUGIN_DIR}/skills/sell/worker
   ```

3. **Set environment variables:**
   ```bash
   # Set your Clerk secret key
   wrangler secret put CLERK_SECRET_KEY
   # Enter: sk_test_xxx or sk_live_xxx
   ```

4. **Update `wrangler.toml`** with your config:
   ```toml
   name = "your-app-api"

   [vars]
   PAGES_DOMAIN = "your-project.pages.dev"
   ALLOWED_ORIGIN = "*"
   ```

   Note: `ALLOWED_ORIGIN = "*"` is required so the admin subdomain can call the API.

5. **Deploy:**
   ```bash
   wrangler deploy
   ```

**Alternative: Manual Worker Creation**

If you prefer to create the Worker in the Cloudflare dashboard:

1. **Go to** Workers & Pages → **Create** → **Create Worker**
2. Give it a name (e.g., "fantasy-wedding-api")
3. **Copy** the code from `${PLUGIN_DIR}/skills/sell/worker/index.js`
4. **Add environment variables** in Worker Settings:
   - `CLERK_SECRET_KEY` (encrypted) - Your Clerk secret key
   - `PAGES_DOMAIN` - Your Pages URL (e.g., `fantasywedding.pages.dev`)
   - `ALLOWED_ORIGIN` - Set to `*` (allows admin subdomain to call API)
5. Click **Deploy**

### 4.4 Add Worker Routes

You need **two routes** - one for subdomains and one for the root domain:

1. Go to your Worker → **Settings** → **Triggers**
2. Click **Add Route** and add:
   - Route: `*.yourdomain.com/*` (for subdomains)
   - Zone: `yourdomain.com`
3. Click **Add Route** again and add:
   - Route: `yourdomain.com/*` (for root domain API access)
   - Zone: `yourdomain.com`
4. **Save**

Both routes are required so the API works from both the landing page and admin dashboard.

### 4.5 DNS Configuration

In Cloudflare DNS, you should have:
- **A record**: `@` → `192.0.2.1` (proxied) - placeholder for root
- The Worker route handles `*.yourdomain.com/*`

The Pages custom domain handles the root domain, and the Worker proxies all subdomains to Pages.

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

---

## Key Components

### Client-Side Routing

The unified template uses `getRouteInfo()` to detect subdomain and route:

```javascript
function getRouteInfo() {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');

  // Handle localhost testing with ?subdomain= param
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const params = new URLSearchParams(window.location.search);
    const testSubdomain = params.get('subdomain');
    if (testSubdomain === 'admin') return { route: 'admin', subdomain: null };
    if (testSubdomain) return { route: 'tenant', subdomain: testSubdomain };
    return { route: 'landing', subdomain: null };
  }

  // Production routing
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

## Testing Locally

Test different routes by adding `?subdomain=` parameter:

```
http://localhost:5500/index.html              → Landing page
http://localhost:5500/index.html?subdomain=test → Tenant app
http://localhost:5500/index.html?subdomain=admin → Admin dashboard
```

---

## Import Map

The unified template includes these imports:

```json
{
  "imports": {
    "react": "https://esm.sh/react",
    "react-dom": "https://esm.sh/react-dom",
    "react-dom/client": "https://esm.sh/react-dom/client",
    "react/jsx-runtime": "https://esm.sh/react/jsx-runtime",
    "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
    "call-ai": "https://esm.sh/call-ai@0.18.9?external=react,react-dom",
    "use-vibes": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
    "@clerk/clerk-react": "https://esm.sh/@clerk/clerk-react@latest?external=react,react-dom"
  }
}
```

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

### "Subscription Required" loop
- Check that admin user ID is correct and in the `ADMIN_USER_IDS` array
- Verify Clerk Billing is set up with matching plan names
- Redeploy after updating the file

### Subdomains not working
- Ensure Worker route is `*.yourdomain.com/*`
- Check Worker code has correct Pages URL
- Verify DNS is proxied through Cloudflare (orange cloud)

### Clerk not loading
- Add your domain to Clerk's authorized domains
- Check publishable key is correct (not secret key)
- Verify ClerkProvider wraps the app

### Multiple React instances
- Ensure all esm.sh imports have `?external=react,react-dom`
- Don't mix different React versions

### Database not isolated
- Verify `useTenant()` is used in the App component
- Check `useFireproof(dbName)` uses the tenant database name

### Admin dashboard shows 0 tenants
- Ensure the Worker is deployed and running
- Check `CLERK_SECRET_KEY` is set correctly in Worker settings
- Verify the Worker route covers your domain
- Open browser console to see API errors
- Test endpoint directly: `curl https://yourdomain.com/api/tenants`

### API returns "CLERK_SECRET_KEY not configured"
- Set the secret via `wrangler secret put CLERK_SECRET_KEY`
- Or add it in Cloudflare dashboard under Worker Settings → Variables
