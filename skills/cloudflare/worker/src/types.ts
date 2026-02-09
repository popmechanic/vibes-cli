export interface Env {
  REGISTRY_KV: KVNamespace;
  CLERK_PEM_PUBLIC_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  PERMITTED_ORIGINS?: string;
  RESERVED_SUBDOMAINS?: string;
  OPENROUTER_API_KEY?: string;
  BILLING_MODE?: string;
}
