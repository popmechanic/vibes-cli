/**
 * Server-side Connect provisioning via Cloudflare REST API.
 * Creates R2 bucket, D1 databases, AccountApiToken, and deploys
 * cloud-backend + dashboard Workers for each app.
 */

import { generateSessionTokens, generateDeviceCAKeys } from './crypto';
import type { ConnectInfo } from './types';

const CF_API = 'https://api.cloudflare.com/client/v4';

interface ProvisionParams {
  accountId: string;
  apiToken: string;
  stage: string;
  oidcAuthority: string;
  oidcServiceWorkerName: string;
  cloudBackendBundle: string;
  dashboardBundle: string;
  /** Pre-created R2 S3-compatible credentials (shared across all apps) */
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  /** Service API key for machine-to-machine auth (public link join flow) */
  serviceApiKey?: string;
}

interface CFApiResponse<T = unknown> {
  success: boolean;
  result: T;
  errors?: Array<{ code: number; message: string }>;
}

// --- Migration SQL ---

export const BACKEND_MIGRATION_SQL = `-- Fireproof Cloud Backend D1 Schema
CREATE TABLE IF NOT EXISTS Tenant(
  tenant TEXT NOT NULL PRIMARY KEY,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS TenantLedger(
  tenant TEXT NOT NULL,
  ledger TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(tenant, ledger),
  FOREIGN KEY(tenant) REFERENCES Tenant(tenant)
);

CREATE TABLE IF NOT EXISTS KeyByTenantLedger(
  tenant TEXT NOT NULL,
  ledger TEXT NOT NULL,
  key TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (tenant, ledger, key),
  FOREIGN KEY (tenant, ledger) REFERENCES TenantLedger(tenant, ledger)
);

CREATE TABLE IF NOT EXISTS MetaByTenantLedger(
  tenant TEXT NOT NULL,
  ledger TEXT NOT NULL,
  metaCID TEXT NOT NULL,
  meta TEXT NOT NULL,
  reqId TEXT NOT NULL,
  resId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (tenant, ledger, metaCID),
  FOREIGN KEY (tenant, ledger) REFERENCES TenantLedger(tenant, ledger)
);

CREATE INDEX IF NOT EXISTS "MetaByTenantLedger-ReqIdResId" ON MetaByTenantLedger(tenant, ledger, reqId, resId);

CREATE TABLE IF NOT EXISTS MetaSend(
  metaCID TEXT NOT NULL,
  tenant TEXT NOT NULL,
  ledger TEXT NOT NULL,
  reqId TEXT NOT NULL,
  resId TEXT NOT NULL,
  sendAt TEXT NOT NULL,
  PRIMARY KEY(metaCID, tenant, ledger, reqId, resId),
  FOREIGN KEY(tenant, ledger, metaCID) REFERENCES MetaByTenantLedger(tenant, ledger, metaCID)
);`;

