/**
 * AI Proxy Server for Vibes Apps
 *
 * This Bun server proxies AI requests to OpenRouter, handling:
 * - Single-user mode: Direct proxy with operator's key
 * - Multi-tenant mode: Per-tenant provisioned keys with limits
 *
 * Environment variables:
 * - OPENROUTER_API_KEY: The operator's OpenRouter API key
 * - VIBES_MULTI_TENANT: "true" for sell apps, absent for vibes apps
 * - VIBES_TENANT_LIMIT: Credit limit per tenant in dollars (default: 5)
 *
 * Deployed to: /opt/vibes/proxy.js on exe.dev VMs
 */

import { Database } from "bun:sqlite";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const IS_MULTI_TENANT = process.env.VIBES_MULTI_TENANT === "true";
const TENANT_LIMIT = parseFloat(process.env.VIBES_TENANT_LIMIT) || 5;
const PORT = parseInt(process.env.VIBES_PROXY_PORT) || 3001;

// Validate required config
if (!OPENROUTER_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY environment variable is required");
  process.exit(1);
}

// Initialize SQLite for tenant key storage (multi-tenant only)
let db = null;
if (IS_MULTI_TENANT) {
  db = new Database("/var/lib/vibes/keys.db");
  db.run(`
    CREATE TABLE IF NOT EXISTS tenant_keys (
      tenant TEXT PRIMARY KEY,
      openrouter_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}

// Clerk PEM public key for JWT verification (same as registry server)
const CLERK_PEM_PUBLIC_KEY = (process.env.CLERK_PEM_PUBLIC_KEY || "").replace(/\\n/g, "\n");

/**
 * Verify and extract tenant ID from Clerk JWT
 * In sell apps, the JWT contains the subdomain as custom claim
 */
async function extractTenant(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    // Decode JWT parts
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Verify signature if PEM key is configured
    if (CLERK_PEM_PUBLIC_KEY) {
      const crypto = await import("crypto");
      const header = JSON.parse(
        Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
      );
      if (header.alg !== "RS256") return null;

      const signatureInput = parts[0] + "." + parts[1];
      const signature = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const isValid = crypto.default.createVerify("RSA-SHA256")
        .update(signatureInput)
        .verify(CLERK_PEM_PUBLIC_KEY, signature);

      if (!isValid) {
        console.error("JWT signature verification failed");
        return null;
      }
    } else {
      console.warn("CLERK_PEM_PUBLIC_KEY not set — JWT signature not verified");
    }

    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null;
    }

    // Extract tenant from custom claims or subdomain
    return payload.tenant || payload.subdomain || payload.sub || null;
  } catch (err) {
    console.error("JWT verification error:", err.message);
    return null;
  }
}

/**
 * Get or create a provisioned OpenRouter key for a tenant
 */
async function getOrCreateTenantKey(tenant) {
  // Check cache first
  const row = db.query("SELECT openrouter_key FROM tenant_keys WHERE tenant = ?").get(tenant);
  if (row) {
    return row.openrouter_key;
  }

  // Provision new key via OpenRouter API
  const response = await fetch("https://openrouter.ai/api/v1/keys", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: `vibes-tenant-${tenant}`,
      limit: TENANT_LIMIT,
      limit_reset: "monthly"
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to provision OpenRouter key: ${error}`);
  }

  const data = await response.json();
  const newKey = data.key;

  // Cache the key
  db.run(
    "INSERT OR REPLACE INTO tenant_keys (tenant, openrouter_key, created_at) VALUES (?, ?, ?)",
    [tenant, newKey, Date.now()]
  );

  return newKey;
}

/**
 * Proxy request to OpenRouter
 */
async function proxyToOpenRouter(body, apiKey) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://vibes.diy",
      "X-Title": "Vibes App"
    },
    body: JSON.stringify(body)
  });

  return response;
}

// Permitted origins for CORS (reuse PERMITTED_ORIGINS from registry if set)
const CORS_ORIGINS = (process.env.PERMITTED_ORIGINS || "").split(",").filter(Boolean);

// NOTE: This pattern matching logic is intentionally duplicated from lib/jwt-validation.js
// because this file runs as a standalone Bun server on remote VMs.
// The canonical tested version is in lib/jwt-validation.js — keep in sync.
function getCorsOrigin(req) {
  const requestOrigin = req.headers.get("Origin") || "";
  if (CORS_ORIGINS.length === 0) return "*";

  const isAllowed = CORS_ORIGINS.some(pattern => {
    if (pattern === requestOrigin) return true;
    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp("^" + escaped.replace(/\*/g, "[^.]+") + "$");
      return regex.test(requestOrigin);
    }
    return false;
  });

  return isAllowed ? requestOrigin : CORS_ORIGINS[0];
}

/**
 * Main request handler
 */
async function handleRequest(req) {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    let apiKey = OPENROUTER_KEY;

    // Multi-tenant: extract tenant and get their provisioned key
    if (IS_MULTI_TENANT) {
      const tenant = await extractTenant(req);
      if (!tenant) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      apiKey = await getOrCreateTenantKey(tenant);
    }

    // Parse and proxy the request
    const body = await req.json();
    const openRouterResponse = await proxyToOpenRouter(body, apiKey);

    // Pass through OpenRouter's response (including 402 for limit exceeded)
    const responseBody = await openRouterResponse.text();
    return new Response(responseBody, {
      status: openRouterResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });

  } catch (err) {
    console.error("Proxy error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// Start server
console.log(`Vibes AI Proxy starting on port ${PORT}`);
console.log(`Mode: ${IS_MULTI_TENANT ? "multi-tenant" : "single-user"}`);
if (IS_MULTI_TENANT) {
  console.log(`Tenant limit: $${TENANT_LIMIT}/month`);
}

Bun.serve({
  port: PORT,
  fetch: handleRequest
});

console.log(`Vibes AI Proxy listening on http://localhost:${PORT}`);
