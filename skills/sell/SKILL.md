---
name: sell
description: Self-contained SaaS automation — invoke directly, do not decompose. Transforms a Vibes app into a multi-tenant SaaS with subdomain-based tenancy. Adds Clerk authentication, subscription gating, and generates a unified app with landing page, tenant routing, and admin dashboard.
license: MIT
allowed-tools: Read, Write, Bash, Glob, AskUserQuestion
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:sell". Do not decompose the steps below into separate plan tasks.

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

## Quick Navigation

- [Critical Rules](#-critical-rules---read-first-) - Read this first
- [Step 1: Pre-Flight Checks](#step-1-pre-flight-checks) - Verify prerequisites
- [Step 2: Clerk Configuration](#step-2-clerk-configuration-required) - Set up authentication (REQUIRED)
- [Step 3: App Configuration](#step-3-app-configuration) - Collect app settings
- [Step 4: Assembly](#step-4-assembly) - Build the unified app
- [Step 5: Deployment](#step-5-deployment) - Deploy to Cloudflare Workers
- [Step 6: Post-Deploy Verification](#step-6-post-deploy-verification) - Confirm everything works
- [Key Components](#key-components) - Routing, TenantContext, SubscriptionGate
- [Troubleshooting](#troubleshooting) - Common issues and fixes

---

> **Assembly: transform (strip)** — `assemble-sell.js` receives a vibes-generated app.jsx and adapts it for the sell template. It strips `import` statements, `export default`, React destructuring, and template constants — because the sell template already provides all of these. All dependencies (`React`, `useFireproofClerk`, `useTenant`, `useState`, etc.) are available as globals.

## ⛔ CRITICAL RULES - READ FIRST ⛔

**DO NOT generate code manually.** This skill uses pre-built scripts:

| Step | Script | What it does |
|------|--------|--------------|
| Assembly | `assemble-sell.js` | Generates unified index.html |
| Deploy | `deploy-cloudflare.js` | Deploys to Cloudflare Workers with registry |

**Script location:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" ...
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" ...
```

**NEVER do these manually:**
- ❌ Write HTML/JSX for landing page, tenant app, or admin dashboard
- ❌ Generate routing logic or authentication code
- ❌ Deploy without `--clerk-key`

**ALWAYS do these:**
- ✅ Complete pre-flight checks before starting
- ✅ Collect ALL Clerk credentials BEFORE app configuration
- ✅ Run `assemble-sell.js` to generate the unified app
- ✅ Deploy with ALL required flags

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

### Terminal or Editor UI?

Detect whether you're running in a terminal (Claude Code CLI, Codex) or an editor (Cursor, Windsurf, VS Code with Copilot). **Terminal agents** use `AskUserQuestion` for all input. **Editor agents** present requirements as a checklist comment, wait for user edits, then proceed. See the vibes skill for the full detection and interaction pattern.

## Step 1: Pre-Flight Checks

**Before starting, verify these prerequisites. STOP if any check fails.**

### 1.1 Check for Fireproof Connect

```bash
cat .env 2>/dev/null | grep VITE_API_URL || echo "NOT_FOUND"
```

**If `NOT_FOUND`:** Run `/vibes:connect` first.
**STOP HERE** if Connect is not configured.

### 1.2 Detect Existing App

```bash
ls -la app.jsx 2>/dev/null || echo "NOT_FOUND"
```

**If output shows `NOT_FOUND`:**

Check for riff directories:
```bash
ls -d riff-* 2>/dev/null
```

**Decision tree:**
- Found `app.jsx` → Proceed to Step 2
- Found multiple `riff-*/app.jsx` → Ask user to select one, then copy to `app.jsx`
- Found nothing → Tell user to run `/vibes:vibes` first

**STOP HERE** if no app exists. The sell skill transforms existing apps.

### 1.3 Pre-Flight Summary

After both checks pass, confirm:
> "Pre-flight checks passed:
> - ✓ Fireproof Connect configured (.env found)
> - ✓ App found (app.jsx)
>
> Now let's configure Clerk authentication. This is required for multi-tenant SaaS."

---

## Step 2: Clerk Configuration (REQUIRED)

**These credentials are REQUIRED. Do not proceed without them.**

### 2.1 Clerk Dashboard Setup Instructions

Before collecting credentials, the user must set up Clerk. Present these instructions:

> **Clerk Setup Required**
>
> Before we continue, you need to configure Clerk authentication:
>
> 1. **Create a Clerk Application** at [clerk.com](https://clerk.com) — choose "Email + Passkey" authentication
> 2. **Configure Email Settings** — enable email signup with verification, and **set "Require email address" to OFF** (signup fails otherwise)
> 3. **Configure Passkey Settings** — enable sign-in with passkey, autofill, passkey button, and add-passkey-to-account
>
> See [CLERK-SETUP.md](./CLERK-SETUP.md) for the complete settings tables and step-by-step instructions.
>
> **When you're ready, I'll collect your Clerk credentials.**

### 2.2 Collect App Name (Needed for Webhook URL)

The webhook endpoint URL requires the app name. Collect it now so we can give the user the exact URL.

Use AskUserQuestion:
```
Question: "What should we call this app?"
Header: "App Name"
Options: Provide 2 suggestions based on context + user enters via "Other"
Description: "Used for database naming and deployment URL (e.g., 'wedding-photos')"
multiSelect: false
```

Store as `appName` (URL-safe slug: lowercase, hyphens, no special chars).

Now resolve the Cloudflare Workers URL so the webhook step has the real domain:

```bash
node "{pluginRoot}/scripts/lib/resolve-workers-url.js" --name "{appName}"
```

The script outputs the full URL, e.g., `wedding-photos.marcus-e.workers.dev`. Store this as `domain`.

**Fallback**: If the script fails (e.g., wrangler not authenticated), ask the user:

```
Question: "What's your Cloudflare Workers subdomain? (Run `npx wrangler whoami` to find your account name)"
Header: "CF subdomain"
Options:
- Label: "Let me check"
  Description: "I'll run wrangler whoami and tell you"
- Label: "I know it"
  Description: "I'll type my subdomain (e.g., marcus-e)"
multiSelect: false
```

Then construct: `{appName}.{subdomain}.workers.dev` and store as `domain`.

The user can configure a custom domain later (see Step 5.2).

### 2.3 Create Webhook

Use AskUserQuestion:
```
Question: "Create a webhook in Clerk: Go to Webhooks > Add Endpoint. Set the URL to: https://{domain}/webhook — Subscribe to these events: user.created, user.deleted, subscription.deleted"
Header: "Webhook"
Options:
- Label: "Webhook created"
  Description: "I've added the endpoint and subscribed to the events"
- Label: "I need help"
  Description: "I'm having trouble finding the webhooks page"
multiSelect: false
```

If "I need help": walk them through navigating Clerk dashboard > Configure > Webhooks > Add Endpoint, making sure to repeat the URL `https://{domain}/webhook`.

### 2.4 Collect Clerk Credentials

Use AskUserQuestion with these 2 questions:

```
Question 1: "What's your Clerk Publishable Key?"
Header: "Clerk Key"
Options: User enters via "Other"
Description: "From Clerk Dashboard → API Keys. Starts with pk_test_ or pk_live_"

Question 2: "What's your Clerk Webhook Secret?"
Header: "Webhook"
Options: User enters via "Other"
Description: "From the webhook you just created — click the endpoint, copy the Signing Secret. Starts with whsec_"
```

### 2.5 Validation Gate

**Before proceeding, validate ALL credentials:**

| Credential | Valid Format | If Invalid |
|------------|--------------|------------|
| Publishable Key | Starts with `pk_test_` or `pk_live_` | Stop, ask for correct key |
| Webhook Secret | Starts with `whsec_` | Stop, guide to webhook creation |

**If ANY validation fails:** Stop and help user get the correct credential. Do not proceed to Step 3.

### 2.6 Clerk Configuration Complete

Confirm to the user:
> "Clerk credentials validated and saved:
> - ✓ Publishable Key: pk_test_... (saved for assembly and deployment)
> - ✓ Webhook Secret: whsec_... (saved for deployment)
>
> Now let's configure your app settings."

---

## Step 3: App Configuration

**Use AskUserQuestion to collect all config in 2 batches.**

### Batch 1: Core Identity

App name and deploy domain were already resolved in Step 2.2. Custom domains can be configured later (Step 5.2).

Use the AskUserQuestion tool with these 2 questions:

```
Question 1: "Do you want to require paid subscriptions?"
Header: "Billing"
Options: ["No - free access for all", "Yes - subscription required"]
Description: "Billing is configured in Clerk Dashboard → Billing"

Question 2: "Display title for your app?"
Header: "Title"
Options: Suggest based on app name + user enters via "Other"
Description: "Shown in headers and landing page"
```

### Batch 2: Customization

**When billing is enabled** (`billingMode === "required"`): These fields appear on a pricing section visible to potential customers before signup. Write them as marketing copy — benefit-driven, not technical.

Use the AskUserQuestion tool with these 3 questions:

```
Question 1: "Tagline for the landing page headline?"
Header: "Tagline"
Options: Generate 2 suggestions based on app context + user enters via "Other"
Description: "Bold headline text. Can include <br> for line breaks (e.g., 'SHARE YOUR DAY.<br>MAKE IT SPECIAL.'). When billing is on, this is the sales headline — make it benefit-driven."

Question 2: "Subtitle text below the tagline?"
Header: "Subtitle"
Options: Generate 2 suggestions based on app context + user enters via "Other"
Description: "Explanatory text below the headline (e.g., 'The easiest way to share wedding photos with guests.'). When billing is on, this is the value proposition — answer 'why should I pay?'"

Question 3: "What features should we highlight on the landing page?"
Header: "Features"
Options: User enters via "Other"
Description: "Comma-separated list (e.g., 'Photo sharing, Guest uploads, Live gallery'). When billing is on, these appear as a visual checklist on the pricing section. Each should be a compelling benefit statement, not technical jargon. Aim for 3-5 items."
```

### After Receiving Answers

1. Domain is `{domain}` (resolved in Step 2.2). Custom domains can be added post-deploy (Step 5.2).
2. Admin User IDs default to empty (configured after first deploy - see Step 6)
3. **Proceed immediately to Step 4 (Assembly)**

### Config Values Reference

| Config | Script Flag | Example |
|--------|-------------|---------|
| App Name | `--app-name` | `wedding-photos` |
| Domain | `--domain` | `myapp.marcus-e.workers.dev` |
| Billing | `--billing-mode` | `off` or `required` |
| Clerk Publishable Key | `--clerk-key` | `pk_test_xxx` |
| Title | `--app-title` | `Wedding Photos` |
| Tagline | `--tagline` | `SHARE YOUR DAY.<br>MAKE IT SPECIAL.` |
| Subtitle | `--subtitle` | `The easiest way to share wedding photos with guests.` |
| Features | `--features` | `'["Feature 1","Feature 2"]'` |
| Admin IDs | `--admin-ids` | `'["user_xxx"]'` (default: `'[]'`) |

---

## Step 4: Assembly

**CRITICAL**: You MUST use the assembly script. Do NOT generate your own HTML/JSX code.

### 4.1 Verify .env Exists

Before running assembly, verify the .env file exists:

```bash
test -f .env && echo "OK" || echo "MISSING"
```

**If MISSING:** Stop and run `/vibes:connect` first.

### 4.2 Update App for Tenant Context

The user's app needs to use `useTenant()` for database scoping. Check if their app has a hardcoded database name:

```jsx
// BEFORE: Hardcoded name
const { useLiveQuery } = useFireproofClerk("my-app");

// AFTER: Tenant-aware
const { dbName } = useTenant();
const { useLiveQuery } = useFireproofClerk(dbName);
```

If the app uses a hardcoded name, update it:
1. Find the `useFireproofClerk("...")` call
2. Add `const { dbName } = useTenant();` before it
3. Change to `useFireproofClerk(dbName)`

`useTenant()` is a **template global** (injected by AppWrapper in the sell template), NOT an importable module. Call it directly — do NOT write `import { useTenant } from ...` anywhere in app.jsx.

**Template-Provided Globals — do NOT redeclare these in app.jsx:**

| Category | Globals |
|----------|---------|
| React | `React`, `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`, `createContext`, `useContext` |
| Template utilities | `useTenant`, `useMobile`, `useIsMobile` |
| UI components | `HiddenMenuWrapper`, `VibesSwitch`, `VibesButton`, `VibesPanel`, `BrutalistCard`, `LabelContainer`, `AuthScreen` |
| Color constants | `BLUE`, `RED`, `YELLOW`, `GRAY` |

Do NOT destructure from React (e.g., `const { useState } = React;`) or import React hooks — they are already in scope from the template.

### 4.3 Run Assembly Script

Before running assembly, check the project `.env` for a cached admin user ID:

```bash
grep CLERK_ADMIN_USER_ID .env 2>/dev/null
```

**If found**, offer to include it (mask the middle, e.g., `user_37ici...ohcY`):

```
AskUserQuestion:
  Question: "Include stored admin user ID in this deploy? (user_37ici...ohcY)"
  Header: "Admin"
  Options:
  - Label: "Yes, include"
    Description: "Pass --admin-ids with the cached user ID"
  - Label: "No, skip admin"
    Description: "Deploy without admin access (can add later in Step 6)"
  - Label: "Enter different"
    Description: "I'll paste a different user ID"
```

If "Yes, include": pass `--admin-ids '["<user_id>"]'`. If "Enter different": collect new ID, save to `.env`, then pass it. If "No, skip admin": pass `--admin-ids '[]'`.

**If not found**: use `--admin-ids '[]'` (admin setup happens post-deploy in Step 6.4).

Run the assembly script with all collected values:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" app.jsx index.html \
  --clerk-key "pk_test_xxx" \
  --app-name "wedding-photos" \
  --app-title "Wedding Photos" \
  --domain "{domain}" \
  --tagline "SHARE YOUR DAY.<br>MAKE IT SPECIAL." \
  --subtitle "The easiest way to share wedding photos with guests." \
  --billing-mode "off" \
  --features '["Photo sharing","Guest uploads","Live gallery"]' \
  --admin-ids '[]'
```

### 4.4 Validation Gate: Check for Placeholders

After assembly, verify no config placeholders remain:

```bash
grep -o '__VITE_[A-Z_]*__' index.html | sort -u || echo "NO_PLACEHOLDERS"
```

**If any placeholders found:** The .env file is missing required values. Check:
- `VITE_CLERK_PUBLISHABLE_KEY` - must be set
- `VITE_API_URL` - must be set
- `VITE_CLOUD_URL` - optional but recommended

Fix the .env file and re-run assembly.

### 4.5 Customize Landing Page Theme (Optional)

The template uses neutral colors by default. To match the user's brand:

```css
:root {
  --landing-accent: #0f172a;        /* Primary button/text color */
  --landing-accent-hover: #1e293b;  /* Hover state */
}
```

**Examples based on prompt style:**
- Wedding app → `--landing-accent: #d4a574;` (warm gold)
- Tech startup → `--landing-accent: #6366f1;` (vibrant indigo)
- Health/wellness → `--landing-accent: #10b981;` (fresh green)

---

## Step 5: Deployment

**Deploy Target: Cloudflare Workers.** SaaS apps always deploy to Cloudflare Workers (not exe.dev). The KV registry and subdomain routing require the CF Worker runtime.

**Registry server credentials are REQUIRED for SaaS apps.**

### 5.1 Deploy to Cloudflare Workers

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
  --name wedding-photos \
  --file index.html \
  --clerk-key "pk_test_xxx" \
  --webhook-secret "whsec_xxx"
```

**Required Flags for SaaS:**
| Flag | Source | Purpose |
|------|--------|---------|
| `--clerk-key` | Clerk publishable key (pk_test_/pk_live_) | deploy-cloudflare.js auto-fetches PEM from JWKS endpoint |
| `--webhook-secret` | Clerk webhook signing secret | deploy-cloudflare.js sets it as a Wrangler secret |

**Without `--clerk-key`, the Worker won't be able to verify JWTs for subdomain claiming.**

### 5.2 DNS Configuration (For Custom Domains)

The app is immediately available at `{appName}.{subdomain}.workers.dev`. For a custom domain:

1. In the Cloudflare dashboard, go to **Workers & Pages** → your worker → **Settings** → **Domains & Routes**
2. Add a custom domain (e.g., `cosmicgarden.app`)
3. For wildcard subdomains (e.g., `*.cosmicgarden.app`), add a wildcard route

**Note:** Until a custom domain with wildcard SSL is configured, use the `?subdomain=` query parameter for tenant routing (e.g., `https://{domain}?subdomain=alice`).

### 5.3 Optional: AI Features

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
  --name wedding-photos \
  --file index.html \
  --clerk-key "pk_test_xxx" \
  --ai-key "sk-or-v1-your-provisioning-key"
```

### 5.4 Validation Gate: Verify Registry

After deployment, verify the registry is working:

```bash
curl -s https://{domain}/registry.json | head -c 100
```

**Expected output:** `{"claims":{},"reserved":["admin","api","www"]...`

**If you see HTML instead of JSON:**
- The Worker may not have deployed correctly
- Check `npx wrangler tail --name {appName}` for errors
- Verify `--clerk-key` was provided during deploy

---

## Step 6: Post-Deploy Verification

### 6.1 Test Landing Page

```bash
curl -s -o /dev/null -w "%{http_code}" https://{domain}
```

**Expected:** `200`

### 6.2 Test Tenant Routing

Open in browser: `https://{domain}?subdomain=test`

Should show the tenant app (may require sign-in).

### 6.3 Clerk Dashboard Checklist

Present this checklist to the user:

> **Clerk Dashboard Settings Checklist**
>
> Verify these settings in your Clerk Dashboard:
>
> **Domains** (Dashboard → Domains):
> - [ ] Add your deployment domain (e.g., `{domain}`)
> - [ ] If using custom domain, add that too
>
> **Webhook** (Dashboard → Configure → Webhooks):
> - [ ] Endpoint URL matches your deployment: `https://{domain}/webhook`
> - [ ] Events selected: `user.created`, `user.deleted`, `subscription.deleted`
>
> **If using billing** (Dashboard → Billing):
> - [ ] Stripe connected
> - [ ] Plans created with matching names: `pro`, `basic`, `monthly`, `yearly`, `starter`, or `free`

### 6.4 Billing Verification (if `--billing-mode required`)

If billing mode is "required", verify the billing flow works:

1. **Check landing page pricing**: Open `https://{domain}` and confirm the PricingTable is visible
2. **Test paywall**: Open `https://{domain}?subdomain=test`, sign in, and confirm non-subscribed users see the SubscriptionPaywall
3. **Test checkout**: Click a plan in the paywall, use test card `4242 4242 4242 4242` with any future expiry and any CVC
4. **Verify access**: After subscribing, confirm the user can access the tenant app
5. **Check webhook**: Cancel the subscription in Clerk Dashboard, then verify the subdomain is released in `/registry.json`

If any step fails, check the Troubleshooting section for billing-specific issues.

### 6.5 Admin Setup (After First Signup)

Guide the user through admin setup:

> **Set Up Admin Access**
>
> 1. Visit your app and sign up: `https://{domain}`
> 2. Complete the signup flow (email → verify → passkey)
> 3. Go to Clerk Dashboard → Users → click your user → copy User ID
> 4. Re-run assembly with admin access:
>
> ```bash
> node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell.js" app.jsx index.html \
>   --clerk-key "pk_test_xxx" \
>   --app-name "{appName}" \
>   --app-title "{appTitle}" \
>   --domain "{domain}" \
>   --admin-ids '["user_xxx"]' \
>   [... other options ...]
> ```
>
> 5. Re-deploy:
> ```bash
> node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
>   --name {appName} \
>   --file index.html \
>   --clerk-key "pk_test_xxx" \
>   --webhook-secret "whsec_xxx"
> ```

After collecting the user ID, save it to the project `.env`:
```bash
grep -q CLERK_ADMIN_USER_ID .env 2>/dev/null && \
  sed -i '' 's/^CLERK_ADMIN_USER_ID=.*/CLERK_ADMIN_USER_ID=<new>/' .env || \
  echo "CLERK_ADMIN_USER_ID=<new>" >> .env
```

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

  // Handle workers.dev (use ?subdomain= param, no wildcard SSL)
  if (hostname.endsWith('.workers.dev')) {
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

### SubscriptionGate

Wraps tenant content and enforces billing mode:

- **`off`**: Everyone gets free access after signing in
- **`required`**: Users must subscribe via Clerk Billing before accessing tenant content

Admins always bypass the subscription check.

**SECURITY WARNING**: Do NOT add fallbacks like `|| ADMIN_USER_IDS.length === 0` to admin checks. An empty admin list means NO admin access, not "everyone is admin".

### SubscriptionPaywall

Shown to authenticated users who do not have an active subscription (when `billingMode === "required"`). Displays a pricing table via Clerk's `<PricingTable />` component so users can subscribe without leaving the app.

### UpgradePrompt

Optional component shown inside the tenant app when a user's plan has limited features. Use this for soft upsell messaging (e.g., "Upgrade to Pro for unlimited exports"). Not shown when `billingMode === "off"`.

---

## Testing

Test different routes by adding `?subdomain=` parameter:

**Localhost:**
```
http://localhost:5500/index.html              → Landing page
http://localhost:5500/index.html?subdomain=test → Tenant app
http://localhost:5500/index.html?subdomain=admin → Admin dashboard
```

**Workers.dev (before custom domain):**
```
https://{domain}              → Landing page
https://{domain}?subdomain=test → Tenant app
https://{domain}?subdomain=admin → Admin dashboard
```

---

## Import Map

The unified template uses React 19 with `@necrodome/fireproof-clerk` for Clerk integration:

```json
{
  "imports": {
    "react": "https://esm.sh/stable/react@19.2.4",
    "react/jsx-runtime": "https://esm.sh/stable/react@19.2.4/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/stable/react@19.2.4/jsx-dev-runtime",
    "react-dom": "https://esm.sh/stable/react-dom@19.2.4",
    "react-dom/client": "https://esm.sh/stable/react-dom@19.2.4/client",
    "use-fireproof": "https://esm.sh/stable/@necrodome/fireproof-clerk@0.0.3?external=react,react-dom",
    "@fireproof/clerk": "https://esm.sh/stable/@necrodome/fireproof-clerk@0.0.3?external=react,react-dom"
  }
}
```

---

## Troubleshooting

### "Unexpected token '<'" in console
- JSX not being transpiled by Babel
- Check that `<script type="text/babel" data-type="module">` is present

### "Cannot read properties of null (reading 'useEffect')"
- React version mismatch between packages
- Ensure fireproof-clerk imports have `?external=react,react-dom`

### "Subscription Required" loop
- Check that admin user ID is correct and in the `ADMIN_USER_IDS` array
- Verify Clerk Billing is set up with matching plan names

### Clerk not loading / Passkey fails / "Verification incomplete" error
- See [CLERK-SETUP.md Troubleshooting](./CLERK-SETUP.md#troubleshooting) for detailed Clerk auth fixes
- Most common fix: set "Require email address" to **OFF** in Clerk Dashboard → Email settings

### Admin shows "Access Denied"
- User ID not in --admin-ids array
- Check Clerk Dashboard → Users → click user → copy User ID
- Re-run assembly with correct --admin-ids

### Database not isolated
- Verify `useTenant()` is used in the App component
- Check `useFireproofClerk(dbName)` uses the tenant database name

### Registry returns HTML instead of JSON
- Deploy was run without `--clerk-key` — re-deploy with it
- See also [CLERK-SETUP.md Troubleshooting](./CLERK-SETUP.md#troubleshooting) for registry fetch errors

### Assembly fails with ".env file not found"
- Fireproof Connect is not configured
- Run `/vibes:connect` first to set up your sync backend
- Then return to `/vibes:sell`

### PricingTable not showing on landing page
- Verify `--billing-mode required` was passed during assembly
- Check browser console for Clerk Billing errors
- Ensure at least one plan exists in Clerk Dashboard > Billing > Plans

### Paywall shows but checkout fails
- In dev mode, Clerk auto-connects to Stripe sandbox — no Stripe account needed
- Use test card `4242 4242 4242 4242` with any future expiry date and any 3-digit CVC
- If using production keys, ensure Stripe is connected in Clerk Dashboard > Billing > Stripe

### User subscribed but still sees paywall
- Clerk subscription webhooks may be delayed — wait 10-15 seconds and refresh
- Verify webhook endpoint URL matches: `https://{domain}/webhook`
- Subscription status is checked via JWT claims, not webhooks — verify Clerk Billing plan exists
- Check Worker logs: `npx wrangler tail --name {appName}`

### Subscription canceled but subdomain not released
- Verify webhook events include `subscription.deleted`
- Check webhook secret is set: `npx wrangler secret list --name {appName}`
- View Worker logs for webhook processing errors: `npx wrangler tail --name {appName}`

---

## What's Next?

After Step 6 verification completes, present options:

```
Question: "Your SaaS is deployed and verified! What would you like to do?"
Header: "Next"
Options:
- Label: "Set up admin access (Recommended)"
  Description: "Sign up on your app, get your user ID, and enable admin dashboard access."

- Label: "Customize landing page"
  Description: "Adjust colors, refine tagline, or update feature descriptions."

- Label: "I'm done for now"
  Description: "Your app is live at https://{domain}"
```
