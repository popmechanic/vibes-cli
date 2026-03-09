import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
  POCKET_ID: DurableObjectNamespace<PocketIdContainer>;
  POCKET_ID_APP_URL: string;
  POCKET_ID_ENCRYPTION_KEY: string;
  POCKET_ID_STATIC_API_KEY: string;
  BACKUP_BUCKET: R2Bucket;
  R2_BUCKET_NAME: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

/**
 * Pocket ID container class.
 *
 * Routes all HTTP traffic to the Pocket ID OIDC provider running on port 1411.
 * A single instance serves all requests (singleton pattern) since Pocket ID
 * uses SQLite and needs consistent state within a session.
 *
 * APP_URL and ENCRYPTION_KEY are passed from Worker env vars into the container
 * via the envVars getter. The Container base class (a Durable Object) receives
 * the Worker's `env` in its constructor.
 */
export class PocketIdContainer extends Container {
  defaultPort = 1411;
  sleepAfter = "30m";

  // Static container env vars. APP_URL and ENCRYPTION_KEY are set dynamically
  // in the constructor from Worker env bindings.
  envVars: Record<string, string> = {
    TRUST_PROXY: "true",
    PORT: "1411",
    HOST: "0.0.0.0",
    DB_CONNECTION_STRING: "data/pocket-id.db",
  };

  constructor(ctx: DurableObjectState<any>, env: Env) {
    super(ctx, env);
    // Pull dynamic config from Worker env vars into container env
    if (env.POCKET_ID_APP_URL) {
      this.envVars.APP_URL = env.POCKET_ID_APP_URL;
    }
    if (env.POCKET_ID_ENCRYPTION_KEY) {
      this.envVars.ENCRYPTION_KEY = env.POCKET_ID_ENCRYPTION_KEY;
    }
    if (env.POCKET_ID_STATIC_API_KEY) {
      this.envVars.STATIC_API_KEY = env.POCKET_ID_STATIC_API_KEY;
    }
    // R2 credentials for FUSE mount inside container
    if (env.R2_ACCESS_KEY_ID) this.envVars.R2_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID;
    if (env.R2_SECRET_ACCESS_KEY) this.envVars.R2_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY;
    if (env.R2_BUCKET_NAME) this.envVars.R2_BUCKET_NAME = env.R2_BUCKET_NAME;
    if (env.R2_ACCOUNT_ID) this.envVars.R2_ACCOUNT_ID = env.R2_ACCOUNT_ID;
    // Bootstrap-friendly defaults: open signups, email login codes enabled.
    // These env vars seed Pocket ID's SQLite config on first boot.
    this.envVars.ALLOW_USER_SIGNUPS = "open";
    this.envVars.EMAIL_ONE_TIME_ACCESS_AS_ADMIN_ENABLED = "true";
    this.envVars.EMAIL_ONE_TIME_ACCESS_AS_UNAUTHENTICATED_ENABLED = "true";
    this.envVars.SESSION_DURATION = "480"; // 8 hours
  }

  override onStart() {
    console.log("[pocket-id] Container started");
  }

  override onStop() {
    console.log("[pocket-id] Container stopped");
  }

  override onError(error: unknown) {
    console.error("[pocket-id] Container error:", error);
  }
}

let appConfigEnsured = false;
let oidcClientsEnsured = false;

// ---------------------------------------------------------------------------
// OIDC Client Registration
// ---------------------------------------------------------------------------
// The shared Vibes OIDC client must exist in Pocket ID's SQLite DB for auth
// to work. On container restart, all client registrations are lost. This
// function re-creates the client via the admin API on first request.
// ---------------------------------------------------------------------------

const VIBES_OIDC_CLIENT = {
  id: "6c154be6-e6fa-47f3-ad2b-31740cedc1f1",
  name: "vibes-cli",
  callbackURLs: [
    "http://localhost/callback",
    "http://127.0.0.1/callback",
    "http://localhost:18192/callback",
    "http://127.0.0.1:18192/callback",
    "https://*.vibesos.com/**",
    "https://*.marcus-e.workers.dev/**",  // legacy — remove after migration
  ],
  isPublic: true,
};

