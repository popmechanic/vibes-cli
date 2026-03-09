# AI Proxy Worker — Design Document

**Date:** 2026-03-09
**Status:** Approved

## Overview

Standalone Cloudflare Worker at `ai.vibesos.com` that proxies AI requests to OpenRouter using a single shared API key. Authenticates users via Pocket ID JWT. Replaces the Bun-based `ai-proxy.js` on exe.dev VMs and the ad-hoc `POST /api/ai/chat` endpoint in the registry Worker.

## Goals

- Every Vibes-generated app gets AI capabilities for free via a `useAI()` hook
- No user-provided API keys required
- Streaming responses (SSE) work from pure client-side React apps
- Zero state in v1 — no D1, no KV, just auth + proxy
- Clean separation from registry and deploy infrastructure

## Non-Goals (v1)

- Per-tenant usage tracking or billing
- Rate limiting
- Model allow/deny lists
- Conversation history management

## Architecture

### Request Flow

```
Browser (React app)
  → fetch('https://ai.vibesos.com/v1/chat/completions')
  → AI Worker: validate JWT, inject OpenRouter key
  → OpenRouter: process request, stream SSE response
  → AI Worker: pipe ReadableStream back to browser
  → React: useAI() hook parses SSE, updates state
```

### Worker Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/chat/completions` | Authenticated proxy to OpenRouter |
| OPTIONS | `/v1/chat/completions` | CORS preflight |
| GET | `/health` | Health check |

### Authentication

JWKS-based JWT validation, same pattern as Deploy API Worker:
- Fetches keys from `https://vibesos.com/.well-known/jwks.json`
- In-memory cache with 5-minute TTL, cache-bust retry on rotation
- Validates: RS256 signature, expiration, issuer
- Extracts `sub` for user identification (logged, not enforced)
- No anonymous access — unauthenticated requests get 401

### CORS

Allows: `*.vibesos.com`, `*.vibes.diy`, `localhost:*`. Same wildcard matching pattern as the registry Worker.

### Environment Bindings

- `OPENROUTER_API_KEY` (secret) — single shared key
- `OIDC_ISSUER` (var) — `https://vibesos.com`

No D1, no KV, no service bindings.

## App-Side Integration

### `useAI()` Hook

Bundled as `bundles/vibes-ai.js`, exposed on `window`. Available to every generated app without imports.

```javascript
const { useAI } = window;

function MyComponent() {
  const { ask, answer, loading, error } = useAI();

  const handleSubmit = (prompt) => {
    ask({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });
  };

  return <div>{loading ? 'Thinking...' : answer}</div>;
}
```

**Behavior:**
- `ask()` gets the OIDC access token from the auth context (already available via OIDC bridge)
- Sends streaming fetch to `ai.vibesos.com`
- Parses SSE chunks, updates `answer` as tokens arrive
- Sets `loading = false` when stream completes
- Sets `error` on failure; partial `answer` preserved

**Not included:**
- Conversation history management (caller's responsibility via `messages` array)
- Model selection UI
- Retry logic

### Auth Dependency

The hook requires a signed-in user for the access token. If not signed in, `ask()` sets `error` immediately without fetching.

## Template Integration

### New Constant

`scripts/lib/auth-constants.js`:
```javascript
export const AI_PROXY_URL = 'https://ai.vibesos.com';
```

### New Placeholder

`source-templates/base/template.html` gets `__VITE_AI_PROXY_URL__`, replaced at assembly time by both `assemble.js` and `assemble-sell.js`.

### Bundle Injection

`bundles/vibes-ai.js` loaded via `<script>` tag in the base template. Injected by `merge-templates.js` following the same pattern as the OIDC bridge bundle. Reads the proxy URL from the assembled value.

### Scope

Base-level infrastructure — every skill (vibes, riff, sell) gets AI support automatically. No delta template changes required.

## File Layout

### New Files

```
ai-worker/                          # Standalone Worker project
  src/
    index.ts                        # Hono app
    jwt.ts                          # JWKS-based JWT validation
    cors.ts                         # CORS middleware
  wrangler.toml                     # Route to ai.vibesos.com
  package.json                      # hono, wrangler deps

bundles/vibes-ai.js                 # useAI() hook + SSE parser
```

### Modified Files

```
scripts/lib/auth-constants.js       # Add AI_PROXY_URL
scripts/assemble.js                 # Replace __VITE_AI_PROXY_URL__
scripts/assemble-sell.js            # Replace __VITE_AI_PROXY_URL__
source-templates/base/template.html # Add <script> tag, add placeholder
scripts/merge-templates.js          # Inject vibes-ai.js bundle
```

## Error Handling

### Worker Responses

| Scenario | Status | Body |
|----------|--------|------|
| No/invalid JWT | 401 | `{ error: "Unauthorized" }` |
| Expired JWT | 401 | `{ error: "Token expired" }` |
| OpenRouter out of credits | 502 | `{ error: "Service unavailable" }` |
| OpenRouter rate limited | 429 | Pass through |
| OpenRouter down | 502 | `{ error: "AI service unavailable" }` |
| Malformed request | 400 | `{ error: "Invalid request" }` |

### Client-Side

- Network failure mid-stream: `error` set, `loading` cleared, partial `answer` preserved
- Not signed in: `error` set immediately, no fetch
- No auto-retry — caller decides via `ask()` re-invocation

## Testing

### Worker Unit Tests

- JWT validation (valid, expired, bad signature, missing)
- CORS (preflight, allowed/denied origins, wildcards)
- Proxy behavior (body passthrough, auth header injection, status forwarding)
- Health endpoint

### Bundle Unit Tests

- SSE parser: extracts content from chunks, handles split chunks, handles `[DONE]`
- Assembly: `__VITE_AI_PROXY_URL__` added to placeholder validation

### Manual E2E

Deploy Worker → build test app with `useAI()` → deploy app → sign in → send message → verify streaming response.

## Deployment

Manual `wrangler deploy` from `ai-worker/` directory. Route binds to `ai.vibesos.com` via existing CF zone.

## Migration

The existing `POST /api/ai/chat` in the registry Worker and `scripts/deployables/ai-proxy.js` remain in place until the new Worker is proven. Remove after successful E2E validation.

## Future Extensions

These are explicitly deferred, noted here for context:
- D1 usage logging (per-request: user, model, tokens, cost)
- Per-tenant spending caps
- Rate limiting
- Model allow/deny lists
- Usage dashboard
- Per-user billing integration
