---
name: sell
description: Transform a Vibes app into a multi-tenant SaaS with Clerk auth and Clerk Billing
---

# Sell - Transform to SaaS

This command invokes the `/vibes:sell` skill to transform your Vibes app into a multi-tenant SaaS product.

## What You Get

- Subdomain-based tenancy (alice.yourdomain.com)
- Clerk authentication and billing
- Landing page with pricing
- Admin dashboard

## Prerequisites

1. An existing Vibes app (`app.jsx`) from `/vibes:vibes`
2. A Clerk account ([clerk.com](https://clerk.com))
3. A domain name you control

## Usage

Run `/vibes:sell` and provide when prompted:
- App name and title
- Your domain
- Pricing (monthly/yearly)
- Clerk publishable key
- Admin user IDs

The skill handles code generation, assembly, and deployment guidance.
