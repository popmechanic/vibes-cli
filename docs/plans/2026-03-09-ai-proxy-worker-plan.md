# AI Proxy Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a standalone Cloudflare Worker at `ai.vibesos.com` that proxies authenticated AI requests to OpenRouter with streaming support, and wire it into all Vibes-generated apps via a `useAI()` hook.

**Architecture:** Hono-based Worker validates Pocket ID JWTs via JWKS, injects a shared OpenRouter API key, and pipes streaming SSE responses back to the browser. A `useAI()` React hook bundled into the base template handles the client side. No D1, no KV — pure auth + proxy.

**Tech Stack:** Hono, Cloudflare Workers, Web Crypto API (RS256), OpenRouter API, React hooks, Server-Sent Events

**Design doc:** `docs/plans/2026-03-09-ai-proxy-worker-design.md`

---

### Task 1: Scaffold the AI Worker project

**Files:**
- Create: `ai-worker/package.json`
- Create: `ai-worker/wrangler.toml`
- Create: `ai-worker/tsconfig.json`
- Create: `ai-worker/src/index.ts` (empty Hono app with health endpoint)

**Step 1: Create package.json**

```json
{
  "name": "vibes-ai-worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "hono": "^4.0.0",
    "wrangler": "^3.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Step 2: Create wrangler.toml**

```toml
name = "vibes-ai-proxy"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[vars]
OIDC_ISSUER = "https://vibesos.com"

# Secrets (set via wrangler secret put):
# OPENROUTER_API_KEY

# Route to ai.vibesos.com (configure after first deploy)
# [[routes]]
# pattern = "ai.vibesos.com/*"
# zone_id = "<CF_ZONE_ID>"
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

**Step 4: Create minimal Hono app**

Create `ai-worker/src/index.ts`:

```typescript
import { Hono } from "hono";

type Env = {
  OPENROUTER_API_KEY: string;
  OIDC_ISSUER: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("ok"));

export default app;
```

**Step 5: Install deps and verify**

Run: `cd ai-worker && npm install && npx wrangler dev --test-scheduled`
Expected: Worker starts, `curl http://localhost:8787/health` returns "ok"

**Step 6: Commit**

```bash
git add ai-worker/
git commit -m "scaffold AI proxy Worker project with health endpoint"
```

---

### Task 2: JWT verification module

Port the JWKS-based JWT validation from `deploy-api/src/index.ts` (lines 25-178) into the AI Worker as a standalone module.

**Files:**
- Create: `ai-worker/src/jwt.ts`
- Reference: `deploy-api/src/index.ts:25-178`

**Step 1: Create jwt.ts**

Port these functions from `deploy-api/src/index.ts`:
- `fetchJwks()` (lines 31-41) — JWKS fetch with 5-min cache
- `importJwk()` (lines 43-51) — JWK to CryptoKey
- `base64UrlDecode()` (lines 56-60)
- `parseJwt()` (lines 65-94)
- `findKey()` (lines 99-117) — kid matching with cache-bust
- `verifyJWT()` (lines 123-178) — main verification

```typescript
// ai-worker/src/jwt.ts

let cachedJwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchJwks(issuer: string): Promise<{ keys: JsonWebKey[] }> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL) {
    return cachedJwks;
  }
  const res = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json() as { keys: JsonWebKey[] };
  cachedJwks = { ...data, fetchedAt: Date.now() };
  return data;
}

// ... rest ported from deploy-api/src/index.ts lines 43-178

export async function verifyJWT(
  authHeader: string | undefined,
  issuer: string
): Promise<{ sub: string } | null> {
  // Extract bearer token
  // Parse JWT
  // Find matching JWK by kid (with cache-bust retry)
  // Verify RS256 signature via crypto.subtle.verify
  // Validate exp, iat (60s clock skew), iss, sub
  // Return { sub } on success, null on failure
}
```

The key difference from deploy-api: this module takes `issuer` as a param (not env binding), and returns a simpler result (`{ sub }` or `null`).

**Step 2: Verify it compiles**

