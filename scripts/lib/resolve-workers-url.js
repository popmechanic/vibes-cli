#!/usr/bin/env node
/**
 * Resolve the full Cloudflare Workers URL for an app.
 *
 * Usage:
 *   node scripts/lib/resolve-workers-url.js --name my-app
 *
 * Output (stdout):
 *   my-app.marcus-e.workers.dev
 *
 * Exit codes:
 *   0 — success
 *   1 — resolution failed (prints error to stderr)
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";

/**
 * Parse the 32-char hex account ID from `npx wrangler whoami` table output.
 * Looks for a row with a 32-character hex string.
 */
export function parseAccountId(whoamiOutput) {
  const match = whoamiOutput.match(/\b([0-9a-f]{32})\b/);
  return match ? match[1] : null;
}

/**
 * Return the platform-specific path to the wrangler oauth config file.
 *   macOS:  ~/Library/Preferences/.wrangler/config/default.toml
 *   Linux:  ~/.config/.wrangler/config/default.toml
 */
export function wranglerConfigPath() {
  if (platform() === "darwin") {
    return join(homedir(), "Library/Preferences/.wrangler/config/default.toml");
  }
  return join(homedir(), ".config/.wrangler/config/default.toml");
}

/**
 * Parse the oauth_token value from a wrangler TOML config string.
 */
export function parseOauthToken(tomlContent) {
  const match = tomlContent.match(/^oauth_token\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

/**
 * Resolve the workers.dev subdomain for a Cloudflare account.
 * Calls: GET /accounts/{account_id}/workers/subdomain
 */
export async function resolveSubdomain(accountId, oauthToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${oauthToken}` },
  });
  if (!resp.ok) {
    throw new Error(`CF API returned ${resp.status}: ${resp.statusText}`);
  }
  const body = await resp.json();
  if (!body.success || !body.result?.subdomain) {
    throw new Error("CF API did not return a subdomain");
  }
  return body.result.subdomain;
}

/**
 * Full resolution pipeline: whoami → token → API → full URL.
 * Returns "{appName}.{subdomain}.workers.dev"
 */
export async function resolveWorkersUrl(appName) {
  // 1. Get account ID from wrangler whoami
  const whoami = execSync("npx wrangler whoami 2>&1", { encoding: "utf8" });
  const accountId = parseAccountId(whoami);
  if (!accountId) {
    throw new Error("Could not parse account ID from wrangler whoami");
  }

  // 2. Read oauth token from config
  const configPath = wranglerConfigPath();
  let toml;
  try {
    toml = readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`Could not read wrangler config at ${configPath}`);
  }
  const token = parseOauthToken(toml);
  if (!token) {
    throw new Error("Could not parse oauth_token from wrangler config");
  }

  // 3. Call CF API for subdomain
  const subdomain = await resolveSubdomain(accountId, token);

  return `${appName}.${subdomain}.workers.dev`;
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))) {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf("--name");
  if (nameIdx === -1 || !args[nameIdx + 1]) {
    console.error("Usage: resolve-workers-url.js --name <app-name>");
    process.exit(1);
  }
  const appName = args[nameIdx + 1];

  resolveWorkersUrl(appName)
    .then((url) => {
      console.log(url);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
