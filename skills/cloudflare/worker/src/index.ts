import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { RegistryKV } from "./lib/kv-storage";
import { verifyOIDCJWT, verifyOIDCJWTDebug } from "./lib/crypto-jwt";
import { parsePermittedOrigins } from "./lib/jwt-validation";
import {
  isSubdomainAvailable,
  createSubdomainRecord,
  addCollaborator,
  activateCollaborator,
  hasAccess,
  hasAccessByEmail,
  parsePlanQuotas,
  getQuotaForPlan,
  isQuotaExceeded,
} from "./lib/registry-logic";

const app = new Hono<{ Bindings: Env }>();

const parseAdminIds = (value?: string): string[] =>
  (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

// CORS middleware — scoped to known origins
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      if (!origin) return origin; // non-browser (CLI) requests
      if (origin === "http://localhost:3333") return origin; // editor preview
      if (origin.endsWith(".workers.dev")) return origin; // deployed apps
      if (origin.endsWith(".vibes.diy")) return origin; // custom domain (legacy)
      if (origin.endsWith(".vibesos.com")) return origin; // custom domain
      const permitted = parsePermittedOrigins((c.env as Env).PERMITTED_ORIGINS);
      if (permitted.some((p) => p === origin)) return origin;
      return null; // reject unknown origins
    },
  })
);

// One-time migration middleware: check for legacy blob and decompose
app.use("*", async (c, next) => {
  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const migrated = await kv.getMigrated();
  if (!migrated) {
    await kv.migrateFromBlob();
  }
  await next();
});

// Helper: get reserved list from KV, falling back to env var
async function getReservedList(kv: RegistryKV, envReserved?: string): Promise<string[]> {
  const kvReserved = await kv.getReserved();
  if (kvReserved.length > 0) return kvReserved;
  if (envReserved) {
    return envReserved.split(",").map((s) => s.trim());
  }
  return [];
}

// GET /registry.json - Public read (backward compat)
app.get("/registry.json", async (c) => {
  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const registry = await kv.readLegacyFormat();
  return c.json(registry);
});

// GET /check/:subdomain - Check availability
app.get("/check/:subdomain", async (c) => {
  const subdomain = c.req.param("subdomain");
  const kv = new RegistryKV(c.env.REGISTRY_KV);

  const existing = await kv.getSubdomain(subdomain.toLowerCase().trim());
  const reserved = await getReservedList(kv, c.env.RESERVED_SUBDOMAINS);
  const preallocated = await kv.getPreallocated();

  const result = isSubdomainAvailable(subdomain, existing, reserved, preallocated);
  return c.json(result);
});

// GET /check/:subdomain/access - Check if user has access
app.get("/check/:subdomain/access", async (c) => {
  const subdomain = c.req.param("subdomain").toLowerCase().trim();
  const userId = c.req.query("userId");
  const email = c.req.query("email");

  if (!userId) {
    return c.json({ error: "Missing userId query parameter" }, 400);
  }

  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const record = await kv.getSubdomain(subdomain);

  if (!record) {
    return c.json({ hasAccess: false, role: "none", frozen: false });
  }

  const result = hasAccess(record, userId);

  // Fallback: if userId lookup failed and email provided, check by email
  if (!result.hasAccess && email) {
    if (hasAccessByEmail(record, email)) {
      return c.json({ hasAccess: true, role: "collaborator", frozen: result.frozen });
    }
  }

  return c.json(result);
});

