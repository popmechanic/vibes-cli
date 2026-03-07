export interface Env {
  // Secrets
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  OIDC_PEM_PUBLIC_KEY: string;

  // Vars
  OIDC_ISSUER: string;

  // KV
  REGISTRY_KV: KVNamespace;
}

export interface DeployRequest {
  name: string;
  html: string;
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
  createdAt?: string;
  updatedAt?: string;
}
