/**
 * Subdomain Registry Server
 *
 * A lightweight Bun server that manages subdomain claims for multi-tenant SaaS apps.
 * Handles:
 * - GET /registry.json — Public read of all claims
 * - POST /claim — Authenticated subdomain claiming
 * - POST /webhook — Clerk subscription webhooks for release on lapse
 *
 * Run with: bun run registry-server.ts
 * Or as systemd service for production
 */

import { Webhook } from "svix";
import jwt from "jsonwebtoken";
import {
  isSubdomainAvailable as _isSubdomainAvailable,
  getUserClaims as _getUserClaims,
} from "../lib/registry-logic.js";

// Configuration from environment
const REGISTRY_PATH = process.env.REGISTRY_PATH || "/var/www/html/registry.json";
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || "";

// Load Clerk PEM public key - supports file path or inline value
function loadClerkPublicKey(): string {
  const keyFile = process.env.CLERK_PEM_PUBLIC_KEY_FILE;
  if (keyFile) {
    try {
      const fs = require("fs");
      return fs.readFileSync(keyFile, "utf8").trim();
    } catch (err) {
      console.error(`Failed to read Clerk public key from ${keyFile}:`, err);
      return "";
    }
  }
  // Convert escaped newlines to actual newlines (env vars store \n as literal)
  return (process.env.CLERK_PEM_PUBLIC_KEY || "").replace(/\\n/g, "\n");
}
const CLERK_PEM_PUBLIC_KEY = loadClerkPublicKey();
const PORT = parseInt(process.env.PORT || "3001", 10);

// Permitted origins for JWT azp claim validation
const PERMITTED_ORIGINS = (process.env.PERMITTED_ORIGINS || "").split(",").filter(Boolean);

interface Claim {
  userId: string;
  claimedAt: string;
}

interface Registry {
  claims: Record<string, Claim>;
  reserved: string[];
  preallocated: Record<string, string>;
  quotas?: Record<string, number>;  // userId -> allowed subdomain count
}

/**
 * Read the registry file
 */
async function readRegistry(): Promise<Registry> {
  try {
    const file = Bun.file(REGISTRY_PATH);
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    // Return empty registry if file doesn't exist
    return { claims: {}, reserved: [], preallocated: {} };
  }
}

/**
 * Write the registry file atomically
 */
async function writeRegistry(registry: Registry): Promise<void> {
  const tempPath = `${REGISTRY_PATH}.tmp`;
  await Bun.write(tempPath, JSON.stringify(registry, null, 2));
  // Atomic rename
  const fs = await import("fs/promises");
  await fs.rename(tempPath, REGISTRY_PATH);
}

/**
 * Simple file-based mutex for registry operations
 * Prevents race conditions in read-check-write cycles
 */
const LOCK_PATH = `${REGISTRY_PATH}.lock`;
const LOCK_TIMEOUT = 5000; // 5 seconds

async function acquireLock(): Promise<boolean> {
  const fs = await import("fs");
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT) {
    try {
      fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      // Lock exists, wait and retry
      await new Promise(r => setTimeout(r, 50));
    }
  }
  // Timeout — check if lock is stale (older than LOCK_TIMEOUT)
  try {
    const fs2 = await import("fs/promises");
    const stat = await fs2.stat(LOCK_PATH);
    if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT) {
      await fs2.unlink(LOCK_PATH);
      return acquireLock();
    }
  } catch {}
  return false;
}

async function releaseLock(): Promise<void> {
  try {
    const fs = await import("fs/promises");
    await fs.unlink(LOCK_PATH);
  } catch {}
}

/**
 * Verify Clerk JWT from Authorization header
 * Returns the decoded token with userId, or null if invalid
 */
function verifyClerkJWT(authHeader: string | null): { userId: string } | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, CLERK_PEM_PUBLIC_KEY, {
      algorithms: ["RS256"],
    }) as jwt.JwtPayload;

    // Validate expiration
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      console.error("JWT expired");
      return null;
    }
    if (decoded.nbf && decoded.nbf > currentTime) {
      console.error("JWT not yet valid");
      return null;
    }

    // NOTE: This pattern matching logic is intentionally duplicated from lib/jwt-validation.js
    // because this file runs as a standalone Bun server on remote VMs.
    // The canonical tested version is in lib/jwt-validation.js — keep in sync.
    // Validate authorized party if configured (supports wildcard patterns like *.domain.com)
    if (PERMITTED_ORIGINS.length > 0 && decoded.azp) {
      const azpMatches = PERMITTED_ORIGINS.some(pattern => {
        // Exact match
        if (pattern === decoded.azp) return true;
        // Wildcard match: https://*.domain.com matches https://sub.domain.com
        if (pattern.includes('*')) {
          // Escape regex special chars, then replace * with [^.]+ (any subdomain segment)
          const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp('^' + escaped.replace(/\*/g, '[^.]+') + '$');
          return regex.test(decoded.azp as string);
        }
        return false;
      });
      if (!azpMatches) {
        console.error("Invalid azp claim:", decoded.azp, "permitted:", PERMITTED_ORIGINS);
        return null;
      }
    }

    // Clerk JWTs have sub as the user ID
    if (!decoded.sub) {
      console.error("No sub claim in JWT");
      return null;
    }

    return { userId: decoded.sub };
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

/**
 * Verify Svix webhook signature
 */
function verifyWebhook(
  payload: string,
  headers: Record<string, string>
): unknown | null {
  if (!CLERK_WEBHOOK_SECRET) {
    console.error("CLERK_WEBHOOK_SECRET not configured");
    return null;
  }

  try {
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    return wh.verify(payload, {
      "svix-id": headers["svix-id"] || "",
      "svix-timestamp": headers["svix-timestamp"] || "",
      "svix-signature": headers["svix-signature"] || "",
    });
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return null;
  }
}

