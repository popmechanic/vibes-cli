---
name: cloudflare
description: Deploy a Vibes app to Cloudflare Workers
argument-hint: "[--name <app>]"
---

# Cloudflare: Deploy to Workers

Deploy a Vibes app to Cloudflare Workers with KV storage and JWT verification.

## Usage

```bash
/vibes:cloudflare --name myapp
/vibes:cloudflare
```

## Arguments

- **--name** (optional): Name for your Cloudflare Worker. If omitted, derived from the project directory.

## What It Does

1. Deploys your assembled `index.html` to a Cloudflare Worker
2. Configures KV storage for static assets
3. Sets up JWT verification for authenticated requests
4. Provisions a `*.workers.dev` URL

## Prerequisites

- Cloudflare account
- `wrangler` CLI installed and authenticated (`npx wrangler login`)
- An assembled `index.html` (from `node scripts/assemble.js`)

## Related

- `/vibes:exe` - Deploy to exe.dev instead
- `/vibes:connect` - Deploy the sync backend
- `/vibes:vibes` - Generate the app to deploy
