---
name: deploy-exe
description: Deploy a Vibes app to exe.dev VM hosting
---

# Deploy to exe.dev

Deploys your Vibes app to exe.dev using the automated deployment script.

## Instructions

```bash
VIBES_DIR=`node ~/.claude/plugins/cache/vibes-cli/vibes/*/scripts/find-plugin.js`
cd "${VIBES_DIR}scripts" && [ -d node_modules ] || npm install
node "${VIBES_DIR}scripts/deploy-exe.js" --name <vmname> [--file index.html] [--domain example.com]
```

## Prerequisites

- SSH key in `~/.ssh/`
- exe.dev account (run `ssh exe.dev` to set up)
- A generated `index.html` Vibes app

## Options

| Flag | Description |
|------|-------------|
| `--name <vm>` | VM name (required) |
| `--file <path>` | HTML file (default: index.html) |
| `--domain <domain>` | Custom domain for wildcard setup |
| `--dry-run` | Preview without executing |

## Result

Your app will be live at `https://<vmname>.exe.xyz`
