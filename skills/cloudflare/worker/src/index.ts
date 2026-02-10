import { Hono } from "hono";
import { cors } from "hono/cors";
import { Webhook } from "svix";
import type { Env } from "./types";
import { RegistryKV } from "./lib/kv-storage";
import { verifyClerkJWT, verifyClerkJWTDebug } from "./lib/crypto-jwt";
import { parsePermittedOrigins } from "./lib/jwt-validation";
import {
  isSubdomainAvailable,
  createClaim,
  processSubscriptionChange,
} from "./lib/registry-logic";

const app = new Hono<{ Bindings: Env }>();

const parseAdminIds = (value?: string): string[] =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

// CORS middleware
app.use("*", cors());

// GET /registry.json - Public read
app.get("/registry.json", async (c) => {
  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const registry = await kv.read();
  const { quotas, ...publicRegistry } = registry;
  return c.json(publicRegistry);
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

  // Admin bypass — admins skip subscription check
  const adminIds = parseAdminIds(c.env.ADMIN_USER_IDS);
  const isAdmin = adminIds.includes(auth.userId);

  // Subscription gate — check JWT pla claim (set by Clerk Commerce)
  // pla format is "scope:slug" (e.g. "u:starter", "u:free")
  // Reject missing plan or free plan — only paid plans pass
  if (!isAdmin) {
    const planSlug = auth.plan?.split(':')[1];
    const hasActiveSubscription = !!planSlug && planSlug !== 'free';
    const billingRequired = c.env.BILLING_MODE === 'required';
    if (billingRequired && !hasActiveSubscription) {
      return c.json(
        {
          error: "Purchase required",
          reason: "no_subscription",
        },
        402
      );
    }
  }

  // Create the claim
  const result = createClaim(registry, body.subdomain, auth.userId);
  if (!result.success) {
    return c.json({ error: "Claim failed", reason: result.error }, 409);
  }

  await kv.write(registry);
  return c.json({ success: true, subdomain: result.subdomain }, 201);
});

// POST /admin/quotas - Admin-only quota toggles (testing)
app.post("/admin/quotas", async (c) => {
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);

  const authResult = await verifyClerkJWTDebug(authHeader, c.env.CLERK_PEM_PUBLIC_KEY, permittedOrigins);
  if ("error" in authResult) {
    return c.json(
      {
        error: "Unauthorized",
        failReason: authResult.error,
        permittedOrigins,
      },
      401
    );
  }
  const auth = authResult;

  const adminIds = parseAdminIds(c.env.ADMIN_USER_IDS);
  if (adminIds.length === 0 || !adminIds.includes(auth.userId)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  let body: { userId?: string; enabled?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.userId || typeof body.enabled !== "boolean") {
    return c.json({ error: "Missing userId or enabled flag" }, 400);
  }

  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const registry = await kv.read();
  registry.quotas = registry.quotas ?? {};

  if (body.enabled) {
    registry.quotas[body.userId] = 1;
  } else {
    delete registry.quotas[body.userId];
  }

  await kv.write(registry);
  return c.json({ success: true, quotas: registry.quotas });
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
    console.error("Secret length:", c.env.CLERK_WEBHOOK_SECRET?.length, "prefix:", c.env.CLERK_WEBHOOK_SECRET?.substring(0, 10));
    console.error("svix-id:", headers["svix-id"], "svix-timestamp:", headers["svix-timestamp"]);
    console.error("payload length:", payload.length);
    return c.json({ error: "Invalid webhook signature", debug: String(error) }, 401);
  }

  console.log("Received webhook event:", event.type);

  // Only process subscription.deleted — JWT claims are source of truth for active subscriptions
  if (event.type === "subscription.deleted") {
    const eventData = event.data as any;
    const userId = eventData.payer?.user_id ?? eventData.user_id;

    if (!userId) {
      return c.json({ error: "Missing user_id" }, 400);
    }

    const kv = new RegistryKV(c.env.REGISTRY_KV);
    const registry = await kv.read();

    // Release claims on hard cancellation
    const result = processSubscriptionChange(registry, userId, 0);
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
