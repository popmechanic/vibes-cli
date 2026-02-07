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

  const availability = isSubdomainAvailable(registry, body.subdomain);
  if (!availability.available) {
    return c.json({ error: "Subdomain not available", reason: availability.reason }, 409);
  }

  // Check quota
  const userClaims = getUserClaims(registry, auth.userId);
  const quota = registry.quotas?.[auth.userId] ?? 999;
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
    const userId = event.data.user_id;
    const newQuantity = event.type === "subscription.deleted" ? 0 : (event.data.quantity ?? 1);

    if (!userId) {
      return c.json({ error: "Missing user_id" }, 400);
    }

    const kv = new RegistryKV(c.env.REGISTRY_KV);
    const registry = await kv.read();

    // Update quota
    registry.quotas = registry.quotas ?? {};
    if (newQuantity > 0) {
      registry.quotas[userId] = newQuantity;
    } else {
      delete registry.quotas[userId];
    }

    // Process subscription change (may release subdomains)
    const result = processSubscriptionChange(registry, userId, newQuantity);
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
    return c.json({ error: "AI not configured" }, 500);
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
