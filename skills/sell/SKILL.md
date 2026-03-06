---
name: sell
description: Self-contained SaaS automation — invoke directly, do not decompose. Transforms a Vibes app into a multi-tenant SaaS with subdomain-based tenancy. Adds OIDC authentication (via Pocket ID), subscription gating, and generates a unified app with landing page, tenant routing, and admin dashboard.
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
- [Step 2: OIDC Configuration](#step-2-oidc-configuration-required) - Set up authentication (REQUIRED)
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
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
node "$VIBES_ROOT/scripts/assemble-sell.js" ...
node "$VIBES_ROOT/scripts/deploy-cloudflare.js" ...
```

**NEVER do these manually:**
- ❌ Write HTML/JSX for landing page, tenant app, or admin dashboard
- ❌ Generate routing logic or authentication code
- ❌ Deploy without `--oidc-authority`

**ALWAYS do these:**
- ✅ Complete pre-flight checks before starting
- ✅ Collect ALL OIDC credentials BEFORE app configuration
- ✅ Run `assemble-sell.js` to generate the unified app
- ✅ Deploy with ALL required flags

---

# Sell - Transform Vibes to SaaS

This skill uses `assemble-sell.js` to inject the user's app into a pre-built template. The template contains security checks, proper OIDC integration, and Fireproof patterns.

Convert your Vibes app into a multi-tenant SaaS product with:
- Subdomain-based tenancy (alice.yourdomain.com)
- OIDC authentication via Pocket ID (with passkeys)
- Subscription gating (Stripe billing is phase 2)
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

### 1.1 Check for OIDC Credentials

```bash
grep -q "VITE_OIDC_AUTHORITY=" .env 2>/dev/null && grep -q "VITE_OIDC_CLIENT_ID=" .env 2>/dev/null && echo "FOUND" || echo "NOT_FOUND"
```

**If `NOT_FOUND`:** OIDC credentials are required. Ask the user for their OIDC Authority URL and Client ID.
Connect is auto-provisioned on first deploy -- no manual setup needed.

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
> Now let's configure OIDC authentication (via Pocket ID). This is required for multi-tenant SaaS."

---

## Step 2: OIDC Configuration (REQUIRED)

**These credentials are REQUIRED. Do not proceed without them.**

### 2.1 Pocket ID Setup

Before collecting credentials, the user must have a Pocket ID instance configured for authentication. Present these instructions:

> **OIDC Setup Required**
>
> Before we continue, you need OIDC authentication configured via Pocket ID:
>
> 1. **Verify your Pocket ID instance** is running and accessible
> 2. **Check your .env** has `VITE_OIDC_AUTHORITY` pointing to your Pocket ID auth endpoint
> 3. **Verify OIDC Client ID** — from your Pocket ID configuration
>
> Connect is auto-provisioned on first deploy -- no manual setup needed.
>
> **When you're ready, I'll collect your OIDC credentials.**

### 2.2 Collect App Name (Needed for Deploy URL)

Collect the app name for deployment.

Use AskUserQuestion:
```
Question: "What should we call this app?"
Header: "App Name"
Options: Provide 2 suggestions based on context + user enters via "Other"
Description: "Used for database naming and deployment URL (e.g., 'wedding-photos')"
multiSelect: false
```

Store as `appName` (URL-safe slug: lowercase, hyphens, no special chars).

Now resolve the Cloudflare Workers URL:

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

### 2.3 Collect OIDC Credentials

Use AskUserQuestion with these 2 questions:

```
Question 1: "What's your OIDC Authority URL?"
Header: "OIDC Authority"
Options: User enters via "Other"
Description: "From your Connect Studio .env. Looks like https://studio.exe.xyz/auth"

Question 2: "What's your OIDC Client ID?"
Header: "OIDC Client"
Options: User enters via "Other"
Description: "From your Connect Studio's Pocket ID configuration"
```

### 2.4 Validation Gate

**Before proceeding, validate ALL credentials:**

| Credential | Valid Format | If Invalid |
|------------|--------------|------------|
| OIDC Authority | Valid HTTPS URL | Stop, ask for correct URL |
| OIDC Client ID | Non-empty string | Stop, guide to Pocket ID config |

**If ANY validation fails:** Stop and help user get the correct credential. Do not proceed to Step 3.

### 2.5 OIDC Configuration Complete

Confirm to the user:
> "OIDC credentials validated and saved:
> - ✓ Authority URL: https://studio.exe.xyz/auth (saved for assembly and deployment)
> - ✓ Client ID: (saved for assembly and deployment)
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
Description: "Billing via Stripe is planned for phase 2. Choose 'No' for now unless you have a custom Stripe integration."

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
| OIDC Authority | `--oidc-authority` | `https://studio.exe.xyz/auth` |
| OIDC Client ID | `--oidc-client-id` | `vibes-app-client` |
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

**If MISSING:** Ensure OIDC credentials are configured. Connect is auto-deployed with the app.

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
grep OIDC_ADMIN_USER_ID .env 2>/dev/null
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
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
node "$VIBES_ROOT/scripts/assemble-sell.js" app.jsx index.html \
  --oidc-authority "https://studio.exe.xyz/auth" \
  --oidc-client-id "vibes-app-client" \
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
- `VITE_OIDC_AUTHORITY` - must be set
- `VITE_OIDC_CLIENT_ID` - must be set
- `VITE_API_URL` / `VITE_CLOUD_URL` - auto-provisioned on first deploy; if missing, deploy with `/vibes:cloudflare` first

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

**Deploy Target: Cloudflare Workers.** SaaS apps always deploy to Cloudflare Workers. The KV registry and subdomain routing require the CF Worker runtime.

**Registry server credentials are REQUIRED for SaaS apps.**

### 5.1 Deploy to Cloudflare Workers

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
node "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
  --name wedding-photos \
  --file index.html \
  --oidc-authority "https://studio.exe.xyz/auth"
```

**Required Flags for SaaS:**
| Flag | Source | Purpose |
|------|--------|---------|
| `--oidc-authority` | OIDC authority URL (Pocket ID endpoint) | deploy-cloudflare.js fetches OIDC discovery for JWT verification |

**Without `--oidc-authority`, the Worker won't be able to verify JWTs for subdomain claiming.**

### 5.2 DNS Configuration (For Custom Domains)

The app is immediately available at `{appName}.{subdomain}.workers.dev`. For a custom domain:

1. In the Cloudflare dashboard, go to **Workers & Pages** → your worker → **Settings** → **Domains & Routes**
2. Add a custom domain (e.g., `cosmicgarden.app`)
3. For wildcard subdomains (e.g., `*.cosmicgarden.app`), add a wildcard route

**Note:** Until a custom domain with wildcard SSL is configured, use the `?subdomain=` query parameter for tenant routing (e.g., `https://{domain}?subdomain=alice`).

### 5.3 Optional: AI Features

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
node "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
  --name wedding-photos \
  --file index.html \
  --oidc-authority "https://studio.exe.xyz/auth" \
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
- Verify `--oidc-authority` was provided during deploy

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

### 6.3 Auth Verification Checklist

Present this checklist to the user:

> **Authentication Settings Checklist**
>
> Verify these settings for your deployment:
>
> **OIDC Configuration**:
> - [ ] `VITE_OIDC_AUTHORITY` points to your Pocket ID instance
> - [ ] `VITE_OIDC_CLIENT_ID` is correctly set
> - [ ] Your deployment domain is registered as an allowed redirect URI in Pocket ID
>
> **If using custom domain**:
> - [ ] Add the custom domain as an allowed origin in Pocket ID

### 6.4 Billing Verification (if `--billing-mode required`)

Note: Stripe billing integration is planned for phase 2. For now, billing mode "required" gates access but Stripe checkout is not yet wired up. Verify the paywall UI appears correctly:

1. **Check landing page**: Open `https://{domain}` and confirm the landing page is visible
2. **Test auth gate**: Open `https://{domain}?subdomain=test`, and confirm unauthenticated users see the auth screen
3. **Verify access**: After signing in, confirm the user can access the tenant app

### 6.5 Admin Setup (After First Signup)

Guide the user through admin setup:

> **Set Up Admin Access**
>
> 1. Visit your app and sign up: `https://{domain}`
> 2. Complete the signup flow (email or passkey via Pocket ID)
> 3. Find your User ID from the Pocket ID admin panel or application logs
> 4. Re-run assembly with admin access:
>
> ```bash
> VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
> node "$VIBES_ROOT/scripts/assemble-sell.js" app.jsx index.html \
>   --oidc-authority "https://studio.exe.xyz/auth" \
>   --oidc-client-id "vibes-app-client" \
>   --app-name "{appName}" \
>   --app-title "{appTitle}" \
>   --domain "{domain}" \
>   --admin-ids '["user_xxx"]' \
>   [... other options ...]
> ```
>
> 5. Re-deploy:
> ```bash
> VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
> node "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
>   --name {appName} \
>   --file index.html \
>   --oidc-authority "https://studio.exe.xyz/auth"
> ```

After collecting the user ID, save it to the project `.env`:
```bash
grep -q OIDC_ADMIN_USER_ID .env 2>/dev/null && \
  sed -i '' 's/^OIDC_ADMIN_USER_ID=.*/OIDC_ADMIN_USER_ID=<new>/' .env || \
  echo "OIDC_ADMIN_USER_ID=<new>" >> .env
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
- **`required`**: Users must subscribe before accessing tenant content (Stripe integration planned for phase 2)

Admins always bypass the subscription check.

**SECURITY WARNING**: Do NOT add fallbacks like `|| ADMIN_USER_IDS.length === 0` to admin checks. An empty admin list means NO admin access, not "everyone is admin".

### SubscriptionPaywall

Shown to authenticated users who do not have an active subscription (when `billingMode === "required"`). Stripe billing integration is planned for phase 2. Currently displays a placeholder paywall.

### UpgradePrompt

Optional component shown inside the tenant app when a user's plan has limited features. Use this for soft upsell messaging (e.g., "Upgrade to Pro for unlimited exports"). Not shown when `billingMode === "off"`. Full Stripe integration is planned for phase 2.

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

The unified template uses React 19 with `@necrodome/fireproof-clerk` (OIDC-compatible, backward-compat package name):

```json
{
  "imports": {
    "react": "https://esm.sh/stable/react@19.2.4",
    "react/jsx-runtime": "https://esm.sh/stable/react@19.2.4/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/stable/react@19.2.4/jsx-dev-runtime",
    "react-dom": "https://esm.sh/stable/react-dom@19.2.4",
    "react-dom/client": "https://esm.sh/stable/react-dom@19.2.4/client",
    "use-fireproof": "https://esm.sh/stable/@necrodome/fireproof-clerk@0.0.7?external=react,react-dom",
    "@fireproof/clerk": "https://esm.sh/stable/@necrodome/fireproof-clerk@0.0.7?external=react,react-dom"
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
- Ensure Fireproof OIDC imports have `?external=react,react-dom`

### "Subscription Required" loop
- Check that admin user ID is correct and in the `ADMIN_USER_IDS` array
- Stripe billing integration is phase 2 — set `--billing-mode off` if not needed

### Auth not loading / Passkey fails
- Verify `VITE_OIDC_AUTHORITY` points to a reachable Pocket ID instance
- Verify `VITE_OIDC_CLIENT_ID` is correctly configured
- Check that your deployment domain is registered as an allowed redirect URI in Pocket ID

### Admin shows "Access Denied"
- User ID not in --admin-ids array
- Check Pocket ID admin panel for the correct user ID
- Re-run assembly with correct --admin-ids

### Database not isolated
- Verify `useTenant()` is used in the App component
- Check `useFireproofClerk(dbName)` uses the tenant database name

### Registry returns HTML instead of JSON
- Deploy was run without `--oidc-authority` — re-deploy with it

### Assembly fails with ".env file not found"
- Fireproof Connect is not configured
- Connect is auto-deployed when you first deploy to Cloudflare
- Then return to `/vibes:sell`

### PricingTable not showing on landing page
- Verify `--billing-mode required` was passed during assembly
- Stripe billing integration is phase 2 — pricing table may show a placeholder

### User authenticated but still sees paywall
- If billing mode is "required", subscription checks may not be fully wired up yet (phase 2)
- Set `--billing-mode off` for immediate access after authentication

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
