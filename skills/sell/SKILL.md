---
name: sell
description: Transform a Vibes app into a multi-tenant SaaS with per-subdomain billing. Adds Clerk authentication, Stripe payments via Clerk Billing, and generates a marketing landing page.
---

**Display this ASCII art immediately when starting:**

```
 ██████  ███████ ██      ██
██       ██      ██      ██
 ██████  █████   ██      ██
      ██ ██      ██      ██
 ██████  ███████ ███████ ███████
```

# Sell - Transform Vibes to SaaS

Convert your Vibes app into a multi-tenant SaaS product with:
- Subdomain-based tenancy (alice.yourdomain.com)
- Clerk authentication + Clerk Billing (Stripe)
- Per-tenant Fireproof database isolation
- Marketing landing page with pricing
- Admin dashboard for tenant management

## Workflow Overview

1. **Detect** existing app (app.jsx or riff selection)
2. **Configure** domain, pricing, and Clerk keys
3. **Generate** tenant app, landing page, and admin dashboard
4. **Guide** through Clerk/Stripe/DNS setup

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

2. **Root Domain**
   - Example: "fantasy.wedding"
   - Subdomains will be: `alice.fantasy.wedding`

3. **Pricing** (monthly/yearly)
   - Example: $9/month, $89/year
   - Feature list for pricing cards

4. **Clerk Publishable Key**
   - From Clerk Dashboard → API Keys
   - Format: `pk_test_...` or `pk_live_...`

---

## Step 3: Generate Files

Create three JSX files and assemble into HTML:

### 3.1 tenant.jsx - Multi-Tenant App Wrapper

This wraps the original app with auth and tenant scoping:

```jsx
<code filename="tenant.jsx">
import React, { createContext, useContext, useState } from "react";
import { useFireproof } from "use-fireproof";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth
} from "@clerk/clerk-react";

// === Configuration (replaced during assembly) ===
const CLERK_PUBLISHABLE_KEY = "__CLERK_PUBLISHABLE_KEY__";
const APP_NAME = "__APP_NAME__";

// === Tenant Context ===
const TenantContext = createContext(null);

function useTenant() {
  const context = useContext(TenantContext);
  if (!context) throw new Error("useTenant must be used within TenantProvider");
  return context;
}

function TenantProvider({ children }) {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  const subdomain = parts.length > 2 ? parts[0] : null;
  const isRoot = !subdomain || subdomain === 'www' || subdomain === 'admin';
  const dbName = isRoot ? null : `${APP_NAME}-${subdomain}`;

  return (
    <TenantContext.Provider value={{ subdomain, isRoot, dbName }}>
      {children}
    </TenantContext.Provider>
  );
}

// === Subscription Gate ===
function SubscriptionRequired() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.95_0.02_250)] p-4">
      <div className="max-w-md text-center p-8 bg-white border-4 border-[#0f172a] shadow-[8px_8px_0px_#0f172a]">
        <h2 className="text-2xl font-bold mb-4">Subscription Required</h2>
        <p className="mb-6">Please subscribe to access this app.</p>
        <a
          href="/"
          className="inline-block px-6 py-3 bg-[oklch(0.6_0.2_145)] text-white font-bold border-4 border-[#0f172a] shadow-[4px_4px_0px_#0f172a]"
        >
          View Plans
        </a>
      </div>
    </div>
  );
}

function SubscriptionGate({ children }) {
  const { has, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-lg">Loading...</div>
      </div>
    );
  }

  // Check for any active subscription plan
  const hasSubscription = has({ plan: 'pro' }) || has({ plan: 'basic' }) || has({ plan: 'monthly' }) || has({ plan: 'yearly' });

  if (!hasSubscription) {
    return <SubscriptionRequired />;
  }

  return children;
}

// === Original App (embedded during assembly) ===
// __ORIGINAL_APP_CODE__

// === Main Tenant App ===
function TenantApp() {
  const { subdomain } = useTenant();

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      <TenantProvider>
        <SignedIn>
          <SubscriptionGate>
            <div className="relative">
              <div className="absolute top-4 right-4 z-50">
                <UserButton />
              </div>
              <App />
            </div>
          </SubscriptionGate>
        </SignedIn>
        <SignedOut>
          <div className="min-h-screen flex items-center justify-center bg-[oklch(0.95_0.02_250)] p-4">
            <div className="max-w-md text-center p-8 bg-white border-4 border-[#0f172a] shadow-[8px_8px_0px_#0f172a]">
              <h2 className="text-2xl font-bold mb-4">Sign In Required</h2>
              <p className="mb-6">Please sign in to access your {subdomain} workspace.</p>
              <div className="flex gap-4 justify-center">
                <SignInButton mode="modal">
                  <button className="px-6 py-3 bg-[#0f172a] text-white font-bold border-4 border-[#0f172a]">
                    Sign In
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="px-6 py-3 bg-white font-bold border-4 border-[#0f172a]">
                    Sign Up
                  </button>
                </SignUpButton>
              </div>
            </div>
          </div>
        </SignedOut>
      </TenantProvider>
    </ClerkProvider>
  );
}

export default TenantApp;
</code>
```

