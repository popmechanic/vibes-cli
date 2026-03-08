import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
  POCKET_ID: DurableObjectNamespace<PocketIdContainer>;
  POCKET_ID_APP_URL: string;
  POCKET_ID_ENCRYPTION_KEY: string;
  POCKET_ID_STATIC_API_KEY: string;
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
    "https://*.marcus-e.workers.dev/*",
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

// Route all requests to the singleton Pocket ID instance.
// getContainer returns a DurableObjectStub; its fetch() auto-starts the container.
app.all("*", async (c) => {
  const container = getContainer(c.env.POCKET_ID);
  return container.fetch(c.req.raw);
});

export default app;
