---
name: cloudflare
description: Self-contained deploy automation — invoke directly, do not decompose. Deploys a Vibes app to Cloudflare Workers with subdomain registry. Uses KV for storage and native Web Crypto for JWT verification.
license: MIT
allowed-tools: Bash, Read, Glob, AskUserQuestion, Write
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:cloudflare". Do not decompose the steps below into separate plan tasks.

```
  ╔═══════════════════════════════════════════════╗
  ║   ☁️  CLOUDFLARE WORKERS DEPLOY               ║
  ║   KV Registry · JWT Auth · Edge Functions     ║
  ╚═══════════════════════════════════════════════╝
```

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
npx wrangler secret put OIDC_PEM_PUBLIC_KEY
```

### Automatic Connect Deployment

On first deploy, the script automatically provisions a paired Fireproof Connect
instance via alchemy. This includes: R2 bucket, D1 databases, cloud backend
Worker (blob ops + WebSocket rooms), and dashboard Worker.

Subsequent deploys skip Connect and only update the app Worker.

App-Connect pairings are tracked in `~/.vibes/deployments.json`.

### Deploy Script

For deploying with static assets (index.html, bundles, assets):

```bash
node scripts/deploy-cloudflare.js --name myapp --file index.html --oidc-authority "https://studio.exe.xyz/auth"
```

The `--oidc-authority` flag fetches the PEM public key from the OIDC discovery endpoint and sets it as `OIDC_PEM_PUBLIC_KEY`. Without it, the Worker can't verify JWTs for authenticated endpoints like `/claim`.

This automatically:
- Copies index.html to worker's public/
- Copies bundles/*.js (fireproof-oidc-bridge.js)
- Copies assets/ directory (images, icons)
- Runs wrangler deploy

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/registry.json` | GET | Public registry read |
| `/check/:subdomain` | GET | Check subdomain availability |
| `/claim` | POST | Claim a subdomain (auth required) |
| `/api/ai/chat` | POST | AI proxy to OpenRouter (requires OPENROUTER_API_KEY) |

### KV Storage

The registry is stored in Cloudflare KV under the key `registry`. Schema:

```json
{
  "claims": { "subdomain": { "userId": "...", "claimedAt": "..." } },
  "reserved": ["admin", "api", "www"],
  "preallocated": {}
}
```

### Important: Custom Domain Required for Subdomains

Workers.dev domains only support one subdomain level for SSL. For multi-tenant
apps with subdomains (tenant.myapp.workers.dev), you MUST use a custom domain.

**Won't work:** `tenant.myapp.username.workers.dev` (SSL error)
**Will work:** `tenant.myapp.com` (with custom domain)

On workers.dev, use the `?subdomain=` query parameter for testing:
- `myapp.username.workers.dev` → landing page
- `myapp.username.workers.dev?subdomain=tenant` → tenant app
- `myapp.username.workers.dev?subdomain=admin` → admin dashboard

### Custom Domain Setup

1. **Add domain to Cloudflare** (get nameservers from Cloudflare DNS dashboard)
2. **Point registrar nameservers** to Cloudflare's assigned nameservers
3. **Delete conflicting DNS records** for the apex domain (A, AAAA, CNAME)
4. **Add Custom Domain** in Workers & Pages → your worker → Settings → Domains & Routes → Add → Custom Domain (apex: yourdomain.com)
5. **Add wildcard CNAME** in DNS: Name: `*`, Target: `<worker-name>.<username>.workers.dev` (Proxied: ON)
6. **Add Route** in Workers & Pages → your worker → Settings → Domains & Routes → Add → Route: `*.yourdomain.com/*`

After setup:
- `yourdomain.com` → landing page
- `tenant.yourdomain.com` → tenant app
- `admin.yourdomain.com` → admin dashboard

### Required Secrets

| Secret | Source | Purpose |
|--------|--------|---------|
| `OIDC_PEM_PUBLIC_KEY` | OIDC discovery endpoint (Pocket ID) | JWT signature verification |
| `PERMITTED_ORIGINS` | Your domains | JWT azp claim validation |
| `OPENROUTER_API_KEY` | OpenRouter dashboard | AI proxy for `useAI()` hook (optional) |