// Registry logic imported from shared module (tested in registry-logic.test.js)
const isSubdomainAvailable = _isSubdomainAvailable as (
  registry: Registry,
  subdomain: string
) => { available: boolean; reason?: string; ownerId?: string };

const getUserClaims = _getUserClaims as (
  registry: Registry,
  userId: string
) => string[];

/**
 * Get CORS origin for a request
 * Restricts to PERMITTED_ORIGINS if configured, otherwise allows all
 */
// NOTE: This pattern matching logic is intentionally duplicated from lib/jwt-validation.js
// because this file runs as a standalone Bun server on remote VMs.
// The canonical tested version is in lib/jwt-validation.js — keep in sync.
function getCorsOrigin(req: Request): string {
  const requestOrigin = req.headers.get("Origin") || "";
  if (PERMITTED_ORIGINS.length === 0) return "*";

  const isAllowed = PERMITTED_ORIGINS.some(pattern => {
    if (pattern === requestOrigin) return true;
    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp("^" + escaped.replace(/\*/g, "[^.]+") + "$");
      return regex.test(requestOrigin);
    }
    return false;
  });

  return isAllowed ? requestOrigin : PERMITTED_ORIGINS[0];
}

/**
 * Main server
 */
Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": getCorsOrigin(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // GET /registry.json — Public read
    if (req.method === "GET" && url.pathname === "/registry.json") {
      const registry = await readRegistry();
      return new Response(JSON.stringify(registry), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /check/:subdomain — Check availability
    if (req.method === "GET" && url.pathname.startsWith("/check/")) {
      const subdomain = url.pathname.slice(7); // Remove "/check/"
      const registry = await readRegistry();
      const result = isSubdomainAvailable(registry, subdomain);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /claim — Authenticated subdomain claiming
    if (req.method === "POST" && url.pathname === "/claim") {
      const auth = verifyClerkJWT(req.headers.get("Authorization"));
      if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let body: { subdomain?: string };
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!body.subdomain) {
        return new Response(JSON.stringify({ error: "Missing subdomain" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Acquire lock for read-check-write atomicity
      if (!await acquireLock()) {
        return new Response(
          JSON.stringify({ error: "Server busy, try again" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const registry = await readRegistry();
        const availability = isSubdomainAvailable(registry, body.subdomain);

        if (!availability.available) {
          return new Response(
            JSON.stringify({ error: "Subdomain not available", reason: availability.reason }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Check user's quota before claiming
        // Default to 999 when no quota set (billing_mode="off" scenario)
        const userClaims = getUserClaims(registry, auth.userId);
        const quota = registry.quotas?.[auth.userId] ?? 999;

        if (userClaims.length >= quota) {
          return new Response(
            JSON.stringify({
              error: "Purchase required",
              reason: "quota_exceeded",
              current: userClaims.length,
              quota: quota,
            }),
            {
              status: 402,  // Payment Required
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Claim the subdomain
        const normalized = body.subdomain.toLowerCase().trim();
        registry.claims[normalized] = {
          userId: auth.userId,
          claimedAt: new Date().toISOString(),
        };

        await writeRegistry(registry);

        return new Response(
          JSON.stringify({ success: true, subdomain: normalized }),
          {
            status: 201,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      } finally {
        await releaseLock();
      }
    }

    // POST /webhook — Clerk subscription webhooks
    if (req.method === "POST" && url.pathname === "/webhook") {
      const payload = await req.text();
      const headers: Record<string, string> = {};

      // Extract Svix headers
      for (const [key, value] of req.headers.entries()) {
        headers[key.toLowerCase()] = value;
      }

      const event = verifyWebhook(payload, headers) as {
        type: string;
        data: {
          user_id?: string;
          quantity?: number;
          previous_quantity?: number;
        };
      } | null;

      if (!event) {
        return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.log("Received webhook event:", event.type);

      // Handle subscription changes
      if (
        event.type === "subscription.created" ||
        event.type === "subscription.updated" ||
        event.type === "subscription.deleted"
      ) {
        const userId = event.data.user_id;
        const newQuantity = event.type === "subscription.deleted"
          ? 0
          : (event.data.quantity ?? 1);

        if (!userId) {
          console.error("No user_id in webhook payload");
          return new Response(JSON.stringify({ error: "Missing user_id" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Acquire lock for read-modify-write atomicity
        if (!await acquireLock()) {
          return new Response(
            JSON.stringify({ error: "Server busy, try again" }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }

        try {
          const registry = await readRegistry();

          // Update the user's quota
          registry.quotas = registry.quotas ?? {};
          if (newQuantity > 0) {
            registry.quotas[userId] = newQuantity;
            console.log(`Updated quota for user ${userId}: ${newQuantity}`);
          } else {
            delete registry.quotas[userId];
            console.log(`Removed quota for user ${userId}`);
          }

          const userClaims = getUserClaims(registry, userId);

          // If user has more claims than their subscription allows, release excess (LIFO)
          if (userClaims.length > newQuantity) {
            const toRelease = userClaims.slice(0, userClaims.length - newQuantity);
            console.log(`Releasing ${toRelease.length} subdomains for user ${userId}:`, toRelease);

            for (const subdomain of toRelease) {
              delete registry.claims[subdomain];
            }
          }

          await writeRegistry(registry);
        } finally {
          await releaseLock();
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 404 for everything else
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
});

console.log(`Registry server running on port ${PORT}`);
