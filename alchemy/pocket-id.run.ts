import alchemy from "alchemy";
import { Container, Worker } from "alchemy/cloudflare";
import { SQLiteStateStore } from "alchemy/state";
import { randomBytes } from "crypto";
import type { PocketIdContainer } from "./src/worker.ts";

const stage = process.env.ALCHEMY_STAGE || "dev";

const app = await alchemy("vibes-pocket-id", {
  stage,
  stateStore: (scope) => new SQLiteStateStore(scope),
});

// Generate a stable encryption key for Pocket ID data-at-rest.
// On first deploy this creates a new key; Alchemy state preserves it across
// subsequent deploys so Pocket ID can decrypt its SQLite data.
const encryptionKey =
  process.env.POCKET_ID_ENCRYPTION_KEY || randomBytes(32).toString("base64");

// APP_URL tells Pocket ID its own public origin (for OIDC issuer, redirects).
// On first deploy you won't know the Worker URL yet — deploy once, grab the URL
// from output, then redeploy with POCKET_ID_APP_URL set.
// If unset, Pocket ID falls back to http://localhost:1411 which won't work for
// real OIDC flows but allows the container to start.
const appUrl = process.env.POCKET_ID_APP_URL || "";

const container = await Container<PocketIdContainer>("pocket-id", {
  className: "PocketIdContainer",
  image: "ghcr.io/pocket-id/pocket-id:v2",
  maxInstances: 1,
  instanceType: "basic",
  adopt: true,
});

const worker = await Worker("pocket-id-worker", {
  entrypoint: "src/worker.ts",
  adopt: true,
  bindings: {
    POCKET_ID: container,
  },
  env: {
    // These are Worker env vars (accessible in the Worker), not container env vars.
    // Container env vars are set in the PocketIdContainer class (envVars getter).
    // We store config here so the Worker can pass APP_URL to the container if needed.
    POCKET_ID_APP_URL: appUrl,
    POCKET_ID_ENCRYPTION_KEY: encryptionKey,
  },
});

console.log(`\nPocket ID Worker URL: ${worker.url}`);
console.log(`Stage: ${stage}`);
console.log(`Encryption Key: ${encryptionKey}`);

if (appUrl) {
  console.log(`APP_URL: ${appUrl}`);
} else {
  console.log(
    `\nNote: POCKET_ID_APP_URL not set. After first deploy, redeploy with:`
  );
  console.log(
    `  POCKET_ID_APP_URL=${worker.url} npm run deploy`
  );
}

await app.finalize();
