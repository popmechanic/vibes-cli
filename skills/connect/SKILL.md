---
name: connect
description: Set up Fireproof sync backend with Clerk authentication on exe.dev. Run this before /vibes:vibes to enable authenticated cloud sync. Deploys Token API and Cloud sync services to exe.dev VM.
---

> **DEPRECATED:** Connect setup is now integrated into the main `/vibes:vibes` skill.
> When you run `/vibes:vibes`, it will ask if you want cloud sync and guide you through
> Connect setup automatically. This standalone skill remains for reference but should
> not be invoked directly.
>
> **What changed:**
> - `/vibes:vibes` now asks "Do you want cloud sync with user accounts?" at the start
> - If you say yes, it runs the full Connect setup (same as this skill did)
> - Apps auto-detect Connect at runtime - same code works in local or Connect mode
>
> **Migration:** Just run `/vibes:vibes` instead of `/vibes:connect` + `/vibes:vibes`

---

**Display this ASCII art immediately when starting:**

```
░▒▓███████▓▒░ ░▒▓██████▓▒░░▒▓███████▓▒░░▒▓███████▓▒░░▒▓████████▓▒░░▒▓██████▓▒░▒▓████████▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░        ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓██████▓▒░ ░▒▓█▓▒░        ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░        ░▒▓█▓▒░
░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░ ░▒▓█▓▒░
░▒▓███████▓▒░░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓████████▓▒░░▒▓██████▓▒░  ░▒▓█▓▒░
```

# Fireproof Connect Setup (exe.dev Deployment)

