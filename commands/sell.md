---
description: Transform a Vibes app into a multi-tenant SaaS with Clerk auth and Stripe billing
---

# Sell - Transform to SaaS

Transform your Vibes app into a multi-tenant SaaS product with:

- **Subdomain-based tenancy** - Each customer gets their own subdomain (alice.yourdomain.com)
- **Clerk authentication** - Secure sign-in/sign-up with Clerk
- **Stripe billing** - Per-subdomain subscriptions via Clerk Billing
- **Landing page** - Marketing page with pricing and subdomain picker
- **Admin dashboard** - View and manage all tenants

## Prerequisites

Before running this command, you should have:

1. An existing Vibes app (`app.jsx`) generated with `/vibes:vibes`
2. A Clerk account (create free at [clerk.com](https://clerk.com))
3. A domain name you control

## What Gets Generated

| File | Purpose | Deployment |
|------|---------|------------|
| `app.html` | Tenant app with auth | `*.yourdomain.com` |
| `index.html` | Landing page with pricing | `yourdomain.com` |
| `admin.html` | Admin dashboard | `admin.yourdomain.com` |
| `SETUP.md` | Deployment guide | Reference only |

## Configuration Required

The skill will ask you for:

- **App name**: Used for database naming (e.g., "wedding-photos")
- **Domain**: Your root domain (e.g., "fantasy.wedding")
- **Pricing**: Monthly and yearly subscription prices
- **Clerk publishable key**: From Clerk Dashboard → API Keys

## After Generation

1. Configure Clerk Billing with Stripe
2. Set up wildcard DNS for your domain
3. Deploy to a static host (Cloudflare Pages, Netlify, Vercel)
4. Test the complete flow

See the generated `SETUP.md` for detailed instructions.
