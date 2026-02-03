---
name: connect
description: Deploy Fireproof Connect to a dedicated Studio VM on exe.dev
argument-hint: "--studio <name> --clerk-publishable-key <key> --clerk-secret-key <key>"
---

# Connect: Deploy Fireproof Studio

Deploy Fireproof Connect to a dedicated Studio VM for cloud sync.

## Usage

```bash
/vibes:connect --studio mystudio \
  --clerk-publishable-key "pk_test_..." \
  --clerk-secret-key "sk_test_..."
```

## Arguments

- **--studio** (required): Name for your Studio VM (e.g., `mystudio` → `mystudio.exe.xyz`)
- **--clerk-publishable-key** (required): Your Clerk publishable key
- **--clerk-secret-key** (required): Your Clerk secret key

## What It Provides

After deployment, your Studio VM provides:

- **Token API**: `https://mystudio.exe.xyz/api`
- **Cloud Sync**: `fpcloud://mystudio.exe.xyz?protocol=wss`

## Updating Your App

After deploying Connect, update your app's `.env`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=https://mystudio.exe.xyz/api
VITE_CLOUD_URL=fpcloud://mystudio.exe.xyz?protocol=wss
```

## Architecture

The Studio VM runs Docker services from the upstream Fireproof repo:
- Token generation service
- WebSocket sync gateway
- Clerk authentication integration

## Prerequisites

- SSH key in `~/.ssh/`
- exe.dev account
- Clerk application with keys

## Related

- `/vibes:exe` - Deploy your apps (points to this Studio)
- `/vibes:sell` - Create multi-tenant SaaS (requires Connect)
