---
name: sell
description: Transform a Vibes app into a multi-tenant SaaS with subdomain-based tenancy. Adds Clerk authentication, subscription gating, and generates a unified app with landing page, tenant routing, and admin dashboard.
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

---

## ⛔ CRITICAL RULES - READ FIRST ⛔

**DO NOT generate code manually.** This skill uses pre-built scripts:

| Step | Script | What it does |
|------|--------|--------------|
| Assembly | `assemble-sell.js` | Generates unified index.html |

**Script location:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" ...
```

**NEVER do these manually:**
- ❌ Write HTML/JSX for landing page, tenant app, or admin dashboard
- ❌ Generate routing logic or authentication code

**ALWAYS do these:**
- ✅ Run `assemble-sell.js` to generate the unified app
- ✅ Use `/vibes:exe` to deploy after assembly

---

# Sell - Transform Vibes to SaaS

This skill uses `assemble-sell.js` to inject the user's app into a pre-built template. The template contains security checks, proper Clerk integration, and Fireproof patterns.

Convert your Vibes app into a multi-tenant SaaS product with:
- Subdomain-based tenancy (alice.yourdomain.com)
- Clerk authentication with passkeys
- Subscription gating via Clerk Billing
- Per-tenant Fireproof database isolation
- Marketing landing page
- Admin dashboard

## Architecture

The sell skill generates a **single index.html** file that handles all routes via client-side subdomain detection:

```
yourdomain.com          → Landing page
*.yourdomain.com        → Tenant app with auth
admin.yourdomain.com    → Admin dashboard
```

This approach simplifies deployment - you upload one file and it handles everything.

---

## Workflow Overview

1. **Detect** existing app (app.jsx or riff selection)
2. **Configure** domain, pricing, and Clerk keys
3. **Assemble** unified app (run assembly script)
4. **Deploy** with `/vibes:exe`

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
   - Example: "myapp.exe.xyz" or "fantasy.wedding"
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

**CRITICAL**: You MUST use the assembly script. Do NOT generate your own HTML/JSX code. The template has been carefully designed with proper security and Clerk integration that will break if you generate code manually.

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

Run the assembly script to generate the unified file:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" app.jsx index.html \
  --clerk-key "pk_test_xxx" \
  --app-name "wedding-photos" \
  --app-title "Fantasy Wedding" \
  --domain "myapp.exe.xyz" \
  --tagline "Share your wedding photos with guests" \
  --monthly-price "$9" \
  --yearly-price "$89" \
  --features '["Photo sharing","Guest uploads","Live gallery"]' \
  --admin-ids '["user_xxx"]'
```

**The assembly script generates:**
- `index.html` - Unified app (landing + tenant + admin)

**WARNING**: If the assembly script fails or isn't available, DO NOT attempt to write the HTML manually. The template is complex and contains critical security patterns. Ask the user to ensure the plugin is installed correctly.

### 3.4 Customize Landing Page Theme (Optional)

The template uses neutral colors by default. To match the user's brand or prompt style, customize the CSS variables in the generated `index.html`:

```css
:root {
  /* Landing page theming - customize these for brand */
  --landing-accent: #0f172a;        /* Primary button/text color */
  --landing-accent-hover: #1e293b;  /* Hover state */
}
```

**Examples based on prompt style:**
- Wedding app → `--landing-accent: #d4a574;` (warm gold)
- Tech startup → `--landing-accent: #6366f1;` (vibrant indigo)
- Health/wellness → `--landing-accent: #10b981;` (fresh green)
- Creative agency → `--landing-accent: #f43f5e;` (bold rose)

---

## Step 4: Deploy

After assembly, deploy with `/vibes:exe`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" --name wedding-photos --file index.html
```

Your app will be live at `https://wedding-photos.exe.xyz`

For custom domains with wildcard subdomains, see the exe.dev deployment guide.

---

## Step 5: Clerk Setup

**Read the complete setup guide:** [CLERK-SETUP.md](./CLERK-SETUP.md)

**Quick summary of steps:**
1. Create Clerk application at [clerk.com](https://clerk.com), copy Publishable Key
2. Enable Passkey authentication
3. Get admin user ID from Clerk Dashboard → Users
4. Enable Clerk Billing and create subscription plans (names must match `has({ plan: 'planname' })`)
5. Add your production domain to Clerk's allowed origins

**NO REBUILD REQUIRED**: Clerk setup is done in the Clerk Dashboard only. The app already has Clerk integration built in.

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

  // Handle exe.xyz testing (before custom domain is set up)
  if (hostname.endsWith('.exe.xyz')) {
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

function TenantProvider({ children, subdomain }) {
  const dbName = `${APP_NAME}-${subdomain}`;
  return (
    <TenantContext.Provider value={{ subdomain, dbName, appName: APP_NAME, domain: APP_DOMAIN }}>
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

**exe.xyz (before custom domain):**
```
https://myapp.exe.xyz              → Landing page
https://myapp.exe.xyz?subdomain=test → Tenant app
https://myapp.exe.xyz?subdomain=admin → Admin dashboard
```

The `?subdomain=` parameter works on both localhost and exe.xyz, allowing you to test all routes before configuring custom DNS.

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
    "use-fireproof": "https://esm.sh/use-vibes@0.18.9?deps=react@18.3.1",
    "use-vibes": "https://esm.sh/use-vibes@0.18.9?deps=react@18.3.1"
  }
}
```

**Note:** `use-fireproof` is aliased to `use-vibes` for compatibility. The stable version 0.18.9 is used instead of dev versions which have known bugs.

**IMPORTANT:**
- Clerk@5 defaults to React 19, which causes version conflicts. The `?deps=react@18.3.1` parameter pins React 18 for all packages.
- `@clerk/clerk-react` is imported directly via URL in the code (not via import map) because Babel standalone doesn't properly resolve bare specifiers from import maps.

---

## Troubleshooting

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

### Clerk not loading
- Add your domain to Clerk's authorized domains
- Check publishable key is correct (not secret key)
- Verify ClerkProvider wraps the app

### Admin shows "Access Denied"
- User ID not in --admin-ids array
- Check Clerk Dashboard → Users → click user → copy User ID
- Re-run assembly with correct --admin-ids

### Database not isolated
- Verify `useTenant()` is used in the App component
- Check `useFireproof(dbName)` uses the tenant database name