Run: `cd ai-worker && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add ai-worker/src/jwt.ts
git commit -m "add JWKS-based JWT verification module for AI Worker"
```

---

### Task 3: CORS middleware

**Files:**
- Create: `ai-worker/src/cors.ts`
- Reference: `deploy-api/src/index.ts:514-520` (CORS pattern)

**Step 1: Create cors.ts**

```typescript
import { cors } from "hono/cors";

export const aiCors = cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (origin.includes("localhost")) return origin;
    if (origin.endsWith(".vibesos.com")) return origin;
    if (origin.endsWith(".vibes.diy")) return origin;
    if (origin.endsWith(".workers.dev")) return origin;
    return undefined;
  },
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});
```

**Step 2: Wire into index.ts**

```typescript
import { aiCors } from "./cors";
// ...
app.use("/*", aiCors);
```

**Step 3: Verify**

Run: `cd ai-worker && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add ai-worker/src/cors.ts ai-worker/src/index.ts
git commit -m "add CORS middleware for AI Worker"
```

---

### Task 4: Chat completions proxy endpoint

**Files:**
- Modify: `ai-worker/src/index.ts`
- Reference: `skills/cloudflare/worker/src/index.ts:378-416` (existing non-streaming proxy)

**Step 1: Add the streaming proxy endpoint**

Add to `ai-worker/src/index.ts`:

```typescript
import { verifyJWT } from "./jwt";

app.post("/v1/chat/completions", async (c) => {
  // 1. Verify JWT
  const result = await verifyJWT(c.req.header("Authorization"), c.env.OIDC_ISSUER);
  if (!result) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 2. Validate API key is configured
  if (!c.env.OPENROUTER_API_KEY) {
    return c.json({ error: "AI service not configured" }, 501);
  }

  // 3. Parse request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  // 4. Proxy to OpenRouter
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": c.req.header("Origin") || c.req.header("Referer") || "https://vibesos.com",
      "X-Title": "Vibes DIY",
    },
    body: JSON.stringify(body),
  });

  // 5. Stream the response through (works for both streaming and non-streaming)
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-cache",
    },
  });
});
```

The key difference from the registry endpoint: instead of `await response.text()` (buffering), we pass `response.body` (a ReadableStream) directly through. This enables SSE streaming when the client sends `"stream": true`.

**Step 2: Test locally**

Run: `cd ai-worker && OPENROUTER_API_KEY=test npx wrangler dev`

Test auth rejection:
```bash
curl -X POST http://localhost:8787/v1/chat/completions -d '{}' -H 'Content-Type: application/json'
```
Expected: `{"error":"Unauthorized"}` with 401

**Step 3: Commit**

```bash
git add ai-worker/src/index.ts
git commit -m "add streaming chat completions proxy endpoint"
```

---

### Task 5: Deploy Worker and configure route

**Step 1: Set the OpenRouter secret**

```bash
cd ai-worker && npx wrangler secret put OPENROUTER_API_KEY
```
Enter the shared OpenRouter API key when prompted.

**Step 2: Deploy**

```bash
cd ai-worker && npx wrangler deploy
```

Note the deployed URL (e.g., `vibes-ai-proxy.<account>.workers.dev`).

**Step 3: Configure custom domain**

In the Cloudflare dashboard or via wrangler, add the route for `ai.vibesos.com`:
- Add a CNAME record: `ai.vibesos.com → vibes-ai-proxy.<account>.workers.dev`
- Or uncomment and configure the `[[routes]]` section in `wrangler.toml` with the zone ID

**Step 4: Verify**

```bash
curl https://ai.vibesos.com/health
```
Expected: `ok`

**Step 5: Commit route config if wrangler.toml was updated**

```bash
git add ai-worker/wrangler.toml
git commit -m "configure ai.vibesos.com route"
```

---

### Task 6: Add `AI_PROXY_URL` to auth constants

**Files:**
- Modify: `scripts/lib/auth-constants.js:11` (add new export after DEPLOY_API_URL)

**Step 1: Add the constant**

Add after line 11 of `scripts/lib/auth-constants.js`:

```javascript
export const AI_PROXY_URL = 'https://ai.vibesos.com';
```