**Setting secrets:**
```bash
cd skills/cloudflare/worker
npx wrangler secret put OIDC_PEM_PUBLIC_KEY
# Paste the PEM key (-----BEGIN PUBLIC KEY----- ... -----END PUBLIC KEY-----)

npx wrangler secret put PERMITTED_ORIGINS
# Enter: https://yourdomain.com,https://*.yourdomain.com
```

**Getting OIDC_PEM_PUBLIC_KEY:**

1. Find your Pocket ID OIDC authority URL (e.g., `https://studio.exe.xyz/auth`)
2. Fetch OIDC discovery: `curl https://studio.exe.xyz/auth/.well-known/openid-configuration`
3. Get the JWKS URI from the response and fetch: `curl <jwks_uri>`
4. Convert JWK to PEM using Node.js:
```javascript
const crypto = require('crypto');
const jwk = { /* paste the key from jwks.json */ };
const pem = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
console.log(pem);
```

Note: The `--oidc-authority` flag on `deploy-cloudflare.js` handles this automatically.

### OIDC Callback URL

The deployed app's URL must be registered as an allowed callback/redirect URI in your Pocket ID OIDC client configuration. The OIDC bridge uses `window.location.origin + window.location.pathname` as the redirect URI.

For Cloudflare Workers deployments, register `https://{app-name}.{account}.workers.dev/` in the OIDC client. If your Pocket ID instance supports wildcard patterns, `https://*.{account}.workers.dev/` covers all apps.

Without this, auth will complete on Pocket ID but fail with "Invalid callback URL" when redirecting back.

### Deploy with --name Flag

Always use the `--name` flag to deploy to your app's worker:

```bash
node scripts/deploy-cloudflare.js --name myapp --file index.html
```

**Important:** The `--name` determines the worker URL. Without it, wrangler uses
the name from wrangler.toml (`vibes-registry`), not your app.

### AI Features

Apps using the `useAI()` hook call `/api/ai/chat` on the same origin. The worker proxies these requests to OpenRouter.

**Deploy with AI enabled:**

```bash
node scripts/deploy-cloudflare.js --name myapp --file index.html --oidc-authority "https://studio.exe.xyz/auth" --ai-key "sk-or-v1-your-key"
```

The `--ai-key` flag sets the `OPENROUTER_API_KEY` secret on the worker after deployment. Without it, `/api/ai/chat` returns `{"error": "AI not configured"}`.

**Manual setup:**

```bash
npx wrangler secret put OPENROUTER_API_KEY --name myapp
# Paste your OpenRouter API key
```

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `wrangler: command not found` | Wrangler not installed | `npm install -g wrangler` or use `npx wrangler` |
| KV namespace errors | Namespace doesn't exist or wrong ID | Run `npx wrangler kv namespace list` to verify |
| JWT verification fails (401) | Missing or wrong PEM key | Check `OIDC_PEM_PUBLIC_KEY` is set: `npx wrangler secret list --name <app>` |
| JWT azp mismatch (403) | Origins not configured | Set `PERMITTED_ORIGINS` to include your domain |
| 404 on subdomain URL | Workers.dev doesn't support nested subdomains | Set up a custom domain (see Custom Domain Setup above) |
| `/api/ai/chat` returns "AI not configured" | Missing OpenRouter key | Set `OPENROUTER_API_KEY` secret or redeploy with `--ai-key` |
| `wrangler deploy` auth error | Not logged in | Run `npx wrangler login` |
| Stale content after redeploy | Browser cache | Hard refresh (Cmd+Shift+R) or clear cache |

### What's Next?

After successful deployment, present these options:

AskUserQuestion:
  question: "Your app is deployed! What would you like to do next?"
  header: "Next steps"
  options:
    - label: "Set up custom domain"
      description: "Configure DNS for subdomain routing (required for multi-tenant)"
    - label: "Enable AI features"
      description: "Add OpenRouter API key for the useAI() hook"
    - label: "Add auth & SaaS features"
      description: "Transform into SaaS with /vibes:sell (OIDC auth via Pocket ID), then redeploy"
    - label: "Open in browser"
      description: "Visit the deployed URL to verify everything works"
