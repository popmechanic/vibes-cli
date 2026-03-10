export interface Env {
  // Secrets
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  POCKET_ID_API_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  // Vars
  OIDC_ISSUER: string;

  // Service Bindings
  POCKET_ID: Fetcher;

  // KV
  REGISTRY_KV: KVNamespace;

  // Optional vars for join flow
  SERVICE_API_KEY?: string;
}

export interface DeployRequest {
  name: string;
  files: Record<string, string>; // path → content, e.g. { "index.html": "<html>...", "fireproof-oidc-bridge.js": "..." }
  html?: string; // legacy single-file format (wrapped as { "index.html": html })
}

export interface DeployResponse {
  ok: boolean;
  url: string;
  name: string;
  connect?: {
    apiUrl: string;
    cloudUrl: string;
  };
}

export interface ConnectInfo {
  cloudBackendUrl: string;
  dashboardUrl: string;
  apiUrl: string;
  cloudUrl: string;
  r2BucketName: string;
  d1BackendId: string;
  d1DashboardId: string;
  sessionTokenPublic: string;
  deployedAt: string;
}

export interface JWTPayload {
  sub: string;
  email?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  plan?: string;
  [key: string]: unknown;
}

export interface SubdomainRecord {
  owner: string;
  collaborators?: Array<{ userId: string; email?: string; role?: string }>;
  connectProvisioned?: boolean;
  connect?: ConnectInfo;
  oidcClientId?: string;
  userGroupId?: string;
  publicInvite?: { token: string; right: string; createdAt: string };
  connect?: { apiUrl?: string; cloudBackendUrl?: string; dashboardUrl?: string; ledgerId?: string };
  createdAt?: string;
  updatedAt?: string;
}