**Step 2: Commit**

```bash
git add scripts/lib/auth-constants.js
git commit -m "add AI_PROXY_URL to auth constants"
```

---

### Task 7: Add `__VITE_AI_PROXY_URL__` to base template config

**Files:**
- Modify: `source-templates/base/template.html:120-126` (add to `__VIBES_CONFIG__`)

**Step 1: Add to config object**

At line 125, after `deployApiUrl: "__VITE_DEPLOY_API_URL__"`, add:

```javascript
window.__VIBES_CONFIG__ = {
  tokenApiUri: "__VITE_API_URL__",
  cloudBackendUrl: "__VITE_CLOUD_URL__",
  oidcAuthority: "__VITE_OIDC_AUTHORITY__",
  oidcClientId: "__VITE_OIDC_CLIENT_ID__",
  deployApiUrl: "__VITE_DEPLOY_API_URL__",
  aiProxyUrl: "__VITE_AI_PROXY_URL__"
};
```

**Step 2: Commit**

```bash
git add source-templates/base/template.html
git commit -m "add AI proxy URL placeholder to base template config"
```

---

### Task 8: Replace `useAI()` hook with streaming version

The existing `useAI()` in the base template (lines 138-196) is non-streaming and points at a relative `/api/ai/chat` path. Replace it with a version that reads from `__VIBES_CONFIG__.aiProxyUrl` and supports SSE streaming.

**Files:**
- Create: `bundles/vibes-ai.js`
- Modify: `source-templates/base/template.html:138-196` (remove old inline useAI, add bundle script tag)

**Step 1: Create the bundle**

Create `bundles/vibes-ai.js`:

```javascript
/**
 * Vibes AI Hook
 * Provides useAI() for streaming AI responses from the Vibes AI proxy.
 * Reads proxy URL from window.__VIBES_CONFIG__.aiProxyUrl.
 * Requires OIDC auth — token sourced from window.__VIBES_OIDC_TOKEN__.
 */

(function () {
  const React = window.React;
  if (!React) {
    console.warn("[vibes-ai] React not found on window, useAI unavailable");
    return;
  }

  /**
   * Parse an SSE stream from OpenRouter.
   * Yields content deltas as strings. Handles chunks split across reads.
   */
  async function* parseSSEStream(reader) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last partial line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // empty or comment
        if (trimmed === "data: [DONE]") return;
        if (trimmed.startsWith("data: ")) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim() && buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
      try {
        const json = JSON.parse(buffer.trim().slice(6));
        const content = json.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // Skip
      }
    }
  }

  function useAI() {
    const [answer, setAnswer] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    const ask = React.useCallback(async (options) => {
      const config = window.__VIBES_CONFIG__ || {};
      const proxyUrl = config.aiProxyUrl;
      if (!proxyUrl) {
        setError({ code: "NOT_CONFIGURED", message: "AI proxy not configured" });
        return;
      }

      const token = window.__VIBES_OIDC_TOKEN__;
      if (!token) {
        setError({ code: "AUTH_REQUIRED", message: "Sign in to use AI features" });
        return;
      }

      setLoading(true);
      setError(null);
      setAnswer("");

      try {
        const response = await fetch(proxyUrl + "/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
          },
          body: JSON.stringify({
            model: options.model || "anthropic/claude-sonnet-4",
            messages: options.messages,
            stream: true,
            ...options.params,
          }),
        });

        if (response.status === 401) {
          setError({ code: "UNAUTHORIZED", message: "Session expired — sign in again" });
          setLoading(false);
          return;
        }

        if (response.status === 429) {
          setError({ code: "RATE_LIMITED", message: "Too many requests — try again shortly" });
          setLoading(false);
          return;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          setError({
            code: "API_ERROR",
            message: errData.error?.message || errData.error || "AI service error: " + response.status,
          });
          setLoading(false);
          return;
        }

        // Stream SSE response
        const reader = response.body.getReader();
        let accumulated = "";

        for await (const chunk of parseSSEStream(reader)) {
          accumulated += chunk;
          setAnswer(accumulated);
        }
      } catch (err) {
        setError({ code: "NETWORK_ERROR", message: err.message || "Network error" });
      } finally {
        setLoading(false);
      }
    }, []);

    return { ask, answer, loading, error };
  }

  // Also expose the non-streaming callAI for backward compat
  function useAICompat() {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    const callAI = React.useCallback(async (options) => {
      const config = window.__VIBES_CONFIG__ || {};
      const proxyUrl = config.aiProxyUrl;
      if (!proxyUrl) throw new Error("AI proxy not configured");

      const token = window.__VIBES_OIDC_TOKEN__;
      setLoading(true);
      setError(null);

      try {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = "Bearer " + token;

        const response = await fetch(proxyUrl + "/v1/chat/completions", {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: options.model || "anthropic/claude-sonnet-4",
            messages: options.messages,
            ...options,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const err = { code: "API_ERROR", message: errData.error?.message || "API error: " + response.status };
          setError(err);
          throw err;
        }

        return await response.json();
      } catch (err) {
        if (!error) setError({ code: "NETWORK_ERROR", message: err.message || "Network error" });
        throw err;
      } finally {
        setLoading(false);
      }
    }, []);

    return { callAI, loading, error, clearError: function () { setError(null); } };
  }

  window.useAI = useAI;
  window.useAICompat = useAICompat;
})();
```

