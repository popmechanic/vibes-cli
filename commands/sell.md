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

A **single unified `index.html`** file that handles all routes via client-side subdomain detection:

| Route | Purpose |
|-------|---------|
| `yourdomain.com` | Landing page with pricing |
| `*.yourdomain.com` | Tenant app with auth |
| `admin.yourdomain.com` | Admin dashboard |

## Configuration Required

The skill will ask you for:

- **App name**: Used for database naming (e.g., "wedding-photos")
- **App title**: Display name (e.g., "Fantasy Wedding")
- **Domain**: Your root domain (e.g., "fantasy.wedding")
- **Pricing**: Monthly and yearly subscription prices
- **Clerk publishable key**: From Clerk Dashboard → API Keys
- **Admin user IDs**: Clerk user IDs for admin bypass

## Deployment

Deploy to **Cloudflare Pages** with a Worker for wildcard subdomains:

1. Create a Pages project and upload `index.html`
2. Add your custom domain
3. Create a Worker to proxy `*.yourdomain.com` to Pages
4. Add the Worker route trigger

See the skill documentation for detailed Cloudflare deployment steps.