async function ensureOIDCClients(
  container: ReturnType<typeof getContainer>,
  apiKey: string,
): Promise<void> {
  if (oidcClientsEnsured) return;
  oidcClientsEnsured = true; // Prevent re-entry

  try {
    // Check if client already exists
    const getRes = await container.fetch(
      `http://internal/api/oidc/clients/${VIBES_OIDC_CLIENT.id}`,
      {
        headers: { "X-API-Key": apiKey, Accept: "application/json" },
      },
    );

    if (getRes.ok) {
      // Client exists — update callback URLs in case they changed
      const updateRes = await container.fetch(
        `http://internal/api/oidc/clients/${VIBES_OIDC_CLIENT.id}`,
        {
          method: "PUT",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(VIBES_OIDC_CLIENT),
        },
      );
      if (updateRes.ok) {
        console.log("[pocket-id] OIDC client updated with current callback URLs");
      } else {
        console.warn("[pocket-id] OIDC client update failed:", updateRes.status);
      }
      return;
    }

    // Client doesn't exist — create it
    console.log("[pocket-id] Registering OIDC client:", VIBES_OIDC_CLIENT.name);
    const createRes = await container.fetch("http://internal/api/oidc/clients", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(VIBES_OIDC_CLIENT),
    });

    if (createRes.ok) {
      const created = await createRes.json() as Record<string, unknown>;
      console.log("[pocket-id] OIDC client registered, id:", created.id || VIBES_OIDC_CLIENT.id);
      // If Pocket ID assigned a different ID, log it prominently
      if (created.id && created.id !== VIBES_OIDC_CLIENT.id) {
        console.warn(
          `[pocket-id] WARNING: Pocket ID assigned client ID "${created.id}" ` +
          `instead of requested "${VIBES_OIDC_CLIENT.id}". ` +
          `Update auth-constants.js to match!`,
        );
      }
    } else {
      const errText = await createRes.text();
      console.error("[pocket-id] Failed to register OIDC client:", createRes.status, errText);
      oidcClientsEnsured = false;
    }
  } catch (err) {
    console.error("[pocket-id] ensureOIDCClients error:", err);
    oidcClientsEnsured = false;
  }
}

// ---------------------------------------------------------------------------
// Application Configuration
// ---------------------------------------------------------------------------
// Pocket ID stores application config (signups, email login codes, etc.) in
// SQLite. On container restart, these reset to restrictive defaults even when
// env vars are set. This function updates the config via the admin API to
// ensure the instance is bootstrap-friendly (open signups, email codes).
// ---------------------------------------------------------------------------

interface AppConfigItem {
  key: string;
  value: string;
  type?: string;
}

async function ensureAppConfig(
  container: ReturnType<typeof getContainer>,
  apiKey: string,
): Promise<void> {
  if (appConfigEnsured) return;
  appConfigEnsured = true; // Prevent re-entry

  try {
    // Read current config
    const getRes = await container.fetch("http://internal/api/application-configuration", {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    });

    if (!getRes.ok) {
      console.error("[pocket-id] Failed to read app config:", getRes.status);
      appConfigEnsured = false;
      return;
    }

    const currentConfig = (await getRes.json()) as AppConfigItem[];
    const configMap = new Map(currentConfig.map((c) => [c.key, c.value]));

    // Desired overrides (keys from Pocket ID's application-configuration API)
    const desired: Record<string, string> = {
      allowUserSignups: "open",
      emailOneTimeAccessAsAdminEnabled: "true",
      emailOneTimeAccessAsUnauthenticatedEnabled: "true",
      requireUserEmail: "false",
    };

    // Check if any need updating
    const needsUpdate = Object.entries(desired).some(
      ([k, v]) => configMap.get(k) !== v,
    );

    if (!needsUpdate) {
      console.log("[pocket-id] App config already correct");
      return;
    }

    // Build complete config for PUT (it requires ALL fields)
    // Start from current values, then apply our overrides
    for (const [k, v] of Object.entries(desired)) {
      configMap.set(k, v);
    }

    // Pocket ID v2 PUT expects ALL fields as strings with camelCase JSON keys.
    // The GET returns key/value pairs — build a flat object from them.
    const putBody: Record<string, string> = {};
    for (const [k, v] of configMap) {
      putBody[k] = v;
    }

    // Add required fields that GET may not return
    if (!putBody.sessionDuration) putBody.sessionDuration = "480";
    if (!putBody.emailsVerified) putBody.emailsVerified = "false";
    if (!putBody.smtpTls) putBody.smtpTls = "none";
    if (!putBody.emailLoginNotificationEnabled) putBody.emailLoginNotificationEnabled = "false";
    if (!putBody.emailApiKeyExpirationEnabled) putBody.emailApiKeyExpirationEnabled = "false";

    console.log("[pocket-id] Updating app config:", JSON.stringify(putBody));
    const putRes = await container.fetch("http://internal/api/application-configuration", {
      method: "PUT",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(putBody),
    });

    if (putRes.ok) {
      console.log("[pocket-id] App config updated successfully");
    } else {
      const errText = await putRes.text();
      console.error("[pocket-id] Failed to update app config:", putRes.status, errText);
      // Don't reset appConfigEnsured — the env vars should have seeded correct values
      // on fresh boot. The API update is belt-and-suspenders.
    }
  } catch (err) {
    console.error("[pocket-id] ensureAppConfig error:", err);
    appConfigEnsured = false;
  }
}

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// Middleware: ensure app config is correct on first request after container start.
// Uses waitUntil so it doesn't block non-config requests.
app.use("*", async (c, next) => {
  const needsConfig = !appConfigEnsured;
  const needsClients = !oidcClientsEnsured;

  if (needsConfig || needsClients) {
    const apiKey = c.env.POCKET_ID_STATIC_API_KEY;

    if (apiKey) {
      const container = getContainer(c.env.POCKET_ID);
      // OIDC client must exist before /authorize can work — await it.
      // App config can run in background (env vars provide defaults).
      if (needsClients) {
        await ensureOIDCClients(container, apiKey);
      }
      if (needsConfig) {
        c.executionCtx.waitUntil(ensureAppConfig(container, apiKey));
      }
    } else {
      // No API key — skip future checks
      appConfigEnsured = true;
      oidcClientsEnsured = true;
    }
  }
  return next();
});