**Step 2: Remove old inline useAI from base template**

In `source-templates/base/template.html`, remove lines 138-196 (the old `// === useAI Hook ===` section through `window.useAI = useAI;`).

Replace with a script tag to load the bundle (place it after the OIDC bridge script tag, before the delta placeholder):

```html
<script src="/vibes-ai.js"></script>
```

**Step 3: Run merge-templates to regenerate**

```bash
bun scripts/merge-templates.js --force
```

**Step 4: Commit**

```bash
git add bundles/vibes-ai.js source-templates/base/template.html
git commit -m "replace inline useAI with streaming bundle"
```

---

### Task 9: Wire placeholder into assembly scripts

**Files:**
- Modify: `scripts/assemble.js:18-20,56-60` (add import + replacement)
- Modify: `scripts/assemble-sell.js:40,227-230` (add import + replacement)

**Step 1: Update assemble.js**

At line 18, add `AI_PROXY_URL` to the import:

```javascript
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from './lib/auth-constants.js';
```

After the existing replacements (around line 60), add:

```javascript
output = output.replaceAll('__VITE_AI_PROXY_URL__', AI_PROXY_URL);
```

**Step 2: Update assemble-sell.js**

At line 40, add `AI_PROXY_URL` to the import:

```javascript
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from './lib/auth-constants.js';
```

In the replacement section (around line 230), add:

```javascript
output = output.split('__VITE_AI_PROXY_URL__').join(AI_PROXY_URL);
```

**Step 3: Verify assembly works**

```bash
echo 'function App() { return <div>test</div>; }' > /tmp/test-app.jsx
bun scripts/assemble.js --app /tmp/test-app.jsx --output /tmp/test-output.html
grep "ai.vibesos.com" /tmp/test-output.html
```
Expected: Match found (the placeholder was replaced)

**Step 4: Commit**

```bash
git add scripts/assemble.js scripts/assemble-sell.js
git commit -m "inject AI proxy URL during assembly"
```

---

### Task 10: Update assembly pipeline tests

**Files:**
- Modify: `scripts/__tests__/integration/assembly-pipeline.test.js:18` (add to SAFE_PLACEHOLDERS)

**Step 1: Add to safe placeholders**

At line 18, add `'__VITE_AI_PROXY_URL__'` to the `SAFE_PLACEHOLDERS` array.

**Step 2: Also add to assemble-sell.js SAFE_PLACEHOLDER_PATTERNS**

In `scripts/assemble-sell.js` around line 244, add `'__VITE_AI_PROXY_URL__'` to the `SAFE_PLACEHOLDER_PATTERNS` array.

**Step 3: Run tests**

```bash
cd scripts && npm test
```
Expected: All tests pass (including placeholder validation)

**Step 4: Commit**

