---
name: launch
description: Build and deploy a SaaS app end-to-end using Agent Teams
argument-hint: "[prompt]"
---

# Launch: Full SaaS Pipeline

Build and deploy a complete SaaS application end-to-end. Uses Agent Teams for parallel execution of app generation, auth setup, billing configuration, and deployment.

## Usage

```bash
/vibes:launch "project management SaaS"
/vibes:launch
```

## Arguments

- **prompt** (optional): Description of the SaaS to build. If omitted, you'll be asked interactively.

## What It Does

1. **Generate** the app (vibes)
2. **Configure** Clerk authentication (credentials + connect)
3. **Add billing** with subscription gating (sell)
4. **Assemble** the final HTML
5. **Deploy** to hosting
6. **Verify** the live URL

Agent Teams run independent steps in parallel (e.g., app generation and credential setup happen simultaneously).

## Requirements

- Claude Code with Agent Teams support
- For other agents, run the pipeline sequentially: `/vibes:vibes` then `/vibes:sell` then `/vibes:connect` then `/vibes:cloudflare`

## Related

- `/vibes:vibes` - Generate just the app
- `/vibes:sell` - Transform an existing app into SaaS
- `/vibes:connect` - Deploy the sync backend
- `/vibes:cloudflare` - Deploy to Cloudflare Workers
