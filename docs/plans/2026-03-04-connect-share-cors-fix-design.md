# Fix Connect-Share CORS + Auth

**Date**: 2026-03-04
**Status**: Approved

## Problem

The editor preview at localhost:3333 shows CORS errors when connecting to connect-share.exe.xyz. Investigation revealed two layered issues:

1. **nginx CORS headers missing on error responses**: The OPTIONS preflight returns proper CORS headers (204, `allow-origin: *`), but proxied backend error responses (403) don't include CORS headers. The browser blocks the response and reports "CORS error", masking the real 403.

2. **Backend returning 403**: The cloud-backend rejects POST requests with 403 (likely auth/Clerk config issue). This is the real problem but invisible due to issue #1.

3. **Wrong .env**: `.env` points to `weaver.exe.xyz` instead of `connect-share.exe.xyz`.

## Approach: Diagnostic-First Fix

### Step 1: Fix nginx CORS on connect-share
SSH into connect-share.exe.xyz, add `always` keyword to all `add_header` CORS directives in nginx config. Reload nginx. This ensures CORS headers appear on ALL responses including errors.

### Step 2: Fix .env
Update `.env` to point to `connect-share.exe.xyz`.

### Step 3: Reproduce and read the real error
Reload editor preview. CORS error should be replaced by the actual 403 details in console.

### Step 4: Fix the 403
Based on what Step 3 reveals. Likely: wrong Clerk keys, JWT validation failure, or missing backend config.

## Out of Scope
- Deploying a new Connect instance (fallback only if Step 4 shows unfixable issue)
- Fixing weaver.exe.xyz (not in use)
