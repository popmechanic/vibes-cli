---
name: cloudflare
description: Deploy a Vibes app to Cloudflare Workers with subdomain registry. Uses KV for storage and native Web Crypto for JWT verification.
license: MIT
allowed-tools: Bash, Read, Glob, AskUserQuestion, Write
---

## Deploy to Cloudflare

Deploy your Vibes app to Cloudflare Workers with the subdomain registry.

### Prerequisites

1. **Cloudflare account** with Workers enabled
2. **Wrangler CLI** installed (`npm install -g wrangler`)
3. **KV namespace** created for registry storage

### Quick Deploy

```bash
cd skills/cloudflare/worker
npm install
wrangler deploy
```

### Environment Setup

Before deploying, set the required secrets:

```bash
cd skills/cloudflare/worker
npx wrangler secret put CLERK_PEM_PUBLIC_KEY
npx wrangler secret put CLERK_WEBHOOK_SECRET
```

### Deploy Script

For deploying with static assets (index.html, bundles, assets):

```bash
node scripts/deploy-cloudflare.js --name myapp --file index.html
```

This automatically:
- Copies index.html to worker's public/
- Copies bundles/*.js (fireproof-clerk-bundle.js workaround)
- Copies assets/ directory (images, icons)
- Runs wrangler deploy

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/registry.json` | GET | Public registry read |
| `/check/:subdomain` | GET | Check subdomain availability |
| `/claim` | POST | Claim a subdomain (auth required) |
| `/webhook` | POST | Clerk subscription webhooks |

### KV Storage

The registry is stored in Cloudflare KV under the key `registry`. Schema:

```json
{
  "claims": { "subdomain": { "userId": "...", "claimedAt": "..." } },
  "reserved": ["admin", "api", "www"],
  "preallocated": {},
  "quotas": { "userId": 3 }
}
```