export const DASHBOARD_MIGRATION_SQL = `CREATE TABLE \`AppIdBinding\` (
	\`appId\` text NOT NULL,
	\`env\` text NOT NULL,
	\`ledgerId\` text NOT NULL,
	\`tenantId\` text NOT NULL,
	\`createdAt\` text NOT NULL,
	PRIMARY KEY(\`appId\`, \`env\`),
	FOREIGN KEY (\`ledgerId\`) REFERENCES \`Ledgers\`(\`ledgerId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`tenantId\`) REFERENCES \`Tenants\`(\`tenantId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE \`InviteTickets\` (
	\`inviteId\` text PRIMARY KEY NOT NULL,
	\`inviterUserId\` text NOT NULL,
	\`status\` text NOT NULL,
	\`statusReason\` text DEFAULT 'just invited' NOT NULL,
	\`invitedUserId\` text,
	\`queryProvider\` text,
	\`queryEmail\` text,
	\`queryNick\` text,
	\`sendEmailCount\` integer NOT NULL,
	\`invitedTenantId\` text,
	\`invitedLedgerId\` text,
	\`invitedParams\` text NOT NULL,
	\`expiresAfter\` text NOT NULL,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL,
	FOREIGN KEY (\`inviterUserId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`invitedUserId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`invitedTenantId\`) REFERENCES \`Tenants\`(\`tenantId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`invitedLedgerId\`) REFERENCES \`Ledgers\`(\`ledgerId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX \`invitesEmail\` ON \`InviteTickets\` (\`queryEmail\`);
--> statement-breakpoint
CREATE INDEX \`invitesNick\` ON \`InviteTickets\` (\`queryNick\`);
--> statement-breakpoint
CREATE INDEX \`invitesExpiresAfter\` ON \`InviteTickets\` (\`expiresAfter\`);
--> statement-breakpoint
CREATE TABLE \`LedgerUsers\` (
	\`ledgerId\` text NOT NULL,
	\`userId\` text NOT NULL,
	\`role\` text NOT NULL,
	\`right\` text NOT NULL,
	\`default\` integer NOT NULL,
	\`status\` text DEFAULT 'active' NOT NULL,
	\`statusReason\` text DEFAULT 'just created' NOT NULL,
	\`name\` text,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL,
	PRIMARY KEY(\`ledgerId\`, \`userId\`, \`role\`),
	FOREIGN KEY (\`ledgerId\`) REFERENCES \`Ledgers\`(\`ledgerId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`userId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX \`luUserIdx\` ON \`LedgerUsers\` (\`userId\`);
--> statement-breakpoint
CREATE TABLE \`Ledgers\` (
	\`ledgerId\` text PRIMARY KEY NOT NULL,
	\`tenantId\` text NOT NULL,
	\`ownerId\` text NOT NULL,
	\`name\` text NOT NULL,
	\`status\` text DEFAULT 'active' NOT NULL,
	\`statusReason\` text DEFAULT 'just created' NOT NULL,
	\`maxShares\` integer DEFAULT 5 NOT NULL,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL,
	FOREIGN KEY (\`tenantId\`) REFERENCES \`Tenants\`(\`tenantId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`ownerId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`ledgerNamespace\` ON \`Ledgers\` (\`tenantId\`,\`name\`);
--> statement-breakpoint
CREATE TABLE \`TenantUsers\` (
	\`userId\` text NOT NULL,
	\`tenantId\` text NOT NULL,
	\`name\` text,
	\`role\` text NOT NULL,
	\`status\` text DEFAULT 'active' NOT NULL,
	\`statusReason\` text DEFAULT 'just created' NOT NULL,
	\`default\` integer NOT NULL,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL,
	PRIMARY KEY(\`userId\`, \`tenantId\`),
	FOREIGN KEY (\`userId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`tenantId\`) REFERENCES \`Tenants\`(\`tenantId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE \`Tenants\` (
	\`tenantId\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`ownerUserId\` text NOT NULL,
	\`maxAdminUsers\` integer DEFAULT 5 NOT NULL,
	\`maxMemberUsers\` integer DEFAULT 5 NOT NULL,
	\`maxInvites\` integer DEFAULT 10 NOT NULL,
	\`maxLedgers\` integer DEFAULT 5 NOT NULL,
	\`status\` text DEFAULT 'active' NOT NULL,
	\`statusReason\` text DEFAULT 'just created' NOT NULL,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL,
	FOREIGN KEY (\`ownerUserId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE \`TokenByResultId\` (
	\`resultId\` text PRIMARY KEY NOT NULL,
	\`status\` text NOT NULL,
	\`token\` text,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`UserByProviders\` (
	\`userId\` text NOT NULL,
	\`providerUserId\` text NOT NULL,
	\`queryProvider\` text NOT NULL,
	\`queryEmail\` text,
	\`cleanEmail\` text,
	\`queryNick\` text,
	\`cleanNick\` text,
	\`params\` text NOT NULL,
	\`used\` text NOT NULL,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL,
	PRIMARY KEY(\`userId\`, \`providerUserId\`),
	FOREIGN KEY (\`userId\`) REFERENCES \`Users\`(\`userId\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`UserByProviders_providerUserId_unique\` ON \`UserByProviders\` (\`providerUserId\`);
--> statement-breakpoint
CREATE INDEX \`queryEmailIdx\` ON \`UserByProviders\` (\`queryEmail\`);
--> statement-breakpoint
CREATE INDEX \`queryNickIdx\` ON \`UserByProviders\` (\`queryNick\`);
--> statement-breakpoint
CREATE TABLE \`Users\` (
	\`userId\` text PRIMARY KEY NOT NULL,
	\`maxTenants\` integer DEFAULT 5 NOT NULL,
	\`status\` text DEFAULT 'active' NOT NULL,
	\`statusReason\` text,
	\`createdAt\` text NOT NULL,
	\`updatedAt\` text NOT NULL
);`;

