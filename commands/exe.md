---
name: exe
description: Deploy a Vibes app to exe.dev VM hosting
argument-hint: "--name <appname> [--file <path>]"
---

# Exe: Deploy to exe.dev

Deploy a Vibes app to exe.dev VM hosting with nginx and automatic SSL.

## Usage

```bash
/vibes:exe --name myapp --file index.html
/vibes:exe --name myapp
```

## Arguments

- **--name** (required): Subdomain for your app (e.g., `myapp` → `myapp.exe.xyz`)
- **--file** (optional): Path to HTML file to deploy (default: `index.html`)

## What It Does

1. Connects to your exe.dev VM via SSH
2. Creates nginx configuration for your subdomain
3. Uploads your HTML file
4. Sets up SSL via Let's Encrypt
5. Uploads the Fireproof bundle (if using local workaround)

## Prerequisites

- SSH key in `~/.ssh/`
- exe.dev account (run `ssh exe.dev` to create)

## DNS Configuration

Your app will be available at:
```
https://myapp.exe.xyz
```

For custom domains, point your DNS to your exe.dev VM IP.

## Multi-Tenant Apps

For SaaS apps with subdomain routing:
1. Configure wildcard DNS: `*.myapp.com` → VM IP
2. Use `?subdomain=tenant` query parameter for SSL compatibility
3. Or set up wildcard SSL on your own server

## Related

- `/vibes:connect` - Deploy the sync backend first
- `/vibes:sell` - Transform app into multi-tenant SaaS
- `/vibes:vibes` - Generate the app to deploy
