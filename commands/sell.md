---
name: sell
description: Transform an app into multi-tenant SaaS with OIDC auth and billing
argument-hint: "[app.jsx]"
---

# Sell: Multi-Tenant SaaS Transformation

Transform a Vibes app into a full multi-tenant SaaS with OIDC authentication (Pocket ID), subdomain-based tenancy, and subscription billing.

## Usage

```bash
/vibes:sell app.jsx
/vibes:sell
```

## Arguments

- **app.jsx** (optional): Path to existing app to transform. If omitted, uses `app.jsx` in current directory.

## What It Creates

- **Landing page** with signup/signin flows
- **Subdomain routing** for tenant isolation
- **Passkey authentication** via Pocket ID (OIDC)
- **Subscription gating** with quota enforcement
- **Admin dashboard** for tenant management

## Architecture

```
yourapp.com          → Landing page
alice.yourapp.com    → Alice's tenant app
bob.yourapp.com      → Bob's tenant app
admin.yourapp.com    → Admin dashboard
```

## Prerequisites

Before using `/vibes:sell`:
1. Have a working Vibes app (from `/vibes:vibes`)
2. OIDC credentials (auto-provisioned on first Cloudflare deploy)

## Environment Variables

```bash
VITE_OIDC_AUTHORITY=https://<auto-provisioned>/auth
VITE_OIDC_CLIENT_ID=<auto-provisioned>
```

Connect is auto-provisioned on first deploy -- no manual setup needed.

## Related

- `/vibes:vibes` - Generate the initial app
- `/vibes:cloudflare` - Deploy the SaaS to Cloudflare Workers