// --- CF API Helpers ---

async function cfApi<T = unknown>(
  path: string,
  apiToken: string,
  options: RequestInit = {},
): Promise<CFApiResponse<T>> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res.json() as Promise<CFApiResponse<T>>;
}

async function createR2Bucket(accountId: string, apiToken: string, name: string): Promise<string> {
  const res = await cfApi(`/accounts/${accountId}/r2/buckets`, apiToken, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  // 10004 = "bucket already exists and you own it" — idempotent
  if (!res.success && res.errors?.[0]?.code !== 10004) {
    throw new Error(`R2 bucket creation failed: ${JSON.stringify(res.errors)}`);
  }

  // Set CORS rules so browsers can read/write via pre-signed URLs
  await cfApi(`/accounts/${accountId}/r2/buckets/${name}/cors`, apiToken, {
    method: 'PUT',
    body: JSON.stringify({
      rules: [{
        allowed: {
          origins: ['*'],
          methods: ['GET', 'PUT', 'HEAD'],
          headers: ['*'],
        },
        maxAgeSeconds: 3600,
      }],
    }),
  });

  return name;
}

async function createD1Database(
  accountId: string,
  apiToken: string,
  name: string,
): Promise<string> {
  const res = await cfApi<{ uuid: string }>(`/accounts/${accountId}/d1/database`, apiToken, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res.success) {
    // 7502 = database already exists — look up by name
    if (res.errors?.[0]?.code === 7502) {
      const listRes = await cfApi<Array<{ uuid: string; name: string }>>(
        `/accounts/${accountId}/d1/database?name=${encodeURIComponent(name)}`,
        apiToken,
      );
      const existing = listRes.result?.find((db) => db.name === name);
      if (existing) return existing.uuid;
    }
    throw new Error(`D1 database creation failed for ${name}: ${JSON.stringify(res.errors)}`);
  }
  return res.result.uuid;
}

async function runD1Migration(
  accountId: string,
  apiToken: string,
  databaseId: string,
  sql: string,
): Promise<void> {
  // Split on Drizzle's statement-breakpoint separator
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // Make idempotent: add IF NOT EXISTS to CREATE TABLE/INDEX
    .map((s) => s
      .replace(/CREATE TABLE(?!\s+IF\s+NOT\s+EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS')
      .replace(/CREATE UNIQUE INDEX(?!\s+IF\s+NOT\s+EXISTS)/gi, 'CREATE UNIQUE INDEX IF NOT EXISTS')
      .replace(/CREATE INDEX(?!\s+IF\s+NOT\s+EXISTS)/gi, 'CREATE INDEX IF NOT EXISTS'),
    );

  for (const statement of statements) {
    const res = await cfApi(`/accounts/${accountId}/d1/database/${databaseId}/query`, apiToken, {
      method: 'POST',
      body: JSON.stringify({ sql: statement }),
    });
    if (!res.success) {
      throw new Error(`D1 migration failed: ${JSON.stringify(res.errors)}\nSQL: ${statement.slice(0, 100)}`);
    }
  }
}

async function uploadWorker(
  accountId: string,
  apiToken: string,
  scriptName: string,
  scriptContent: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const form = new FormData();

  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  );
  form.append(
    'worker.js',
    new Blob([scriptContent], { type: 'application/javascript+module' }),
    'worker.js',
  );

  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${apiToken}` },
      body: form,
    },
  );
  const json = (await res.json()) as CFApiResponse;
  if (!json.success) {
    // 10079 = DO migration tag precondition failed (Worker already exists with DO)
    // Retry without migrations block for re-uploads
    if (json.errors?.[0]?.code === 10079 && metadata.migrations) {
      const retryMeta = { ...metadata };
      delete retryMeta.migrations;
      return uploadWorker(accountId, apiToken, scriptName, scriptContent, retryMeta);
    }
    throw new Error(`Worker upload failed for ${scriptName}: ${JSON.stringify(json.errors)}`);
  }
}

async function enableWorkerSubdomain(
  accountId: string,
  apiToken: string,
  scriptName: string,
): Promise<void> {
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true }),
    },
  );
  const json = (await res.json()) as CFApiResponse;
  if (!json.success) {
    throw new Error(`Subdomain enable failed for ${scriptName}: ${JSON.stringify(json.errors)}`);
  }
}

async function getWorkersSubdomain(accountId: string, apiToken: string): Promise<string> {
  const res = await cfApi<{ subdomain: string }>(
    `/accounts/${accountId}/workers/subdomain`,
    apiToken,
  );
  if (!res.success) {
    throw new Error(`Workers subdomain lookup failed: ${JSON.stringify(res.errors)}`);
  }
  return res.result.subdomain;
}

// --- Main Provisioning Function ---

export async function provisionConnect(params: ProvisionParams): Promise<ConnectInfo> {
  const {
    accountId,
    apiToken,
    stage,
    oidcAuthority,
    oidcServiceWorkerName,
    cloudBackendBundle,
    dashboardBundle,
    r2AccessKeyId,
    r2SecretAccessKey,
    serviceApiKey,
  } = params;

  const cloudBackendName = `fireproof-cloud-${stage}`;
  const dashboardName = `fireproof-dashboard-${stage}`;
  const r2BucketName = `fp-storage-${stage}`;
  const backendD1Name = `fp-meta-${stage}`;
  const dashboardD1Name = `fp-connect-${stage}`;

  // 1. Create R2 bucket
  await createR2Bucket(accountId, apiToken, r2BucketName);

  // 2. Create D1 databases and run migrations
  const d1BackendId = await createD1Database(accountId, apiToken, backendD1Name);
  await runD1Migration(accountId, apiToken, d1BackendId, BACKEND_MIGRATION_SQL);

  const d1DashboardId = await createD1Database(accountId, apiToken, dashboardD1Name);
  await runD1Migration(accountId, apiToken, d1DashboardId, DASHBOARD_MIGRATION_SQL);

  // 4. Generate crypto tokens
  const sessionTokens = await generateSessionTokens();
  const deviceCA = await generateDeviceCAKeys();

  const storageUrl = `https://${accountId}.r2.cloudflarestorage.com/${r2BucketName}`;

  // 5. Deploy cloud-backend Worker
  await uploadWorker(accountId, apiToken, cloudBackendName, cloudBackendBundle, {
    main_module: 'worker.js',
    compatibility_date: '2025-02-24',
    bindings: [
      { type: 'r2_bucket', name: 'FP_STORAGE', bucket_name: r2BucketName },
      { type: 'd1', name: 'FP_BACKEND_D1', id: d1BackendId },
      {
        type: 'durable_object_namespace',
        name: 'FP_WS_ROOM',
        class_name: 'FPRoomDurableObject',
      },
      { type: 'plain_text', name: 'VERSION', text: 'FP-MSG-1.0' },
      { type: 'plain_text', name: 'FP_DEBUG', text: 'true' },
      { type: 'plain_text', name: 'MAX_IDLE_TIME', text: '300' },
      { type: 'secret_text', name: 'CLOUD_SESSION_TOKEN_PUBLIC', text: sessionTokens.publicEnv },
      { type: 'plain_text', name: 'STORAGE_URL', text: storageUrl },
      { type: 'secret_text', name: 'ACCESS_KEY_ID', text: r2AccessKeyId },
      { type: 'secret_text', name: 'SECRET_ACCESS_KEY', text: r2SecretAccessKey },
      { type: 'plain_text', name: 'REGION', text: 'auto' },
    ],
    migrations: {
      new_tag: 'v1',
      new_classes: ['FPRoomDurableObject'],
    },
  });
  await enableWorkerSubdomain(accountId, apiToken, cloudBackendName);

  // 6. Deploy dashboard Worker
  await uploadWorker(accountId, apiToken, dashboardName, dashboardBundle, {
    main_module: 'worker.js',
    compatibility_date: '2025-02-24',
    bindings: [
      { type: 'd1', name: 'DB', id: d1DashboardId },
      { type: 'service', name: 'OIDC_SERVICE', service: oidcServiceWorkerName },
      { type: 'secret_text', name: 'OIDC_AUTHORITY', text: oidcAuthority },
      { type: 'secret_text', name: 'CLERK_PUBLISHABLE_KEY', text: oidcAuthority },
      {
        type: 'secret_text',
        name: 'CLERK_PUB_JWT_URL',
        text: `${oidcAuthority}/.well-known/jwks.json`,
      },
      { type: 'secret_text', name: 'CLOUD_SESSION_TOKEN_PUBLIC', text: sessionTokens.publicEnv },
      { type: 'secret_text', name: 'CLOUD_SESSION_TOKEN_SECRET', text: sessionTokens.privateEnv },
      { type: 'secret_text', name: 'DEVICE_ID_CA_PRIV_KEY', text: deviceCA.privKey },
      { type: 'secret_text', name: 'DEVICE_ID_CA_CERT', text: deviceCA.cert },
      { type: 'plain_text', name: 'ENVIRONMENT', text: stage },
      { type: 'plain_text', name: 'MAX_TENANTS', text: '100' },
      { type: 'plain_text', name: 'MAX_ADMIN_USERS', text: '10' },
      { type: 'plain_text', name: 'MAX_MEMBER_USERS', text: '50' },
      { type: 'plain_text', name: 'MAX_INVITES', text: '100' },
      { type: 'plain_text', name: 'MAX_LEDGERS', text: '50' },
      // Service auth for machine-to-machine API calls (public link join flow)
      ...(serviceApiKey ? [{ type: 'secret_text' as const, name: 'SERVICE_API_KEY', text: serviceApiKey }] : []),
    ],
  });
  await enableWorkerSubdomain(accountId, apiToken, dashboardName);

  // 7. Get workers.dev subdomain for URL construction
  const workersSubdomain = await getWorkersSubdomain(accountId, apiToken);

  const cloudBackendUrl = `https://${cloudBackendName}.${workersSubdomain}.workers.dev`;
  const dashboardUrl = `https://${dashboardName}.${workersSubdomain}.workers.dev`;

  return {
    cloudBackendUrl,
    dashboardUrl,
    apiUrl: `${dashboardUrl}/api`,
    cloudUrl: `fpcloud://${cloudBackendUrl.replace('https://', '')}`,
    r2BucketName,
    d1BackendId,
    d1DashboardId,
    sessionTokenPublic: sessionTokens.publicEnv,
    deployedAt: new Date().toISOString(),
  };
}
