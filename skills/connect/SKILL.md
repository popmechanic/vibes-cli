---
name: connect
description: Self-contained deploy automation — invoke directly, do not decompose. Deploys Fireproof Connect to a dedicated Studio VM on exe.dev. Sets up cloud sync backend for all your Vibes apps.
license: MIT
allowed-tools: Bash, Read, Glob, AskUserQuestion
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:connect". Do not decompose the steps below into separate plan tasks.

## Deploy Connect Studio

Deploy Fireproof Connect to exe.dev as your personal sync backend. Your Studio VM runs the full Fireproof sync stack and can be used by multiple apps.

### Prerequisites

1. **SSH key** in `~/.ssh/` (id_ed25519, id_rsa, or id_ecdsa)
2. **exe.dev account** - run `ssh exe.dev` once to create your account
3. **OIDC configuration** — Pocket ID is deployed alongside Connect on the Studio VM. You will configure:
   - OIDC Authority URL (e.g., `https://studio.exe.xyz/auth`)
   - OIDC Client ID (generated during setup)

### Gather Config

**Use AskUserQuestion to collect deployment config before running the deploy script.**

```
Question 0: "Have you created an exe.dev account? (Run `ssh exe.dev` in your terminal to create one)"
Header: "exe.dev"
Options:
- Label: "Yes, I have an account"
  Description: "I've already run ssh exe.dev and verified my account."
- Label: "No, I need to set one up"
  Description: "I haven't created an exe.dev account yet."
```

If "No": Instruct the user:
> Run `ssh exe.dev` in your terminal. This will create your account automatically.
> You'll need an SSH key in ~/.ssh/ (the command will guide you).
> Once your account is confirmed, come back and we'll continue.

Then STOP and wait for them to confirm they've completed this step.

```
Question 1: "What codename for your Studio? (becomes <codename>.exe.xyz)"
Header: "Studio"
Options: Suggest "${username}-studio" + user enters via "Other"

Question 2: "Pocket ID will be set up automatically on your Studio VM. Ready to proceed?"
Header: "Auth"
Options: ["Yes, let's go", "Tell me more about Pocket ID"]
```

If user wants to learn more: Pocket ID is a lightweight OIDC provider that runs alongside Connect on your Studio VM. It handles authentication for all your Vibes apps — no external auth service needed.

### Deploy Command

```bash
cd "${CLAUDE_PLUGIN_ROOT}/scripts" && [ -d node_modules ] || npm install
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-connect.js" \
  --studio <codename>
```

The deploy script automatically sets up Pocket ID alongside Connect. After deployment, OIDC credentials are output and saved to your local `.env`.

### What It Does

1. **SSH to `<studio>.exe.xyz`** - Creates VM if needed
2. **Clone fireproof repo** - `selem/docker-for-all` branch to `/opt/fireproof`
3. **Deploy Pocket ID** - Sets up OIDC provider alongside Connect
4. **Generate security tokens** - Session tokens and device CA keys
5. **Create `.env`** - All credentials for Docker services (including OIDC config)
6. **Run `./docker/start.sh`** - Starts the full Fireproof stack + Pocket ID
7. **Wait for services** - Confirms port 8080 is responding
8. **Write local `.env`** - Saves studio info and OIDC credentials for future reference

### Architecture

```
Studio VM (<codename>.exe.xyz)
├── /opt/fireproof/
│   ├── docker-compose.yaml (from repo)
│   ├── docker/
│   │   ├── nginx.conf (routes all traffic)
│   │   └── start.sh (orchestrates services)
│   └── .env (generated credentials)
└── Docker services (port 8080 exposed)
    ├── nginx proxy
    ├── dashboard (internal 7370)
    └── cloud-backend (internal 8909)
```

### Public URLs

After deployment, your Studio exposes:

| Endpoint | URL | Purpose |
|----------|-----|---------|
| OIDC Authority | `https://<studio>.exe.xyz/auth` | Pocket ID OIDC provider |
| Token API | `https://<studio>.exe.xyz/api` | Token issuance for auth |
| Cloud Sync | `fpcloud://<studio>.exe.xyz?protocol=wss` | Real-time sync |

### Local `.connect` File

The deploy script creates a `.connect` file in your project:

```
studio: <codename>
api_url: https://<codename>.exe.xyz/api
cloud_url: fpcloud://<codename>.exe.xyz?protocol=wss
oidc_authority: https://<codename>.exe.xyz/auth
oidc_client_id: <generated-client-id>
```

This file is gitignored and used to auto-configure app deployments.

### Update Your App's Environment

After deploying Connect, update your app's `.env`:

```bash
VITE_OIDC_AUTHORITY=https://<studio>.exe.xyz/auth
VITE_OIDC_CLIENT_ID=<generated-client-id>
VITE_API_URL=https://<studio>.exe.xyz/api
VITE_CLOUD_URL=fpcloud://<studio>.exe.xyz?protocol=wss
```

### Troubleshooting

**Check Docker status:**
```bash
ssh <studio>.exe.xyz "cd /opt/fireproof && sudo docker compose ps"
```

**View logs:**
```bash
ssh <studio>.exe.xyz "cd /opt/fireproof && sudo docker compose logs -f"
```

**Restart services:**
```bash
ssh <studio>.exe.xyz "cd /opt/fireproof && sudo docker compose restart"
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--studio <name>` | Studio VM name (required) |
| `--dry-run` | Show what would be done without executing |

---

### What's Next?
After successful deployment, present these options using AskUserQuestion:

```
Question: "Your Connect Studio is live at https://${studio}.exe.xyz! What's next?"
Header: "Next"
Options:
- Label: "Deploy an app that uses this Studio"
  Description: "Generate and deploy a Vibes app configured to sync through your Studio. I'll set up the environment automatically."

- Label: "Update an existing app to use Connect"
  Description: "Configure an existing app's .env to point to your new Studio for cloud sync."

- Label: "I'm done for now"
  Description: "Your Studio is running 24/7 on exe.dev. Any app configured with these URLs will sync through it."
```