// POST /claim - Authenticated subdomain claiming
app.post("/claim", async (c) => {
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);

  const authResult = await verifyOIDCJWTDebug(authHeader, c.env.OIDC_PEM_PUBLIC_KEY, permittedOrigins, c.env.OIDC_ISSUER);
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
  const normalized = body.subdomain.toLowerCase().trim();

  // Idempotent: if user already owns this subdomain, return success
  const existingRecord = await kv.getSubdomain(normalized);
  if (existingRecord?.ownerId === auth.userId) {
    return c.json({ success: true, subdomain: normalized }, 201);
  }

  const reserved = await getReservedList(kv, c.env.RESERVED_SUBDOMAINS);
  const preallocated = await kv.getPreallocated();

  const availability = isSubdomainAvailable(body.subdomain, existingRecord, reserved, preallocated);
  if (!availability.available) {
    return c.json({ error: "Subdomain not available", reason: availability.reason }, 409);
  }

  // Admin bypass — admins skip subscription check
  const adminIds = parseAdminIds(c.env.ADMIN_USER_IDS);
  const isAdmin = adminIds.includes(auth.userId);

  // Subscription gate — check JWT pla claim (may come from Stripe in phase 2)
  if (!isAdmin) {
    const planSlug = auth.plan?.split(':')[1];
    const hasActiveSubscription = !!planSlug && planSlug !== 'free';
    const billingRequired = c.env.BILLING_MODE === 'required';
    if (billingRequired && !hasActiveSubscription) {
      return c.json(
        { error: "Purchase required", reason: "no_subscription" },
        402
      );
    }
  }

  // Read user record once — reused for quota check and user index update
  let userRecord = await kv.getUser(auth.userId);

  // Quota enforcement — check per-plan subdomain limits
  if (!isAdmin) {
    const quotas = parsePlanQuotas(c.env.PLAN_QUOTAS);
    const quota = getQuotaForPlan(auth.plan, quotas);
    if (quota !== null) {
      let ownedCount: number;
      if (userRecord?.ownedSubdomains) {
        ownedCount = userRecord.ownedSubdomains.length;
      } else if (userRecord?.subdomains) {
        // Lazy migration: count owned subdomains from the full list
        const owned: string[] = [];
        for (const sub of userRecord.subdomains) {
          const subRecord = await kv.getSubdomain(sub);
          if (subRecord && subRecord.ownerId === auth.userId) {
            owned.push(sub);
          }
        }
        ownedCount = owned.length;
        // Write migrated ownedSubdomains back and update local reference
        userRecord = { ...userRecord, ownedSubdomains: owned };
        await kv.putUser(auth.userId, userRecord);
      } else {
        ownedCount = 0;
      }
      if (isQuotaExceeded(ownedCount, quota)) {
        return c.json(
          { error: "Quota exceeded", reason: "quota_exceeded", current: ownedCount, limit: quota },
          403
        );
      }
    }
  }

  // Create the claim
  const newRecord = createSubdomainRecord(auth.userId);
  await kv.putSubdomain(normalized, newRecord);

  // Update user index
  const subdomains = userRecord?.subdomains || [];
  if (!subdomains.includes(normalized)) {
    subdomains.push(normalized);
  }
  const ownedSubdomains = userRecord?.ownedSubdomains || [];
  if (!ownedSubdomains.includes(normalized)) {
    ownedSubdomains.push(normalized);
  }
  await kv.putUser(auth.userId, {
    subdomains,
    ownedSubdomains,
    quota: userRecord?.quota ?? 3,
  });

  return c.json({ success: true, subdomain: normalized }, 201);
});

// POST /invite - Owner invites collaborator
app.post("/invite", async (c) => {
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);

  const authResult = await verifyOIDCJWTDebug(authHeader, c.env.OIDC_PEM_PUBLIC_KEY, permittedOrigins, c.env.OIDC_ISSUER);
  if ('error' in authResult) {
    return c.json({ error: "Unauthorized", failReason: authResult.error }, 401);
  }
  const auth = authResult;

  let body: { subdomain?: string; email?: string; right?: "read" | "write"; ledgerId?: string; inviteId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.subdomain || !body.email) {
    return c.json({ error: "Missing subdomain or email" }, 400);
  }

  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const normalized = body.subdomain.toLowerCase().trim();
  const record = await kv.getSubdomain(normalized);

  if (!record) {
    return c.json({ error: "Subdomain not found" }, 404);
  }

  if (record.ownerId !== auth.userId) {
    return c.json({ error: "Only the owner can invite collaborators" }, 403);
  }

  const updated = addCollaborator(record, body.email, body.right || "write", body.ledgerId, body.inviteId);
  await kv.putSubdomain(normalized, updated);

  return c.json({ success: true, subdomain: normalized }, 200);
});

// POST /join - Invitee redeems invite
app.post("/join", async (c) => {
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);

  const authResult = await verifyOIDCJWTDebug(authHeader, c.env.OIDC_PEM_PUBLIC_KEY, permittedOrigins, c.env.OIDC_ISSUER);
  if ('error' in authResult) {
    return c.json({ error: "Unauthorized", failReason: authResult.error }, 401);
  }
  const auth = authResult;

  let body: { subdomain?: string; email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.subdomain || !body.email) {
    return c.json({ error: "Missing subdomain or email" }, 400);
  }

  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const normalized = body.subdomain.toLowerCase().trim();
  const record = await kv.getSubdomain(normalized);

  if (!record) {
    return c.json({ error: "Subdomain not found" }, 404);
  }

  // Find invited collaborator by email
  const normalizedEmail = body.email.toLowerCase().trim();
  const collaborator = record.collaborators.find(
    (col) => col.email.toLowerCase() === normalizedEmail && col.status === "invited"
  );

  if (!collaborator) {
    return c.json({ error: "No pending invitation found for this email" }, 404);
  }

  // Activate collaborator
  const updated = activateCollaborator(record, body.email, auth.userId);
  await kv.putSubdomain(normalized, updated);

  // Update user index for the joining user
  const userRecord = await kv.getUser(auth.userId);
  const subdomains = userRecord?.subdomains || [];
  if (!subdomains.includes(normalized)) {
    subdomains.push(normalized);
  }
  await kv.putUser(auth.userId, {
    subdomains,
    quota: userRecord?.quota ?? 3,
  });

  return c.json({ success: true, subdomain: normalized, role: "collaborator" }, 200);
});

