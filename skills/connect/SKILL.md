---
name: connect
description: Set up local Fireproof sync backend with Clerk authentication. Run this before /vibes:vibes to enable authenticated cloud sync. Creates Docker-based Token API and Cloud sync services.
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

# Fireproof Connect Setup

Set up a local Fireproof sync backend with Clerk authentication. This creates Docker services for:
- **Token API** (localhost:7370) - Issues authenticated tokens for cloud sync
- **Cloud Backend** (localhost:8909) - Real-time WebSocket sync

After setup, apps generated with `/vibes:vibes` will use `@fireproof/clerk` for authenticated sync tied to user accounts.

## Prerequisites

- Docker and Docker Compose installed
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
- `CLERK_PUB_JWT_URL`: Must be a valid HTTPS URL (e.g., `https://your-app.clerk.accounts.dev`)

### Step 2: Generate Security Keys

The setup script auto-generates:
- `CLOUD_SESSION_TOKEN_PUBLIC` - Public session token (base58, ~128 chars)
- `CLOUD_SESSION_TOKEN_SECRET` - Secret session token (base58, ~160 chars)
- `DEVICE_ID_CA_PRIV_KEY` - Device CA private key (base58, ~160 chars)
- `DEVICE_ID_CA_CERT` - Device CA certificate (JWT format)

### Step 3: Clone Fireproof Repository

```bash
# Clone the fireproof repo with Docker support branch
git clone --branch selem/docker-for-all https://github.com/fireproof-storage/fireproof.git ./fireproof
```

If the directory already exists, skip cloning and inform the user.

### Step 4: Generate Configuration Files

Run the setup script with the gathered credentials:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-connect.js" \
  --clerk-publishable-key "pk_test_..." \
  --clerk-secret-key "sk_test_..." \
  --clerk-jwt-url "https://your-app.clerk.accounts.dev"
```

This generates:
1. `./fireproof/core/docker-compose.yaml` - Docker services configuration
2. `./.env` - Environment variables for generated apps

### Step 5: Provide Startup Instructions

After successful setup, inform the user:

```
Connect setup complete!

To start the Fireproof services:

  cd fireproof/core && docker compose up --build

Services will be available at:
  - Token API: http://localhost:7370/api
  - Cloud Sync: fpcloud://localhost:8909?protocol=ws

Your .env file has been created with the connection settings.
Apps generated with /vibes:vibes will now use authenticated sync.

To stop the services: Ctrl+C or `docker compose down`
```

## Generated Files

### docker-compose.yaml

Located at `./fireproof/core/docker-compose.yaml`:

```yaml
services:
  connect:
    build:
      context: ../packages/connect-token
      dockerfile: Dockerfile
    ports:
      - "7370:7370"
    environment:
      PORT: "7370"
      NODE_ENV: development
      ENVIRONMENT: dev
      CLOUD_SESSION_TOKEN_PUBLIC: ${CLOUD_SESSION_TOKEN_PUBLIC}
      CLOUD_SESSION_TOKEN_SECRET: ${CLOUD_SESSION_TOKEN_SECRET}
      CLERK_SECRET_KEY: ${CLERK_SECRET_KEY}
      CLERK_PUBLISHABLE_KEY: ${CLERK_PUBLISHABLE_KEY}
      VITE_CLERK_PUBLISHABLE_KEY: ${CLERK_PUBLISHABLE_KEY}
      CLERK_PUB_JWT_URL: ${CLERK_PUB_JWT_URL}
      DEVICE_ID_CA_PRIV_KEY: ${DEVICE_ID_CA_PRIV_KEY}
      DEVICE_ID_CA_CERT: ${DEVICE_ID_CA_CERT}

  cloud:
    build:
      context: ../packages/cloud-backend
      dockerfile: Dockerfile
    ports:
      - "8909:8909"
    environment:
      PORT: "8909"
      CLOUD_SESSION_TOKEN_PUBLIC: ${CLOUD_SESSION_TOKEN_PUBLIC}
      CLOUD_SESSION_TOKEN_SECRET: ${CLOUD_SESSION_TOKEN_SECRET}
```

### .env (Project Root)

```bash
# Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Fireproof Connect (Local Development)
VITE_TOKEN_API_URI=http://localhost:7370/api
VITE_CLOUD_BACKEND_URL=fpcloud://localhost:8909?protocol=ws
```

## Troubleshooting

### Docker Build Fails

If Docker build fails, ensure:
1. Docker Desktop is running
2. You have network access to npm registry
3. The `selem/docker-for-all` branch exists

### Port Already in Use

If ports 7370 or 8909 are in use:
```bash
# Find what's using the port
lsof -i :7370

# Kill the process or change ports in docker-compose.yaml
```

### Clerk Authentication Fails

1. Verify keys match your Clerk application
2. Ensure the JWT URL matches your Clerk frontend API domain
3. Check that your Clerk app has the correct allowed origins

## What's Next?

After Connect setup is complete, present these options:

```
Question: "Connect is ready! What would you like to do next?"
Header: "Next"
Options:
- Label: "Build an app with auth (/vibes)"
  Description: "Generate a new React app with Clerk authentication and Fireproof cloud sync."

- Label: "Start the Docker services"
  Description: "Run 'cd fireproof/core && docker compose up --build' to start Token API and Cloud sync."

- Label: "I'm done for now"
  Description: "Your configuration is saved. Run Docker services later when ready to develop."
```

**After user responds:**
- "Build an app" → Auto-invoke /vibes:vibes skill
- "Start Docker" → Display the command and explain what to expect
- "Done for now" → Confirm setup complete, explain how to start later
