---
name: sell
description: Transform an app into multi-tenant SaaS with Clerk auth and billing
argument-hint: "[app.jsx]"
---

# Sell: Multi-Tenant SaaS Transformation

Transform a Vibes app into a full multi-tenant SaaS with Clerk authentication, subdomain-based tenancy, and subscription billing.

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
- **Passkey authentication** via Clerk
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
2. Set up a Clerk application with passkey support
3. Configure environment variables

## Environment Variables

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=https://studio.exe.xyz/api
VITE_CLOUD_URL=fpcloud://studio.exe.xyz?protocol=wss
```

## Related

- `/vibes:vibes` - Generate the initial app
- `/vibes:connect` - Deploy the sync backend
- `/vibes:exe` - Deploy the SaaS to exe.dev
