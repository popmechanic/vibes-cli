---
name: exe
description: Deploy a Vibes app to exe.dev VM hosting. Uses nginx on persistent VMs with SSH automation. Supports client-side multi-tenancy via subdomain-based Fireproof database isolation.
---

# Deploy to exe.dev

Deploy your Vibes app to exe.dev, a VM hosting platform with persistent storage and HTTPS by default.

## Prerequisites

1. **SSH key** in `~/.ssh/` (id_ed25519, id_rsa, or id_ecdsa)
2. **exe.dev account** - run `ssh exe.dev` once to create your account and verify email
3. **Generated Vibes app** - an `index.html` file ready to deploy

## Quick Deploy

```bash
cd "${CLAUDE_PLUGIN_ROOT}/scripts" && [ -d node_modules ] || npm install
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" --name myapp --file index.html
```

## What It Does

1. **Creates VM** on exe.dev via SSH CLI
2. **Starts nginx** (pre-installed on exeuntu image)
3. **Uploads** your index.html to `/var/www/html/`
4. **Enables public access** at `https://myapp.exe.xyz`

## Multi-Tenant Apps

For apps that need tenant isolation (e.g., `alice.myapp.com`, `bob.myapp.com`):

### Client-Side Isolation

The same `index.html` serves all subdomains. JavaScript reads the hostname and uses the subdomain as a Fireproof database prefix:

```javascript
// In your app:
const hostname = window.location.hostname;
const subdomain = hostname.split('.')[0];
const dbName = `myapp-${subdomain}`;

// Each subdomain gets its own Fireproof database
const { database } = useFireproof(dbName);
```

### Custom Domain Setup

1. **Add `--domain` flag:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" --name myapp --domain myapp.com
   ```

2. **Configure wildcard DNS** at your DNS provider:
   ```
   *.myapp.com  CNAME  myapp.exe.xyz
   myapp.com    ALIAS  exe.xyz
   ```

3. **Set up wildcard SSL** on the VM:
   ```bash
   ssh myapp.runvm.dev
   sudo apt install certbot
   sudo certbot certonly --manual --preferred-challenges dns \
     -d "myapp.com" -d "*.myapp.com"
   ```

## CLI Options

| Option | Description |
|--------|-------------|
| `--name <vm>` | VM name (required) |
| `--file <path>` | HTML file to deploy (default: index.html) |
| `--domain <domain>` | Custom domain for wildcard setup |
| `--dry-run` | Show commands without executing |
| `--skip-verify` | Skip deployment verification |

## Redeployment

After making changes, redeploy with:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" --name myapp
```

## SSH Access

Access your VM directly:

```bash
ssh myapp.runvm.dev
```

## Architecture

```
exe.dev VM (exeuntu image)
├── nginx (serves all subdomains via server_name _)
└── /var/www/html/
    └── index.html  ← Your Vibes app
```

- **No server-side logic** - pure static hosting
- **Persistent disk** - survives restarts
- **HTTPS by default** - exe.dev handles SSL for *.exe.xyz