```bash
git add scripts/__tests__/integration/assembly-pipeline.test.js scripts/assemble-sell.js
git commit -m "add AI proxy URL to safe placeholder lists"
```

---

### Task 11: Update merge-templates to include vibes-ai.js bundle

The OIDC bridge is loaded via the import map (`"use-fireproof": "/fireproof-oidc-bridge.js"`). The vibes-ai bundle is a standalone script tag. Check how the deploy Worker serves bundled files — the assembly or deploy pipeline needs to embed `vibes-ai.js` alongside `fireproof-oidc-bridge.js`.

**Files:**
- Reference: `scripts/assemble.js` — check how `fireproof-oidc-bridge.js` gets embedded
- Modify: `scripts/assemble.js` — embed `vibes-ai.js` the same way
- Modify: `scripts/assemble-sell.js` — same

**Step 1: Investigate how OIDC bridge is embedded**

Read `scripts/assemble.js` to find how `/fireproof-oidc-bridge.js` is handled. The deploy Worker serves files from a `FILES` map (see `deploy-api/src/index.ts:291-347`), so the bundle must be embedded as a separate file entry in the deployment payload, OR inlined into index.html.

Check which approach is used and follow the same pattern for `vibes-ai.js`.

**Step 2: Embed vibes-ai.js using the same mechanism**

Follow the pattern found in step 1. This likely means:
- Reading `bundles/vibes-ai.js` during assembly
- Either inlining it as a `<script>` block in index.html, or adding it as a separate file in the deploy payload

**Step 3: Test locally**

```bash
bun scripts/assemble.js --app /tmp/test-app.jsx --output /tmp/test-output.html
grep "useAI" /tmp/test-output.html
```
Expected: The useAI hook code appears in the output

**Step 4: Commit**

```bash
git add scripts/assemble.js scripts/assemble-sell.js
git commit -m "embed vibes-ai.js bundle during assembly"
```

---

### Task 12: Write Worker unit tests

**Files:**
- Create: `ai-worker/src/__tests__/jwt.test.ts`
- Create: `ai-worker/src/__tests__/cors.test.ts`
- Create: `ai-worker/src/__tests__/proxy.test.ts`
- Create: `ai-worker/vitest.config.ts`

**Step 1: Add vitest to dev deps**

In `ai-worker/package.json`, add `"vitest": "^1.0.0"` to devDependencies and add test script:
```json
"test": "vitest run"
```

**Step 2: Create vitest config**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

**Step 3: Write JWT tests**

```typescript
// ai-worker/src/__tests__/jwt.test.ts
import { describe, it, expect } from "vitest";

describe("verifyJWT", () => {
  it("returns null when no auth header provided", async () => {
    // ...
  });

  it("returns null when auth header is not Bearer", async () => {
    // ...
  });

  it("returns null for expired token", async () => {
    // Test with a crafted expired JWT
  });

  it("returns { sub } for valid token", async () => {
    // Requires mocking fetch for JWKS endpoint
    // Use a test RSA keypair to sign a valid JWT
  });
});
```

**Step 4: Write CORS tests**

```typescript
// ai-worker/src/__tests__/cors.test.ts
import { describe, it, expect } from "vitest";

describe("CORS", () => {
  it("allows localhost origins", () => { /* ... */ });
  it("allows *.vibesos.com", () => { /* ... */ });
  it("allows *.vibes.diy", () => { /* ... */ });
  it("rejects unknown origins", () => { /* ... */ });
});
```

**Step 5: Write proxy tests**

```typescript
// ai-worker/src/__tests__/proxy.test.ts
import { describe, it, expect } from "vitest";

describe("POST /v1/chat/completions", () => {
  it("returns 401 without auth", async () => { /* ... */ });
  it("returns 400 for invalid JSON body", async () => { /* ... */ });
  it("forwards request to OpenRouter with API key", async () => { /* ... */ });
  it("passes through streaming response body", async () => { /* ... */ });
  it("passes through OpenRouter error status codes", async () => { /* ... */ });
});
```

**Step 6: Run tests**

