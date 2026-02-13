/**
 * Registry Logic - Pure functions for subdomain registry operations
 * Supports per-subdomain KV model with collaborator access.
 */

import type { SubdomainRecord, Collaborator } from "../types";

// === Legacy types (kept for backward compat with /registry.json) ===

export interface Claim {
  userId: string;
  claimedAt: string;
}

export interface Registry {
  claims: Record<string, Claim>;
  reserved: string[];
  preallocated: Record<string, string>;
  quotas?: Record<string, number>;
}

// === Availability checking ===

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
  ownerId?: string;
}

export function isSubdomainAvailable(
  subdomain: string,
  existingRecord: SubdomainRecord | null,
  reserved: string[],
  preallocated: Record<string, string>
): AvailabilityResult {
  const normalized = subdomain.toLowerCase().trim();

  if (reserved?.includes(normalized)) {
    return { available: false, reason: "reserved" };
  }

  if (preallocated && normalized in preallocated) {
    return {
      available: false,
      reason: "preallocated",
      ownerId: preallocated[normalized],
    };
  }

  if (existingRecord) {
    return {
      available: false,
      reason: "claimed",
      ownerId: existingRecord.ownerId,
    };
  }

  if (normalized.length < 3) {
    return { available: false, reason: "too_short" };
  }

  if (normalized.length > 63) {
    return { available: false, reason: "too_long" };
  }

  if (
    !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalized) &&
    normalized.length > 2
  ) {
    return { available: false, reason: "invalid_format" };
  }

  if (normalized.length <= 2 && !/^[a-z0-9]+$/.test(normalized)) {
    return { available: false, reason: "invalid_format" };
  }

  return { available: true };
}

// === Claim creation ===

export function createSubdomainRecord(
  userId: string
): SubdomainRecord {
  return {
    ownerId: userId,
    claimedAt: new Date().toISOString(),
    collaborators: [],
    status: 'active',
  };
}

export function freezeSubdomain(record: SubdomainRecord): SubdomainRecord {
  return { ...record, status: 'frozen', frozenAt: new Date().toISOString() };
}

export function unfreezeSubdomain(record: SubdomainRecord): SubdomainRecord {
  const { frozenAt, ...rest } = record;
  return { ...rest, status: 'active' };
}

// === Collaborator management ===

export function addCollaborator(
  record: SubdomainRecord,
  email: string,
  right: "read" | "write" = "write"
): SubdomainRecord {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if already exists
  const existing = record.collaborators.find(
    (c) => c.email.toLowerCase() === normalizedEmail
  );
  if (existing) {
    return record;
  }

  const collaborator: Collaborator = {
    email: normalizedEmail,
    status: "invited",
    right,
    invitedAt: new Date().toISOString(),
  };

  return {
    ...record,
    collaborators: [...record.collaborators, collaborator],
  };
}

export function activateCollaborator(
  record: SubdomainRecord,
  email: string,
  userId: string
): SubdomainRecord {
  const normalizedEmail = email.toLowerCase().trim();

  return {
    ...record,
    collaborators: record.collaborators.map((c) =>
      c.email.toLowerCase() === normalizedEmail
        ? {
            ...c,
            userId,
            status: "active" as const,
            joinedAt: new Date().toISOString(),
          }
        : c
    ),
  };
}

export function removeCollaborator(
  record: SubdomainRecord,
  email: string
): SubdomainRecord {
  const normalizedEmail = email.toLowerCase().trim();

  return {
    ...record,
    collaborators: record.collaborators.filter(
      (c) => c.email.toLowerCase() !== normalizedEmail
    ),
  };
}

// === Access checking ===

export function hasAccess(
  record: SubdomainRecord,
  userId: string
): { hasAccess: boolean; role: "owner" | "collaborator" | "none"; frozen: boolean } {
  const frozen = record.status === 'frozen';
  if (record.ownerId === userId) {
    return { hasAccess: true, role: "owner", frozen };
  }

  const collaborator = record.collaborators.find(
    (c) => c.userId === userId && c.status === "active"
  );
  if (collaborator) {
    return { hasAccess: true, role: "collaborator", frozen };
  }

  return { hasAccess: false, role: "none", frozen };
}

export function hasAccessByEmail(
  record: SubdomainRecord,
  email: string
): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  return record.collaborators.some(
    (c) => c.email.toLowerCase() === normalizedEmail
  );
}

// === Legacy compatibility wrappers ===
// These maintain the old function signatures for backward compat.

export function isSubdomainAvailableLegacy(
  registry: Registry,
  subdomain: string
): AvailabilityResult {
  const normalized = subdomain.toLowerCase().trim();
  const existingClaim = registry.claims?.[normalized];
  const existingRecord: SubdomainRecord | null = existingClaim
    ? {
        ownerId: existingClaim.userId,
        claimedAt: existingClaim.claimedAt,
        collaborators: [],
        status: 'active',
      }
    : null;
  return isSubdomainAvailable(
    subdomain,
    existingRecord,
    registry.reserved || [],
    registry.preallocated || {}
  );
}

export function createClaim(
  registry: Registry,
  subdomain: string,
  userId: string
): { success: boolean; error?: string; subdomain?: string } {
  const availability = isSubdomainAvailableLegacy(registry, subdomain);
  if (!availability.available) {
    return { success: false, error: availability.reason };
  }

  const normalized = subdomain.toLowerCase().trim();
  if (!registry.claims) {
    registry.claims = {};
  }

  registry.claims[normalized] = {
    userId,
    claimedAt: new Date().toISOString(),
  };

  return { success: true, subdomain: normalized };
}

export function getUserClaims(registry: Registry, userId: string): string[] {
  const claims: Array<{ subdomain: string; claimedAt: string }> = [];

  for (const [subdomain, claim] of Object.entries(registry.claims || {})) {
    if (claim.userId === userId) {
      claims.push({ subdomain, claimedAt: claim.claimedAt });
    }
  }

  claims.sort(
    (a, b) =>
      new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime()
  );
  return claims.map((c) => c.subdomain);
}

export function releaseClaim(registry: Registry, subdomain: string): boolean {
  const normalized = subdomain.toLowerCase().trim();
  if (registry.claims && normalized in registry.claims) {
    delete registry.claims[normalized];
    return true;
  }
  return false;
}

export function processSubscriptionChange(
  registry: Registry,
  userId: string,
  newQuantity: number
): { released: string[] } {
  const userClaims = getUserClaims(registry, userId);
  const toRelease =
    userClaims.length <= newQuantity
      ? []
      : userClaims.slice(0, userClaims.length - newQuantity);
  for (const subdomain of toRelease) {
    releaseClaim(registry, subdomain);
  }
  return { released: toRelease };
}
