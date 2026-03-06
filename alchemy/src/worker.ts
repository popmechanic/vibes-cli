import { Container, getContainer } from "@cloudflare/containers";
import { Hono } from "hono";

interface Env {
  POCKET_ID: DurableObjectNamespace<PocketIdContainer>;
  POCKET_ID_APP_URL: string;
  POCKET_ID_ENCRYPTION_KEY: string;
  POCKET_ID_STATIC_API_KEY: string;
  // Auto-registration config for OIDC clients (survives container restarts)
  POCKET_ID_DEFAULT_CLIENTS?: string; // JSON array of client configs
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

// ---------------------------------------------------------------------------
// OIDC Client Auto-Registration
// ---------------------------------------------------------------------------
// Pocket ID uses ephemeral SQLite inside the container. When the container
// restarts, all OIDC clients are lost. This middleware re-registers them
// from POCKET_ID_DEFAULT_CLIENTS on the first request after a restart.
//
// POCKET_ID_DEFAULT_CLIENTS is a JSON array in wrangler.toml [vars]:
//   [{ "name": "my-app", "callbackURLs": ["https://app.example.com/"], "isPublic": true }]
//
// The middleware calls the container directly via the DO stub, bypassing
// Cloudflare's Worker-to-Worker fetch restriction (error 1042).
// ---------------------------------------------------------------------------

interface OIDCClientConfig {
  name: string;
  callbackURLs: string[];
  isPublic?: boolean;
  pkceEnabled?: boolean;
}

interface PocketIdClient {
  id: string;
  name: string;
  callbackURLs: string[];
  isPublic: boolean;
  pkceEnabled: boolean;
}

let clientsEnsured = false;
let appConfigEnsured = false;

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

async function ensureOIDCClients(
  container: ReturnType<typeof getContainer>,
  apiKey: string,
  clientConfigs: OIDCClientConfig[],
): Promise<void> {
  if (clientsEnsured || clientConfigs.length === 0) return;
  clientsEnsured = true; // Set immediately to prevent re-entry

  try {
    // Fetch existing clients from the container's admin API
    const listRes = await container.fetch("http://internal/api/oidc/clients", {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
    });

    if (!listRes.ok) {
      console.error("[pocket-id] Failed to list OIDC clients:", listRes.status, await listRes.text());
      clientsEnsured = false; // Allow retry
      return;
    }

    const { data: existingClients } = (await listRes.json()) as { data: PocketIdClient[] };
    const existingByName = new Map(existingClients.map((c) => [c.name, c]));

    for (const config of clientConfigs) {
      const existing = existingByName.get(config.name);
      if (existing) {
        console.log(`[pocket-id] OIDC client "${config.name}" already exists (id: ${existing.id})`);

        // Update callback URLs if they've changed
        const existingURLs = new Set(existing.callbackURLs || []);
        const configURLs = new Set(config.callbackURLs);
        const urlsMatch =
          existingURLs.size === configURLs.size &&
          [...existingURLs].every((u) => configURLs.has(u));

        if (!urlsMatch) {
          console.log(`[pocket-id] Updating callback URLs for "${config.name}"`);
          await container.fetch(`http://internal/api/oidc/clients/${existing.id}`, {
            method: "PUT",
            headers: {
              "X-API-Key": apiKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              name: config.name,
              callbackURLs: config.callbackURLs,
              isPublic: config.isPublic ?? true,
              pkceEnabled: config.pkceEnabled ?? true,
            }),
          });
        }
        continue;
      }

      // Create the client
      console.log(`[pocket-id] Creating OIDC client "${config.name}"`);
      const createRes = await container.fetch("http://internal/api/oidc/clients", {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: config.name,
          callbackURLs: config.callbackURLs,
          isPublic: config.isPublic ?? true,
          pkceEnabled: config.pkceEnabled ?? true,
        }),
      });

      if (createRes.ok) {
        const created = (await createRes.json()) as PocketIdClient;
        console.log(`[pocket-id] Created OIDC client "${config.name}" → id: ${created.id}`);

        // If the client was created fresh after a container restart, the app
        // needs the new client ID. Serve it via /.well-known/oidc-clients.
      } else {
        console.error(
          `[pocket-id] Failed to create OIDC client "${config.name}":`,
          createRes.status,
          await createRes.text(),
        );
        clientsEnsured = false; // Allow retry
      }
    }
  } catch (err) {
    console.error("[pocket-id] ensureOIDCClients error:", err);
    clientsEnsured = false; // Allow retry on next request
  }
}

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// Middleware: ensure OIDC clients and app config exist on first request after
// container start. Uses waitUntil so it doesn't block non-OIDC requests. For
// OIDC authorize requests, we await to ensure the client exists first.
app.use("*", async (c, next) => {
  const needsClients = !clientsEnsured;
  const needsConfig = !appConfigEnsured;

  if (needsClients || needsConfig) {
    const apiKey = c.env.POCKET_ID_STATIC_API_KEY;

    if (apiKey) {
      const container = getContainer(c.env.POCKET_ID);
      const url = new URL(c.req.url);
      const isOIDCPath = url.pathname.startsWith("/authorize") || url.pathname.startsWith("/api/oidc");

      // Parse client configs
      let configs: OIDCClientConfig[] = [];
      if (needsClients) {
        const clientsJson = c.env.POCKET_ID_DEFAULT_CLIENTS;
        if (clientsJson) {
          try {
            configs = JSON.parse(clientsJson);
          } catch {
            console.error("[pocket-id] Invalid POCKET_ID_DEFAULT_CLIENTS JSON");
          }
        }
      }

      // Build list of setup tasks
      const tasks: Promise<void>[] = [];
      if (needsConfig) tasks.push(ensureAppConfig(container, apiKey));
      if (needsClients && configs.length > 0) tasks.push(ensureOIDCClients(container, apiKey, configs));

      if (tasks.length > 0) {
        const setupAll = Promise.all(tasks).then(() => undefined);

        if (isOIDCPath) {
          // Block OIDC requests until setup is complete
          await setupAll;
        } else {
          // Run in background for non-OIDC requests
          c.executionCtx.waitUntil(setupAll);
        }
      }
    } else {
      // No API key — skip future checks
      clientsEnsured = true;
      appConfigEnsured = true;
    }
  }
  return next();
});

// Serve current OIDC client IDs so apps can discover them after container restart.
// Returns { clients: [{ id, name, callbackURLs }] }
app.get("/.well-known/oidc-clients", async (c) => {
  const container = getContainer(c.env.POCKET_ID);
  const apiKey = c.env.POCKET_ID_STATIC_API_KEY;

  if (!apiKey) {
    return c.json({ error: "No API key configured" }, 500);
  }

  const res = await container.fetch("http://internal/api/oidc/clients", {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });

  if (!res.ok) {
    return c.json({ error: "Failed to list clients" }, 502);
  }

  const { data } = (await res.json()) as { data: PocketIdClient[] };
  return c.json({
    clients: data.map((cl) => ({
      id: cl.id,
      name: cl.name,
      callbackURLs: cl.callbackURLs,
    })),
  });
});

// Route all requests to the singleton Pocket ID instance.
// getContainer returns a DurableObjectStub; its fetch() auto-starts the container.
app.all("*", async (c) => {
  const container = getContainer(c.env.POCKET_ID);
  return container.fetch(c.req.raw);
});

export default app;