```bash
cd ai-worker && npm test
```
Expected: All tests pass

**Step 7: Commit**

```bash
git add ai-worker/src/__tests__/ ai-worker/vitest.config.ts ai-worker/package.json
git commit -m "add unit tests for AI Worker JWT, CORS, and proxy"
```

---

### Task 13: Write SSE parser unit tests

**Files:**
- Create: `scripts/__tests__/unit/vibes-ai.test.js`
- Reference: `bundles/vibes-ai.js` (the parseSSEStream function)

**Step 1: Extract parseSSEStream for testability**

The `parseSSEStream` function is inside an IIFE in `vibes-ai.js`. To test it, either:
- Export it separately (preferred): create a small `bundles/sse-parser.js` module and import it in both the bundle and tests
- Or test via the bundle by evaluating it in a test context

Simplest approach: make `parseSSEStream` a named export from a small helper, import it in both places.

**Step 2: Write tests**

```javascript
import { describe, it, expect } from "vitest";

describe("parseSSEStream", () => {
  it("extracts content from a complete SSE message", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    // Create a ReadableStream from chunks, feed to parseSSEStream
    // Expect: ["Hello", " world"]
  });

  it("handles chunks split across reads", async () => {
    // Split a single SSE message across two chunks
    const chunks = [
      'data: {"choices":[{"delta":{"conte',
      'nt":"split"}}]}\n\ndata: [DONE]\n\n',
    ];
    // Expect: ["split"]
  });

  it("ignores SSE comments", async () => {
    const chunks = [': keepalive\ndata: {"choices":[{"delta":{"content":"hi"}}]}\n\n'];
    // Expect: ["hi"]
  });

  it("handles empty delta content", async () => {
    const chunks = ['data: {"choices":[{"delta":{}}]}\n\n', 'data: [DONE]\n\n'];
    // Expect: []
  });
});
```

**Step 3: Run tests**

```bash
cd scripts && npm test
```
Expected: All tests pass

**Step 4: Commit**

```bash
git add bundles/ scripts/__tests__/unit/vibes-ai.test.js
git commit -m "add SSE parser unit tests"
```

---

### Task 14: Manual E2E verification

**Step 1: Build a test app**

Create a simple chat app that uses `useAI()`:

```jsx
function App() {
  const { useAI } = window;
  const { ask, answer, loading, error } = useAI();
  const [input, setInput] = React.useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    ask({ messages: [{ role: "user", content: input }] });
  };

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>AI Test</h1>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask anything..."
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={handleSend} disabled={loading}>
          {loading ? "..." : "Ask"}
        </button>
      </div>
      {error && <p style={{ color: "red" }}>{error.message}</p>}
      {answer && <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 16 }}>{answer}</pre>}
    </div>
  );
}
```

**Step 2: Assemble and deploy**

```bash
bun scripts/assemble.js --app /tmp/ai-test-app.jsx --output index.html
bun scripts/deploy-cloudflare.js --name ai-test --file index.html
```

**Step 3: Verify in browser**

1. Open the deployed app URL
2. Sign in via Pocket ID
3. Type a question and click "Ask"
4. Verify: response streams in token-by-token (not all at once)
5. Verify: console shows no CORS errors
6. Verify: network tab shows SSE response from `ai.vibesos.com`

**Step 4: Clean up**

The test app can stay deployed or be removed. No code to commit — this is validation only.

---

## Task Dependency Summary

```
Task 1 (scaffold) → Task 2 (JWT) → Task 3 (CORS) → Task 4 (proxy endpoint) → Task 5 (deploy)
                                                                                      ↓
Task 6 (auth constant) → Task 7 (template config) → Task 8 (useAI bundle) → Task 9 (assembly) → Task 10 (tests) → Task 11 (bundle embed)
                                                                                                                            ↓
Task 12 (Worker tests)                                                                                              Task 14 (E2E)
Task 13 (SSE tests)

Tasks 1-5 (Worker) and Tasks 6-11 (app integration) can run in parallel.
Tasks 12-13 (unit tests) can run any time after their respective code is written.
Task 14 (E2E) requires both tracks complete.
```
