---
name: test
description: Run end-to-end integration test with real deployment
argument-hint: "[fixture]"
---

# Test: E2E Integration Test

Run an end-to-end integration test using a pre-built fixture. Assembles the app, deploys to Connect and Cloudflare, and presents a live URL for browser verification.

## Usage

```bash
/vibes:test counter
/vibes:test
```

## Arguments

- **fixture** (optional): Name of a test fixture from `scripts/__tests__/fixtures/`. If omitted, you'll be asked to choose.

## What It Does

1. Selects a test fixture (or uses the one you specify)
2. Assembles it with real credentials
3. Deploys to Cloudflare Workers
4. Presents the live URL for browser verification
5. Runs diagnostic checks on the deployed app

## Prerequisites

- Clerk credentials in `test-vibes/.env`
- Cloudflare account with `wrangler` authenticated
- Connect Studio deployed (via `/vibes:connect`)

## Related

- `/vibes:vibes` - Generate new apps
- `/vibes:cloudflare` - Deploy manually
- `/vibes:connect` - Deploy the sync backend