### 3.2 landing.jsx - Marketing Landing Page

```jsx
<code filename="landing.jsx">
import React, { useState, useEffect } from "react";
import { useFireproof } from "use-fireproof";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser
} from "@clerk/clerk-react";

// === Configuration (replaced during assembly) ===
const CLERK_PUBLISHABLE_KEY = "__CLERK_PUBLISHABLE_KEY__";
const APP_NAME = "__APP_NAME__";
const APP_DOMAIN = "__APP_DOMAIN__";
const MONTHLY_PRICE = "__MONTHLY_PRICE__";
const YEARLY_PRICE = "__YEARLY_PRICE__";
const FEATURES = __FEATURES__;

// === Subdomain Picker ===
function SubdomainPicker({ onSelect }) {
  const [subdomain, setSubdomain] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(null);
  const { useLiveQuery } = useFireproof(`${APP_NAME}-admin`);
  const { docs: tenants } = useLiveQuery('subdomain', { key: subdomain });

  useEffect(() => {
    if (subdomain.length >= 3) {
      setChecking(true);
      // Small delay to debounce
      const timer = setTimeout(() => {
        setAvailable(tenants.length === 0);
        setChecking(false);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setAvailable(null);
    }
  }, [subdomain, tenants]);

  const isValid = /^[a-z0-9-]+$/.test(subdomain) && subdomain.length >= 3;

  return (
    <div className="space-y-2">
      <label className="block font-bold">Choose your subdomain:</label>
      <div className="flex items-center gap-2 p-4 bg-[oklch(0.95_0.02_90)] border-4 border-[#0f172a]">
        <input
          type="text"
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="your-name"
          className="flex-1 px-4 py-2 border-2 border-[#0f172a] bg-white font-mono"
        />
        <span className="font-mono text-gray-600">.{APP_DOMAIN}</span>
      </div>

      {subdomain.length > 0 && (
        <div className="text-sm">
          {checking && <span className="text-gray-500">Checking availability...</span>}
          {!checking && available === true && isValid && (
            <span className="text-green-600 font-bold">Available!</span>
          )}
          {!checking && available === false && (
            <span className="text-red-600 font-bold">Already taken</span>
          )}
          {!isValid && subdomain.length > 0 && (
            <span className="text-orange-600">Use lowercase letters, numbers, and dashes (min 3 chars)</span>
          )}
        </div>
      )}

      {available && isValid && (
        <button
          onClick={() => onSelect(subdomain)}
          className="w-full px-6 py-3 bg-[oklch(0.6_0.2_145)] text-white font-bold border-4 border-[#0f172a] shadow-[4px_4px_0px_#0f172a] hover:shadow-[2px_2px_0px_#0f172a] transition-all"
        >
          Continue with {subdomain}.{APP_DOMAIN}
        </button>
      )}
    </div>
  );
}

// === Pricing Card ===
function PricingCard({ title, price, interval, features, popular, onSelect }) {
  return (
    <div className={`p-6 bg-white border-4 border-[#0f172a] ${popular ? 'shadow-[8px_8px_0px_oklch(0.6_0.2_145)]' : 'shadow-[6px_6px_0px_#0f172a]'}`}>
      {popular && (
        <div className="mb-4 -mt-6 -mx-6 px-4 py-2 bg-[oklch(0.6_0.2_145)] text-white text-center font-bold border-b-4 border-[#0f172a]">
          MOST POPULAR
        </div>
      )}
      <h3 className="text-2xl font-bold mb-2">{title}</h3>
      <div className="mb-4">
        <span className="text-4xl font-bold">{price}</span>
        <span className="text-gray-600">/{interval}</span>
      </div>
      <ul className="mb-6 space-y-2">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-green-600 font-bold">+</span>
            {feature}
          </li>
        ))}
      </ul>
      <button
        onClick={onSelect}
        className={`w-full px-6 py-3 font-bold border-4 border-[#0f172a] transition-all ${
          popular
            ? 'bg-[oklch(0.6_0.2_145)] text-white shadow-[4px_4px_0px_#0f172a] hover:shadow-[2px_2px_0px_#0f172a]'
            : 'bg-[oklch(0.95_0.02_90)] hover:bg-[oklch(0.9_0.02_90)]'
        }`}
      >
        Get Started
      </button>
    </div>
  );
}

