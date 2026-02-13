export interface Env {
  REGISTRY_KV: KVNamespace;
  CLERK_PEM_PUBLIC_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  CLERK_SECRET_KEY?: string;
  PERMITTED_ORIGINS?: string;
  RESERVED_SUBDOMAINS?: string;
  OPENROUTER_API_KEY?: string;
  BILLING_MODE?: string;
  ADMIN_USER_IDS?: string;
}

// === Per-subdomain KV data model ===

export interface Collaborator {
  email: string;
  userId?: string;
  status: "invited" | "active";
  right: "read" | "write";
  invitedAt: string;
  joinedAt?: string;
}

export interface SubdomainRecord {
  ownerId: string;
  claimedAt: string;
  collaborators: Collaborator[];
  status: 'active' | 'frozen';
  frozenAt?: string;
}

export interface UserRecord {
  subdomains: string[];
  quota: number;
}