// ---------------------------------------------------------------------------
// Backup Admin Routes
// ---------------------------------------------------------------------------
// Authenticated endpoints for managing the R2 database backup.
// All require X-API-Key header matching POCKET_ID_STATIC_API_KEY.
// ---------------------------------------------------------------------------

const BACKUP_KEY = "pocket-id.db";

function requireApiKey(c: any): boolean {
  const apiKey = c.req.header("X-API-Key");
  return apiKey === c.env.POCKET_ID_STATIC_API_KEY;
}

app.get("/__internal/backup/status", async (c) => {
  if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

  const obj = await c.env.BACKUP_BUCKET.head(BACKUP_KEY);
  if (!obj) {
    return c.json({ hasBackup: false });
  }
  return c.json({
    hasBackup: true,
    size: obj.size,
    lastModified: obj.uploaded?.toISOString() ?? null,
  });
});

app.get("/__internal/backup/download", async (c) => {
  if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

  const obj = await c.env.BACKUP_BUCKET.get(BACKUP_KEY);
  if (!obj) {
    return c.json({ error: "No backup found" }, 404);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${BACKUP_KEY}"`,
      "Content-Length": obj.size.toString(),
    },
  });
});

app.delete("/__internal/backup", async (c) => {
  if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

  await c.env.BACKUP_BUCKET.delete(BACKUP_KEY);
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Application Image Routes
// ---------------------------------------------------------------------------
// Pocket ID crashes (500) when serving images that don't exist. We intercept
// these routes at the Worker level:
//
// GET  → serve from R2; return 1x1 transparent PNG if missing (no console errors)
// PUT  → proxy to container (admin panel uploads via session cookies)
//        then cache the uploaded image to R2 for persistence
// POST → same as PUT (admin panel may use either method)
//
// CLI upload: curl -X PUT with X-API-Key stores directly to R2.
// ---------------------------------------------------------------------------

const IMAGE_PREFIX = "images/";

// 1x1 transparent PNG (68 bytes) — prevents console errors for missing images
const TRANSPARENT_PIXEL = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

app.on(["PUT", "POST"], "/api/application-images/:key", async (c) => {
  const key = c.req.param("key");
  const container = getContainer(c.env.POCKET_ID);

  // If request has X-API-Key, store directly to R2 (CLI upload)
  if (c.req.header("X-API-Key")) {
    const contentType = c.req.header("Content-Type") || "image/png";
    const body = await c.req.arrayBuffer();
    await c.env.BACKUP_BUCKET.put(`${IMAGE_PREFIX}${key}`, body, {
      httpMetadata: { contentType },
    });
    return c.json({ ok: true, key });
  }

  // Otherwise proxy to container (admin panel with session cookies)
  const containerRes = await container.fetch(c.req.raw);

  // If upload succeeded, cache the image to R2
  if (containerRes.ok) {
    c.executionCtx.waitUntil((async () => {
      try {
        // Fetch the newly uploaded image from the container
        const imgRes = await container.fetch(
          `http://internal/api/application-images/${key}`,
        );
        if (imgRes.ok) {
          const body = await imgRes.arrayBuffer();
          const contentType = imgRes.headers.get("Content-Type") || "image/png";
          await c.env.BACKUP_BUCKET.put(`${IMAGE_PREFIX}${key}`, body, {
            httpMetadata: { contentType },
          });
          console.log(`[pocket-id] Cached image "${key}" to R2`);
        }
      } catch (err) {
        console.error(`[pocket-id] Failed to cache image "${key}":`, err);
      }
    })());
  }

  return containerRes;
});

app.get("/api/application-images/:key", async (c) => {
  const key = c.req.param("key");
  const obj = await c.env.BACKUP_BUCKET.get(`${IMAGE_PREFIX}${key}`);

  if (obj) {
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // No image in R2 — return transparent pixel instead of 404/500
  return new Response(TRANSPARENT_PIXEL, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
    },
  });
});

// Route all requests to the singleton Pocket ID instance.
// getContainer returns a DurableObjectStub; its fetch() auto-starts the container.
app.all("*", async (c) => {
  const container = getContainer(c.env.POCKET_ID);
  return container.fetch(c.req.raw);
});

export default app;