// === Hero Section ===
function Hero() {
  return (
    <div className="text-center py-16 px-4">
      <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
        {APP_NAME.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      </h1>
      <p className="text-xl md:text-2xl text-gray-600 max-w-2xl mx-auto mb-8">
        Your own private workspace. Get started in seconds.
      </p>
    </div>
  );
}

// === Main Landing Page ===
function LandingPage() {
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedSubdomain, setSelectedSubdomain] = useState(null);
  const { database } = useFireproof(`${APP_NAME}-admin`);
  const { user } = useUser();

  // After signup and subdomain selection, register tenant
  const handleSubdomainSelect = async (subdomain) => {
    setSelectedSubdomain(subdomain);

    if (user) {
      // Register the tenant
      await database.put({
        _id: `tenant:${subdomain}`,
        type: 'tenant',
        subdomain,
        clerkUserId: user.id,
        createdAt: new Date().toISOString(),
        status: 'pending' // Will become 'active' after payment
      });

      // Redirect to Clerk Billing checkout
      // The user will be redirected to their subdomain after payment
      window.location.href = `https://${subdomain}.${APP_DOMAIN}`;
    }
  };

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      <div className="min-h-screen bg-[oklch(0.95_0.02_250)]">
        {/* Header */}
        <header className="flex justify-between items-center p-4 max-w-6xl mx-auto">
          <div className="font-bold text-xl">{APP_NAME}</div>
          <div>
            <SignedOut>
              <div className="flex gap-2">
                <SignInButton mode="modal">
                  <button className="px-4 py-2 font-bold">Sign In</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="px-4 py-2 bg-[#0f172a] text-white font-bold">
                    Get Started
                  </button>
                </SignUpButton>
              </div>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </header>

        <Hero />

        {/* Pricing */}
        <section id="pricing" className="py-16 px-4 max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Simple Pricing</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <PricingCard
              title="Monthly"
              price={MONTHLY_PRICE}
              interval="month"
              features={FEATURES}
              onSelect={() => setSelectedPlan('monthly')}
            />
            <PricingCard
              title="Yearly"
              price={YEARLY_PRICE}
              interval="year"
              features={[...FEATURES, "2 months free!"]}
              popular={true}
              onSelect={() => setSelectedPlan('yearly')}
            />
          </div>
        </section>

        {/* Subdomain Picker (shown after plan selection) */}
        {selectedPlan && (
          <section className="py-16 px-4 max-w-xl mx-auto">
            <div className="p-8 bg-white border-4 border-[#0f172a] shadow-[8px_8px_0px_#0f172a]">
              <h3 className="text-2xl font-bold mb-6">Almost there!</h3>
              <SignedOut>
                <p className="mb-6">Create an account to claim your subdomain:</p>
                <SignUpButton mode="modal">
                  <button className="w-full px-6 py-3 bg-[#0f172a] text-white font-bold border-4 border-[#0f172a]">
                    Create Account
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <SubdomainPicker onSelect={handleSubdomainSelect} />
              </SignedIn>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="py-8 px-4 text-center text-gray-600 border-t-4 border-[#0f172a] mt-16">
          <p>Made with Vibes DIY</p>
        </footer>
      </div>
    </ClerkProvider>
  );
}

export default LandingPage;
</code>
```

### 3.3 admin.jsx - Admin Dashboard

```jsx
<code filename="admin.jsx">
import React, { useState } from "react";
import { useFireproof } from "use-fireproof";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useAuth
} from "@clerk/clerk-react";

// === Configuration (replaced during assembly) ===
const CLERK_PUBLISHABLE_KEY = "__CLERK_PUBLISHABLE_KEY__";
const APP_NAME = "__APP_NAME__";
const APP_DOMAIN = "__APP_DOMAIN__";
const ADMIN_USER_IDS = __ADMIN_USER_IDS__; // Array of Clerk user IDs with admin access

// === Admin Gate ===
function AdminGate({ children }) {
  const { userId, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-lg">Loading...</div>
      </div>
    );
  }

  if (!ADMIN_USER_IDS.includes(userId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[oklch(0.95_0.02_250)]">
        <div className="p-8 bg-white border-4 border-[#0f172a] shadow-[8px_8px_0px_#0f172a] text-center">
          <h2 className="text-2xl font-bold mb-4">Access Denied</h2>
          <p>You don't have admin access to this dashboard.</p>
        </div>
      </div>
    );
  }

  return children;
}

