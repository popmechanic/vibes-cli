import { Hono } from "hono";
import { cors } from "hono/cors";
import { Webhook } from "svix";
import type { Env } from "./types";
import { RegistryKV } from "./lib/kv-storage";
import { verifyClerkJWT, verifyClerkJWTDebug } from "./lib/crypto-jwt";
import { parsePermittedOrigins } from "./lib/jwt-validation";
import {
  isSubdomainAvailable,
  getUserClaims,
  createClaim,
  processSubscriptionChange,
} from "./lib/registry-logic";

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use("*", cors());

// GET /registry.json - Public read
app.get("/registry.json", async (c) => {
  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const registry = await kv.read();
  return c.json(registry);
});

// GET /check/:subdomain - Check availability
app.get("/check/:subdomain", async (c) => {
  const subdomain = c.req.param("subdomain");
  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const registry = await kv.read();

  // Apply reserved subdomains from config
  if (c.env.RESERVED_SUBDOMAINS && !registry.reserved?.length) {
    registry.reserved = c.env.RESERVED_SUBDOMAINS.split(",").map((s) => s.trim());
  }

  const result = isSubdomainAvailable(registry, subdomain);
  return c.json(result);
});

// POST /claim - Authenticated subdomain claiming
app.post("/claim", async (c) => {
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);

  // Use debug version to get detailed failure reason
  const authResult = await verifyClerkJWTDebug(authHeader, c.env.CLERK_PEM_PUBLIC_KEY, permittedOrigins);
  if ('error' in authResult) {
    return c.json({
      error: "Unauthorized",
      failReason: authResult.error,
      permittedOrigins
    }, 401);
  }
  const auth = authResult;

  let body: { subdomain?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.subdomain) {
    return c.json({ error: "Missing subdomain" }, 400);
  }

  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const registry = await kv.read();

  // Apply reserved subdomains from config
  if (c.env.RESERVED_SUBDOMAINS && !registry.reserved?.length) {
    registry.reserved = c.env.RESERVED_SUBDOMAINS.split(",").map((s) => s.trim());
  }

  // Idempotent: if user already owns this subdomain, return success
  const normalized = body.subdomain.toLowerCase().trim();
  if (registry.claims?.[normalized]?.userId === auth.userId) {
    return c.json({ success: true, subdomain: normalized }, 201);
  }

  const availability = isSubdomainAvailable(registry, body.subdomain);
  if (!availability.available) {
    return c.json({ error: "Subdomain not available", reason: availability.reason }, 409);
  }

  // Check quota — webhook-set quota is authoritative; JWT pla claim proves subscription; default is 0
  const userClaims = getUserClaims(registry, auth.userId);
  const webhookQuota = registry.quotas?.[auth.userId];
  const jwtQuota = (c.env.BILLING_MODE === 'required')
    ? (auth.pla ? 1 : 0)   // subscribed = 1 claim, free = 0
    : 999;                   // no billing = unlimited
  const quota = webhookQuota ?? jwtQuota;
  if (userClaims.length >= quota) {
    return c.json(
      {
        error: "Purchase required",
        reason: "quota_exceeded",
        current: userClaims.length,
        quota,
      },
      402
    );
  }

  // Create the claim
  const result = createClaim(registry, body.subdomain, auth.userId);
  if (!result.success) {
    return c.json({ error: "Claim failed", reason: result.error }, 409);
  }

  await kv.write(registry);
  return c.json({ success: true, subdomain: result.subdomain }, 201);
});

// POST /webhook - Clerk subscription webhooks
app.post("/webhook", async (c) => {
  const payload = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Verify webhook signature
  let event: { type: string; data: { user_id?: string; quantity?: number } };
  try {
    const wh = new Webhook(c.env.CLERK_WEBHOOK_SECRET);
    event = wh.verify(payload, {
      "svix-id": headers["svix-id"] || "",
      "svix-timestamp": headers["svix-timestamp"] || "",
      "svix-signature": headers["svix-signature"] || "",
    }) as typeof event;
  } catch (error) {
    console.error("Webhook verification failed:", error);
    return c.json({ error: "Invalid webhook signature" }, 401);
  }

  console.log("Received webhook event:", event.type);

  // Handle subscription changes
  if (
    event.type === "subscription.created" ||
    event.type === "subscription.updated" ||
    event.type === "subscription.deleted"
  ) {
    // Clerk Commerce nests user_id inside data.payer
    const eventData = event.data as any;
    const userId = eventData.payer?.user_id ?? eventData.user_id;

    if (!userId) {
      return c.json({ error: "Missing user_id" }, 400);
    }

    const kv = new RegistryKV(c.env.REGISTRY_KV);
    const registry = await kv.read();

    // Additive quota: each subscription.created adds 1 slot, each deleted removes 1
    registry.quotas = registry.quotas ?? {};
    const currentQuota = registry.quotas[userId] ?? 0;

    if (event.type === "subscription.created") {
      // Each new subscription adds 1 subdomain slot
      registry.quotas[userId] = currentQuota + 1;
    } else if (event.type === "subscription.deleted") {
      // Canceling removes 1 slot (floor at 0)
      const newQuota = Math.max(currentQuota - 1, 0);
      if (newQuota > 0) {
        registry.quotas[userId] = newQuota;
      } else {
        delete registry.quotas[userId];
      }
    }
    // subscription.updated: keep current quota (status changes don't affect slot count)

    // Process subscription change (may release subdomains if quota dropped below claims)
    const finalQuota = registry.quotas[userId] ?? 0;
    const result = processSubscriptionChange(registry, userId, finalQuota);
    if (result.released.length > 0) {
      console.log(`Released ${result.released.length} subdomains for user ${userId}`);
    }

    await kv.write(registry);
  }

  return c.json({ received: true });
});

// POST /api/ai/chat - AI proxy to OpenRouter
app.post("/api/ai/chat", async (c) => {
  const apiKey = c.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return c.json({ error: "AI not configured" }, 501);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": new URL(c.req.url).origin,
      "X-Title": new URL(c.req.url).hostname.split('.')[0]
    },
    body: JSON.stringify(body)
  });

  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { "Content-Type": "application/json" }
  });
});

// 404 for everything else
app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default app;
