---
name: Sell Components & Troubleshooting
description: Client-side routing, TenantContext, SubscriptionGate internals, testing routes, import map, and troubleshooting guide for the sell template.
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

The unified template uses React 19 with the OIDC bridge for auth and TinyBase sync. The current authoritative import map (from `source-templates/base/template.html`):

!`bun scripts/lib/extract-import-map.js`

Note: TinyBase is loaded via the import map with `?external=react,react-dom` to prevent the React singleton problem.

---

## Troubleshooting

### "Unexpected token '<'" in console
- JSX not being transpiled by Babel
- Check that `<script type="text/babel" data-type="module">` is present

### "Cannot read properties of null (reading 'useEffect')"
- React version mismatch between packages
- Ensure TinyBase imports have `?external=react,react-dom`

### "Subscription Required" loop
- Check that admin user ID is correct and in the `ADMIN_USER_IDS` array
- Stripe billing integration is phase 2 — set `--billing-mode off` if not needed

### Auth not loading / Passkey fails
- Verify Pocket ID login completed successfully (check `~/.vibes/auth.json` exists)
- Delete `~/.vibes/auth.json` and retry to force re-authentication
- Check that your deployment domain is registered as an allowed redirect URI in Pocket ID

### Admin shows "Access Denied"
- User ID not in --admin-ids array
- Check Pocket ID admin panel for the correct user ID
- Re-run assembly with correct --admin-ids

### Data not isolated between tenants
- Verify `useTenant()` is used in the App component
- TinyBase uses rooms via Durable Objects for tenant isolation — ensure the tenant routing is correct

### Registry returns HTML instead of JSON
- The Worker may not have deployed correctly — redeploy with `deploy-cloudflare.js`

### Assembly fails
- Check that `app.jsx` exists in the working directory
- Auth is automatic — no `.env` credential setup needed

### PricingTable not showing on landing page
- Verify `--billing-mode required` was passed during assembly
- Stripe billing integration is phase 2 — pricing table may show a placeholder

### User authenticated but still sees paywall
- If billing mode is "required", subscription checks may not be fully wired up yet (phase 2)
- Set `--billing-mode off` for immediate access after authentication
