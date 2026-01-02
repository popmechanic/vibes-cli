---
name: exe-sell
description: Transform a Vibes app into a multi-tenant SaaS for exe.dev deployment. Client-side only version with Clerk auth - no backend server required.
---

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░░▒▓███████▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒░  ░▒▓██████▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
   ░▒▓██▓▒░  ░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░▒▓███████▓▒░

                    exe.dev EDITION
              (Client-Side Only • No Backend)
```

# Vibes exe-sell: SaaS for exe.dev

Transform any Vibes app into a multi-tenant SaaS deployed on exe.dev. This is a **client-side only** version - no backend server required.

## What This Creates

- **Landing page** with subdomain claim flow
- **Tenant subdomains** with database isolation (via Fireproof)
- **Clerk authentication** with passkeys
- **Admin dashboard** (config view, links to Clerk dashboard)
- **Subscription gating** via Clerk Billing

## What This Does NOT Include

Unlike the Cloudflare version (`/vibes:sell`):
- No backend API endpoints
- No webhook processing
- No centralized tenant list (uses Clerk metadata)
- Admin stats show "N/A" (use Clerk dashboard for analytics)

## Workflow

### Step 1: Gather Requirements

Ask the user for:

| Field | Required | Example |
|-------|----------|---------|
| `app.jsx` | Yes | The Vibes app to transform |
| `--clerk-key` | Yes | `pk_live_xxx` or `pk_test_xxx` |
| `--app-name` | Yes | `wedding-photos` |
| `--app-title` | No | `Wedding Photos` |
| `--domain` | Yes | `myapp.exe.xyz` |
| `--admin-ids` | Recommended | `["user_xxx"]` |
| `--features` | No | `["Feature 1", "Feature 2"]` |
| `--tagline` | No | "Your photos, your way" |

### Step 2: Assemble the App

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble-sell-exe.js" app.jsx index.html \
  --clerk-key pk_test_YOUR_KEY \
  --app-name wedding-photos \
  --app-title "Wedding Photos" \
  --domain wedding-photos.exe.xyz \
  --admin-ids '["user_xxx"]' \
  --features '["Photo sharing", "Guest uploads", "Live gallery"]' \
  --tagline "Share your special moments"
```

### Step 3: Deploy to exe.dev

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" --name wedding-photos --file index.html
```

Your app will be live at `https://wedding-photos.exe.xyz`

### Step 4: Set Up Clerk

1. Go to https://dashboard.clerk.com
2. Create/configure your application
3. Enable "Passkey" authentication
4. Add your production domain to allowed origins
5. Get your **production** publishable key
6. Re-assemble with the production key

### Step 5: Set Up Wildcard DNS (Optional)

For tenant subdomains to work, you need wildcard DNS:

1. Point your custom domain to the exe.dev VM
2. Add wildcard DNS: `*.yourdomain.com` → VM IP
3. Set up wildcard SSL via certbot DNS-01 challenge

Without this, use `?subdomain=` query params for testing.

## Testing Without Wildcard DNS

The template supports query parameter routing for testing:

```
https://myapp.exe.xyz/?subdomain=alice  → Tenant app for "alice"
https://myapp.exe.xyz/?subdomain=admin  → Admin dashboard
https://myapp.exe.xyz/                  → Landing page
```

## Architecture

```
exe.dev VM
└── nginx
    └── /var/www/html/index.html  ← Your unified SaaS app

Client-Side Only:
- Landing page (claim subdomain)
- OnboardingFlow (Clerk sign-up + metadata update)
- TenantApp (auth + subscription gate + your app)
- AdminApp (config view + Clerk dashboard links)

Data Storage:
- Tenant subdomain → Clerk user.unsafeMetadata.subdomain
- Tenant plan → Clerk user.unsafeMetadata.plan
- App data → Fireproof (per-tenant database)
```

## Comparison: exe-sell vs sell

| Feature | exe-sell (exe.dev) | sell (Cloudflare) |
|---------|-------------------|-------------------|
| Backend | None | Cloudflare Worker |
| Tenant storage | Clerk metadata | Worker KV |
| Webhooks | None | Clerk webhooks |
| Admin tenant list | Clerk dashboard | API endpoint |
| Admin stats | N/A (use Clerk) | Server-calculated |
| Complexity | Low | High |
| Setup time | ~10 minutes | ~30 minutes |

## When to Use exe-sell

Choose exe-sell when:
- You want the simplest possible deployment
- You don't need server-side analytics
- You're comfortable using Clerk's dashboard for user management
- You want to deploy to exe.dev

Choose the regular `/vibes:sell` when:
- You need server-side tenant tracking
- You want real-time webhook processing
- You need centralized admin analytics
- You're deploying to Cloudflare
