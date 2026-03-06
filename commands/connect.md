---
name: connect
description: Deploy Fireproof Connect to a dedicated Studio VM on exe.dev
argument-hint: "--studio <name>"
---

# Connect: Deploy Fireproof Studio

Deploy Fireproof Connect to a dedicated Studio VM for cloud sync.

## Usage

```bash
/vibes:connect --studio mystudio
```

## Arguments

- **--studio** (required): Name for your Studio VM (e.g., `mystudio` → `mystudio.exe.xyz`)

## What It Provides

After deployment, your Studio VM provides:

- **OIDC Authority**: `https://mystudio.exe.xyz/auth` (Pocket ID)
- **Token API**: `https://mystudio.exe.xyz/api`
- **Cloud Sync**: `fpcloud://mystudio.exe.xyz?protocol=wss`

## Updating Your App

After deploying Connect, update your app's `.env`:

```bash
VITE_OIDC_AUTHORITY=https://mystudio.exe.xyz/auth
VITE_OIDC_CLIENT_ID=<generated-client-id>
VITE_API_URL=https://mystudio.exe.xyz/api
VITE_CLOUD_URL=fpcloud://mystudio.exe.xyz?protocol=wss
```

## Architecture

The Studio VM runs Docker services from the upstream Fireproof repo:
- Token generation service
- WebSocket sync gateway
- Pocket ID OIDC authentication

## Prerequisites

- SSH key in `~/.ssh/`
- exe.dev account

## Related

- `/vibes:exe` - Deploy your apps (points to this Studio)
- `/vibes:sell` - Create multi-tenant SaaS (requires Connect)