// POST /set-ledger - Owner reports their Fireproof ledger ID
app.post("/set-ledger", async (c) => {
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);

  const authResult = await verifyOIDCJWTDebug(authHeader, c.env.OIDC_PEM_PUBLIC_KEY, permittedOrigins, c.env.OIDC_ISSUER);
  if ('error' in authResult) {
    return c.json({ error: "Unauthorized", failReason: authResult.error }, 401);
  }
  const auth = authResult;

  let body: { subdomain?: string; ledgerId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.subdomain || !body.ledgerId) {
    return c.json({ error: "Missing subdomain or ledgerId" }, 400);
  }

  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const normalized = body.subdomain.toLowerCase().trim();
  const record = await kv.getSubdomain(normalized);

  if (!record) {
    return c.json({ error: "Subdomain not found" }, 404);
  }

  if (record.ownerId !== auth.userId) {
    return c.json({ error: "Only the owner can set ledger ID" }, 403);
  }

  // Idempotent: update ledgerId on the record
  record.ledgerId = body.ledgerId;
  await kv.putSubdomain(normalized, record);

  return c.json({ success: true, subdomain: normalized }, 200);
});

// POST /webhook - Subscription webhooks (stub for future Stripe integration)
app.post("/webhook", async (c) => {
  // TODO: Implement Stripe webhook verification and handling in phase 2.
  // Expected events: checkout.session.completed, customer.subscription.updated,
  // customer.subscription.deleted — will freeze/unfreeze subdomains accordingly.
  return c.json({ error: "Webhook handler not yet implemented" }, 501);
});

// POST /api/ai/chat - AI proxy to OpenRouter (authenticated)
app.post("/api/ai/chat", async (c) => {
  // Require authentication to prevent API key abuse
  const authHeader = c.req.header("Authorization");
  const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);
  const authResult = await verifyOIDCJWTDebug(authHeader, c.env.OIDC_PEM_PUBLIC_KEY, permittedOrigins, c.env.OIDC_ISSUER);
  if ('error' in authResult) {
    return c.json({ error: "Unauthorized" }, 401);
  }

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

// GET /resolve/:subdomain - Resolve user's role for a subdomain
app.get("/resolve/:subdomain", async (c) => {
  const subdomain = c.req.param("subdomain").toLowerCase().trim();
  const kv = new RegistryKV(c.env.REGISTRY_KV);
  const record = await kv.getSubdomain(subdomain);

  if (!record) {
    return c.json({ role: "unclaimed", frozen: false });
  }

  const frozen = record.status === 'frozen';

  // Try to get userId from JWT or query param
  let userId: string | undefined = c.req.query("userId");
  const authHeader = c.req.header("Authorization");
  if (authHeader && !userId) {
    try {
      const permittedOrigins = parsePermittedOrigins(c.env.PERMITTED_ORIGINS);
      const authResult = await verifyOIDCJWT(authHeader, c.env.OIDC_PEM_PUBLIC_KEY, permittedOrigins, c.env.OIDC_ISSUER);
      if (authResult) {
        userId = authResult.userId;
      }
    } catch {
      // JWT verification failed — fall through to query params
    }
  }

  const email = c.req.query("email");

  if (userId) {
    const result = hasAccess(record, userId);
    if (result.role !== "none") {
      // For collaborators, find and return their stored ledgerId + inviteId
      if (result.role === "collaborator") {
        const collab = record.collaborators.find(
          (col) => col.userId === userId && col.status === "active"
        );
        return c.json({
          role: result.role, frozen,
          ...((collab?.ledgerId || record.ledgerId) ? { ledgerId: collab?.ledgerId || record.ledgerId } : {}),
          ...(collab?.inviteId ? { inviteId: collab.inviteId } : {})
        });
      }
      // Owner: include record-level ledgerId if set
      return c.json({
        role: result.role, frozen,
        ...(record.ledgerId ? { ledgerId: record.ledgerId } : {})
      });
    }
    // userId had no direct access — check email fallback
    if (email && hasAccessByEmail(record, email)) {
      const invitedCollab = record.collaborators.find(
        (col) => col.email.toLowerCase() === email.toLowerCase().trim()
      );
      return c.json({
        role: "invited", frozen,
        ...((invitedCollab?.ledgerId || record.ledgerId) ? { ledgerId: invitedCollab?.ledgerId || record.ledgerId } : {}),
        ...(invitedCollab?.inviteId ? { inviteId: invitedCollab.inviteId } : {})
      });
    }
    return c.json({ role: "none", frozen });
  }

  if (email) {
    if (hasAccessByEmail(record, email)) {
      const emailCollab = record.collaborators.find(
        (col) => col.email.toLowerCase() === email.toLowerCase().trim()
      );
      return c.json({
        role: "invited", frozen,
        ...((emailCollab?.ledgerId || record.ledgerId) ? { ledgerId: emailCollab?.ledgerId || record.ledgerId } : {}),
        ...(emailCollab?.inviteId ? { inviteId: emailCollab.inviteId } : {})
      });
    }
    return c.json({ role: "none", frozen });
  }

  return c.json({ role: "none", frozen });
});

// 404 for everything else
app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default app;
