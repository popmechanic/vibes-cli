---
description: Sync cached Vibes DIY documentation and import map from upstream sources
---

# Sync Vibes DIY

This command syncs the cached documentation and import map from upstream Vibes DIY sources.

## Instructions

First, find the plugin root directory, then run the sync script:

```bash
# Find plugin location
PLUGIN_ROOT=$(find ~/.claude/plugins/cache -name "fetch-prompt.ts" -path "*/vibes/*" 2>/dev/null | head -1 | xargs dirname | xargs dirname)

# Run sync from plugin root
cd "$PLUGIN_ROOT" && bun scripts/fetch-prompt.ts --force
```

This updates:
- Cached Fireproof and library documentation
- Import map versions from the Vibes DIY repository

## When to Use

Run this command when:
- The skill warns that the cache is older than 30 days
- You want the latest Fireproof API documentation
- There's a security update to dependencies
- The skill seems to be using outdated patterns

## What Gets Synced

- **Import map** from vibes.diy repository (React, use-vibes, call-ai versions)
- **Fireproof docs** from https://use-fireproof.com/llms-full.txt
- Additional module documentation as configured

## Cache Staleness

The skill will warn you if the cache is older than 30 days. This ensures you stay current with any security patches or API changes in the Vibes DIY ecosystem.