Set up a Fireproof sync backend with Clerk authentication on exe.dev. This deploys Docker services for:
- **Token API** (https://yourvm.exe.xyz/api) - Issues authenticated tokens for cloud sync
- **Cloud Backend** (wss://yourvm.exe.xyz/sync) - Real-time WebSocket sync

After setup, apps generated with `/vibes:vibes` will use `@fireproof/clerk` for authenticated sync tied to user accounts.

## Prerequisites

- An SSH key in ~/.ssh/ (ed25519, rsa, or ecdsa)
- An exe.dev account (run `ssh exe.dev` to create one)
- A Clerk account with an application configured

## Setup Process

### Step 1: Gather Clerk Credentials

Ask the user for their Clerk credentials using AskUserQuestion:

```
Questions:
1. Question: "What is your Clerk Publishable Key?"
   Header: "Clerk Key"
   Options:
   - Label: "I have it ready"
     Description: "Find it at: Clerk Dashboard → Configure → API Keys → Publishable Key (starts with pk_)"
   - Label: "I need to create a Clerk app first"
     Description: "Go to https://clerk.com to create an account and application"

2. Question: "What is your Clerk Secret Key?"
   Header: "Secret Key"
   Options:
   - Label: "I have it ready"
     Description: "Find it at: Clerk Dashboard → Configure → API Keys → Secret Key (starts with sk_)"
   - Label: "Show me where to find it"
     Description: "In Clerk Dashboard, go to Configure → API Keys. The Secret Key is hidden by default - click to reveal."

3. Question: "What is your Clerk JWT URL?"
   Header: "JWT URL"
   Options:
   - Label: "I have it ready"
     Description: "Format: https://your-app-name.clerk.accounts.dev (the frontend API domain)"
   - Label: "Show me where to find it"
     Description: "In Clerk Dashboard, go to Configure → API Keys. Look for 'Clerk Frontend API' or 'Publishable key' domain."
```

After user provides credentials, validate the format:
- `CLERK_PUBLISHABLE_KEY`: Must start with `pk_test_` or `pk_live_`
- `CLERK_SECRET_KEY`: Must start with `sk_test_` or `sk_live_`
- `CLERK_JWT_URL`: Must be a valid HTTPS URL (e.g., `https://your-app.clerk.accounts.dev`)

### Step 2: Choose a VM Name

Ask the user what to name their Connect VM:

```
Question: "What should we name your Connect VM?"
Header: "VM Name"
Options:
- Label: "myconnect (Recommended)"
  Description: "Your services will be at https://myconnect.exe.xyz"
- Label: "fireproof-sync"
  Description: "Your services will be at https://fireproof-sync.exe.xyz"
- Label: "Let me choose"
  Description: "Enter a custom name (lowercase letters, numbers, hyphens only)"
```

### Step 3: Deploy to exe.dev

Run the deployment script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-exe.js" \
  --name <vm-name> \
  --connect \
  --skip-file \
  --clerk-publishable-key "pk_test_..." \
  --clerk-secret-key "sk_test_..." \
  --clerk-jwt-url "https://your-app.clerk.accounts.dev"
```

This will:
1. Create an exe.dev VM (if it doesn't exist)
2. Install Docker on the VM
3. Clone the Fireproof repository
4. Generate security tokens
5. Configure and start Docker services
6. Set up nginx proxy for /api and /sync routes

### Step 4: Provide Connection Details

After successful deployment, inform the user:

```
Connect deployment complete!

Services are available at:
  - Token API: https://<vm-name>.exe.xyz/api
  - Cloud Sync: wss://<vm-name>.exe.xyz/sync

Update your project's .env file:

  VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
  VITE_TOKEN_API_URI=https://<vm-name>.exe.xyz/api
  VITE_CLOUD_BACKEND_URL=fpcloud://<vm-name>.exe.xyz/sync?protocol=wss

Apps generated with /vibes:vibes will now use authenticated sync.

To check Docker status:
  ssh <vm-name>.exe.xyz "cd /opt/fireproof/core && sudo docker compose ps"

To view logs:
  ssh <vm-name>.exe.xyz "cd /opt/fireproof/core && sudo docker compose logs -f"
```

## Generated Configuration

### docker-compose.yaml (on VM)

Located at `/opt/fireproof/core/docker-compose.yaml`:

```yaml
services:
  cloud-backend:
    build:
      context: ..
      dockerfile: docker/Dockerfile.cloud-backend
    ports:
      - "127.0.0.1:8909:8909"
    environment:
      ENDPOINT_PORT: "8909"
      NODE_ENV: production
      CLOUD_SESSION_TOKEN_PUBLIC: <generated>
      CLERK_PUB_JWT_URL: <your-clerk-jwt-url>
      VERSION: FP-MSG-1.0
      BLOB_PROXY_URL: "https://<vm-name>.exe.xyz/sync"

  dashboard:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dashboard
    ports:
      - "127.0.0.1:7370:7370"
    environment:
      PORT: "7370"
      NODE_ENV: production
      CLOUD_SESSION_TOKEN_PUBLIC: <generated>
      CLOUD_SESSION_TOKEN_SECRET: <generated>
      CLERK_SECRET_KEY: <your-clerk-secret-key>
      CLERK_PUBLISHABLE_KEY: <your-clerk-publishable-key>
      CLERK_PUB_JWT_URL: <your-clerk-jwt-url>
      DEVICE_ID_CA_PRIV_KEY: <generated>
      DEVICE_ID_CA_CERT: <generated>
      FP_ENDPOINT: http://cloud-backend:8909
    depends_on:
      cloud-backend:
        condition: service_healthy
```

### .env (Project Root)

```bash
# Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Fireproof Connect (exe.dev)
VITE_TOKEN_API_URI=https://<vm-name>.exe.xyz/api
VITE_CLOUD_BACKEND_URL=fpcloud://<vm-name>.exe.xyz/sync?protocol=wss
```

## Troubleshooting

### Docker Services Not Starting

Check Docker status on the VM:
```bash
ssh <vm-name>.exe.xyz "cd /opt/fireproof/core && sudo docker compose ps"
ssh <vm-name>.exe.xyz "cd /opt/fireproof/core && sudo docker compose logs"
```

If containers are unhealthy, try rebuilding:
```bash
ssh <vm-name>.exe.xyz "cd /opt/fireproof/core && sudo docker compose down && sudo docker compose up -d --build"
```

### Connection Refused

If you get connection refused errors:
1. Verify nginx is running: `ssh <vm-name>.exe.xyz "sudo systemctl status nginx"`
2. Check nginx config: `ssh <vm-name>.exe.xyz "sudo nginx -t"`
3. Verify Docker ports are listening: `ssh <vm-name>.exe.xyz "sudo netstat -tlnp | grep -E '7370|8909'"`

### Clerk Authentication Fails

1. Verify keys match your Clerk application
2. Ensure the JWT URL matches your Clerk frontend API domain
3. Check that your Clerk app has the correct allowed origins

### WebSocket Connection Issues

If WebSocket connections fail:
1. Check that the /sync nginx config includes WebSocket upgrade headers
2. Verify the cloud-backend container is healthy
3. Check browser console for CORS errors

## Comparison: exe.dev vs Local Docker

| Aspect | exe.dev (Recommended) | Local Docker |
|--------|----------------------|--------------|
| Setup | Single command | Multiple steps |
| Docker required | No (runs on VM) | Yes |
| HTTPS | Automatic | Manual setup |
| Accessibility | Public URL | localhost only |
| Team sharing | Share URL | Share credentials |
| Persistence | Always running | Manual start/stop |

## What's Next?

After Connect setup is complete, present these options:

```
Question: "Connect is deployed! What would you like to do next?"
Header: "Next"
Options:
- Label: "Build an app with auth (/vibes)"
  Description: "Generate a new React app with Clerk authentication and Fireproof cloud sync."

- Label: "View Docker logs"
  Description: "SSH into the VM and tail the Docker logs to verify everything is working."

- Label: "I'm done for now"
  Description: "Your Connect services are running. Start building when you're ready."
```

**After user responds:**
- "Build an app" → Auto-invoke /vibes:vibes skill
- "View Docker logs" → Show the SSH command: `ssh <vm-name>.exe.xyz "cd /opt/fireproof/core && sudo docker compose logs -f"`
- "Done for now" → Confirm setup complete
