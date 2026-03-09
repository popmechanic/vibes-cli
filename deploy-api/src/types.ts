export interface Env {
  // Secrets
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;
  POCKET_ID_API_KEY: string;
  // Vars
  OIDC_ISSUER: string;

  // Service Bindings
  POCKET_ID: Fetcher;

  // KV
  REGISTRY_KV: KVNamespace;
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
  oidcClientId?: string;
  userGroupId?: string;
  createdAt?: string;
  updatedAt?: string;
}
