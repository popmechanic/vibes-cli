export interface Env {
  REGISTRY_KV: KVNamespace;
  OIDC_PEM_PUBLIC_KEY: string;
  OIDC_ISSUER?: string;  // Expected issuer for token validation
  PERMITTED_ORIGINS?: string;
  RESERVED_SUBDOMAINS?: string;
  OPENROUTER_API_KEY?: string;
  BILLING_MODE?: string;
  ADMIN_USER_IDS?: string;
  PLAN_QUOTAS?: string;  // JSON: {"starter":1,"growth":3,"pro":10}
}

// === Per-subdomain KV data model ===

export interface Collaborator {
  email: string;
  userId?: string;
  status: "invited" | "active";
  right: "read" | "write";
  invitedAt: string;
  joinedAt?: string;
  ledgerId?: string;
  inviteId?: string;
}

export interface SubdomainRecord {
  ownerId: string;
  claimedAt: string;
  collaborators: Collaborator[];
  status: 'active' | 'frozen';
  frozenAt?: string;
  ledgerId?: string;
}

export interface UserRecord {
  subdomains: string[];
  ownedSubdomains?: string[];  // owned-only (for quota counting, lazy-migrated)
  quota: number;
}
