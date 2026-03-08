---
name: cloudflare
description: Self-contained deploy automation — invoke directly, do not decompose. Deploys a Vibes app to Cloudflare Workers via the Deploy API. Authenticates with Pocket ID.
license: MIT
allowed-tools: Bash, Read, Glob, AskUserQuestion, Write
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:cloudflare". Do not decompose the steps below into separate plan tasks.

```
  ╔═══════════════════════════════════════════════╗
  ║   ☁️  CLOUDFLARE WORKERS DEPLOY               ║
  ║   Deploy API · Pocket ID · Edge Functions      ║
  ╚═══════════════════════════════════════════════╝
```

## Deploy to Cloudflare

Deploy your Vibes app to Cloudflare Workers via the Deploy API.

### Prerequisites

1. **Assembled HTML file** (from `/vibes:vibes` or `/vibes:sell`)
2. **Pocket ID account** (browser login on first deploy)

No Cloudflare account or wrangler CLI needed — the Deploy API handles infrastructure.

### Quick Deploy

```bash
node scripts/deploy-cloudflare.js --name myapp --file index.html
```

On first run, a browser window opens for Pocket ID authentication. Tokens are cached for subsequent deploys.

### Deploy with AI enabled

```bash
node scripts/deploy-cloudflare.js --name myapp --file index.html --ai-key "sk-or-v1-your-key"
```

The `--ai-key` flag configures the OpenRouter API key for the `useAI()` hook. Without it, `/api/ai/chat` returns `{"error": "AI not configured"}`.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/registry.json` | GET | Public registry read |
| `/check/:subdomain` | GET | Check subdomain availability |
| `/claim` | POST | Claim a subdomain (auth required) |
| `/api/ai/chat` | POST | AI proxy to OpenRouter (requires AI key) |

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

### Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Browser doesn't open for auth | Headless environment | Copy the printed URL and open manually |
| Deploy API returns 401 | Expired or invalid token | Delete `~/.vibes/auth.json` and retry |
| 404 on subdomain URL | Workers.dev doesn't support nested subdomains | Set up a custom domain (see Custom Domain Setup above) |
| `/api/ai/chat` returns "AI not configured" | Missing OpenRouter key | Redeploy with `--ai-key` |
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
      description: "Transform into SaaS with /vibes:sell (Pocket ID auth), then redeploy"
    - label: "Open in browser"
      description: "Visit the deployed URL to verify everything works"