// === Stats Card ===
function StatsCard({ label, value, color }) {
  return (
    <div className={`p-6 bg-white border-4 border-[#0f172a] shadow-[4px_4px_0px_${color}]`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-gray-600">{label}</div>
    </div>
  );
}

// === Tenant Row ===
function TenantRow({ tenant }) {
  const statusColors = {
    active: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    canceled: 'bg-red-100 text-red-800'
  };

  return (
    <tr className="border-b-2 border-[#0f172a]">
      <td className="p-4 font-mono">
        <a
          href={`https://${tenant.subdomain}.${APP_DOMAIN}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {tenant.subdomain}.{APP_DOMAIN}
        </a>
      </td>
      <td className="p-4">
        <span className={`px-3 py-1 text-sm font-bold ${statusColors[tenant.status] || 'bg-gray-100'}`}>
          {tenant.status}
        </span>
      </td>
      <td className="p-4 text-gray-600">
        {new Date(tenant.createdAt).toLocaleDateString()}
      </td>
      <td className="p-4 font-mono text-sm text-gray-500">
        {tenant.clerkUserId}
      </td>
    </tr>
  );
}

// === Admin Dashboard ===
function AdminDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const { useLiveQuery } = useFireproof(`${APP_NAME}-admin`);
  const { docs: allTenants } = useLiveQuery('type', { key: 'tenant' });

  // Filter tenants by search
  const tenants = allTenants.filter(t =>
    t.subdomain?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Stats
  const activeCount = allTenants.filter(t => t.status === 'active').length;
  const pendingCount = allTenants.filter(t => t.status === 'pending').length;
  const canceledCount = allTenants.filter(t => t.status === 'canceled').length;

  return (
    <div className="min-h-screen bg-[oklch(0.95_0.02_250)]">
      {/* Header */}
      <header className="flex justify-between items-center p-4 bg-[#0f172a] text-white">
        <div className="font-bold text-xl">{APP_NAME} Admin</div>
        <UserButton />
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatsCard label="Total Tenants" value={allTenants.length} color="#0f172a" />
          <StatsCard label="Active" value={activeCount} color="oklch(0.6_0.2_145)" />
          <StatsCard label="Pending" value={pendingCount} color="oklch(0.7_0.2_90)" />
          <StatsCard label="Canceled" value={canceledCount} color="oklch(0.6_0.2_30)" />
        </div>

        {/* Tenants Table */}
        <div className="bg-white border-4 border-[#0f172a] shadow-[6px_6px_0px_#0f172a]">
          <div className="p-4 border-b-4 border-[#0f172a]">
            <input
              type="text"
              placeholder="Search tenants..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border-2 border-[#0f172a]"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[oklch(0.95_0.02_90)]">
                <tr className="border-b-4 border-[#0f172a]">
                  <th className="p-4 text-left font-bold">Subdomain</th>
                  <th className="p-4 text-left font-bold">Status</th>
                  <th className="p-4 text-left font-bold">Created</th>
                  <th className="p-4 text-left font-bold">User ID</th>
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-gray-500">
                      No tenants found
                    </td>
                  </tr>
                ) : (
                  tenants.map(tenant => (
                    <TenantRow key={tenant._id} tenant={tenant} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

// === Main Admin App ===
function AdminApp() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      <SignedIn>
        <AdminGate>
          <AdminDashboard />
        </AdminGate>
      </SignedIn>
      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-[oklch(0.95_0.02_250)]">
          <div className="p-8 bg-white border-4 border-[#0f172a] shadow-[8px_8px_0px_#0f172a] text-center">
            <h2 className="text-2xl font-bold mb-4">Admin Sign In</h2>
            <p className="mb-6">Sign in to access the admin dashboard.</p>
            <SignInButton mode="modal">
              <button className="px-6 py-3 bg-[#0f172a] text-white font-bold border-4 border-[#0f172a]">
                Sign In
              </button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>
    </ClerkProvider>
  );
}

export default AdminApp;
</code>
```

---

## Step 4: Assembly

After generating the JSX files, assemble them into HTML:

```bash
# Assemble tenant app
node ${PLUGIN_DIR}/scripts/assemble-sell.js tenant.jsx app.html \
  --clerk-key "pk_test_xxx" \
  --app-name "wedding-photos" \
  --domain "fantasy.wedding"

# Assemble landing page
node ${PLUGIN_DIR}/scripts/assemble-sell.js landing.jsx index.html \
  --clerk-key "pk_test_xxx" \
  --app-name "wedding-photos" \
  --domain "fantasy.wedding" \
  --monthly-price "$9" \
  --yearly-price "$89" \
  --features '["Unlimited photos","Private sharing","Custom subdomain"]'

# Assemble admin dashboard
node ${PLUGIN_DIR}/scripts/assemble-sell.js admin.jsx admin.html \
  --clerk-key "pk_test_xxx" \
  --app-name "wedding-photos" \
  --domain "fantasy.wedding" \
  --admin-ids '["user_xxx"]'
```

Tell the user:
> "I've generated three files: `app.html` (tenant app), `index.html` (landing page), and `admin.html` (admin dashboard). Deploy all three to your static host."

---

## Step 5: Generate Setup Guide

Create a `SETUP.md` file with deployment instructions:

```markdown
# Deployment Guide for {APP_NAME}

## 1. Clerk Setup

1. Go to [clerk.com](https://clerk.com) and create an account
2. Create a new application
3. Go to **API Keys** and copy your **Publishable Key**
4. Enable **Clerk Billing**:
   - Go to Billing → Connect Stripe
   - Create a Stripe account or connect existing
   - Create a product with "monthly" and "yearly" prices
   - Note the plan identifiers (e.g., "pro", "basic")

## 2. Update Configuration

Open each HTML file and replace the placeholder values:
- `__CLERK_PUBLISHABLE_KEY__` → Your Clerk publishable key
- `__ADMIN_USER_IDS__` → Your Clerk user ID (find in Clerk Dashboard → Users)

## 3. DNS Setup

Add these DNS records to your domain:

| Type | Name | Value |
|------|------|-------|
| A | @ | [Your host IP or CNAME target] |
| A | * | [Same as above - wildcard] |
| CNAME | www | @ |

**Wildcard DNS** enables `*.yourdomain.com` to all point to the same server.

## 4. Deploy to Static Host

### Cloudflare Pages (Recommended)

1. Create a new Pages project
2. Upload your files:
   - `index.html` (landing page)
   - `app.html` (tenant app)
   - `admin.html` (admin dashboard)
3. Add custom domain with wildcard SSL

### Netlify

1. Create new site from folder
2. Upload files
3. Add custom domain
4. Enable wildcard subdomain handling

### Vercel

1. Create new project
2. Upload as static site
3. Configure domains

## 5. Configure Routing

Create a `_redirects` file (Netlify) or configure rules:

```
# Root domain → landing page
/  /index.html  200

# Admin subdomain → admin dashboard
# (configure in host's subdomain settings)
```

For subdomains, the same `app.html` is served to all `*.yourdomain.com` requests.

## 6. Test Your Setup

1. Visit `yourdomain.com` - should see landing page
2. Sign up and choose a subdomain
3. Visit `yoursubdomain.yourdomain.com` - should prompt for sign-in
4. Sign in and verify app loads with your tenant database
5. Visit `admin.yourdomain.com` - should show admin dashboard

## Troubleshooting

**"Clerk not loading"**: Check that your publishable key is correct and the domain is added to Clerk's allowed origins.

**"Subscription check failing"**: Ensure you've set up Clerk Billing with matching plan identifiers (pro, basic, monthly, yearly).

**"Wildcard not working"**: DNS propagation can take up to 48 hours. Use `dig *.yourdomain.com` to check.
```

---

## Import Map for Sell Templates

The sell templates require an extended import map with Clerk:

```json
{
  "imports": {
    "react": "https://esm.sh/react",
    "react-dom": "https://esm.sh/react-dom",
    "react-dom/client": "https://esm.sh/react-dom/client",
    "react/jsx-runtime": "https://esm.sh/react/jsx-runtime",
    "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
    "@clerk/clerk-react": "https://esm.sh/@clerk/clerk-react@latest?external=react,react-dom"
  }
}
```

---

## Common Issues

**Issue**: Multiple React instances causing hooks errors
**Fix**: Ensure `?external=react,react-dom` on all esm.sh imports

**Issue**: Clerk components not rendering
**Fix**: Verify ClerkProvider wraps the entire app and publishableKey is set

**Issue**: Subscription gate always blocking
**Fix**: Check plan names in `has({ plan: 'xxx' })` match Clerk Billing plans

**Issue**: Fireproof databases not isolated
**Fix**: Verify TenantProvider correctly extracts subdomain and passes to useFireproof
