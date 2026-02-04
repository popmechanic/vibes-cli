/**
 * Registry Logic - Pure functions for subdomain registry operations
 * Copied from scripts/lib/registry-logic.js with TypeScript types added.
 */

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

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
  ownerId?: string;
}

export function isSubdomainAvailable(
  registry: Registry,
  subdomain: string
): AvailabilityResult {
  const normalized = subdomain.toLowerCase().trim();

  if (registry.reserved?.includes(normalized)) {
    return { available: false, reason: "reserved" };
  }

  if (registry.preallocated && normalized in registry.preallocated) {
    return { available: false, reason: "preallocated", ownerId: registry.preallocated[normalized] };
  }

  if (registry.claims && normalized in registry.claims) {
    return { available: false, reason: "claimed", ownerId: registry.claims[normalized].userId };
  }

  if (normalized.length < 3) {
    return { available: false, reason: "too_short" };
  }

  if (normalized.length > 63) {
    return { available: false, reason: "too_long" };
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalized) && normalized.length > 2) {
    return { available: false, reason: "invalid_format" };
  }

  if (normalized.length <= 2 && !/^[a-z0-9]+$/.test(normalized)) {
    return { available: false, reason: "invalid_format" };
  }

  return { available: true };
}

export function getUserClaims(registry: Registry, userId: string): string[] {
  const claims: Array<{ subdomain: string; claimedAt: string }> = [];

  for (const [subdomain, claim] of Object.entries(registry.claims || {})) {
    if (claim.userId === userId) {
      claims.push({ subdomain, claimedAt: claim.claimedAt });
    }
  }

  claims.sort((a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime());
  return claims.map((c) => c.subdomain);
}

export function getSubdomainsToRelease(
  registry: Registry,
  userId: string,
  newQuantity: number
): string[] {
  const userClaims = getUserClaims(registry, userId);
  if (userClaims.length <= newQuantity) {
    return [];
  }
  return userClaims.slice(0, userClaims.length - newQuantity);
}

export function createClaim(
  registry: Registry,
  subdomain: string,
  userId: string
): { success: boolean; error?: string; subdomain?: string } {
  const availability = isSubdomainAvailable(registry, subdomain);
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
  const toRelease = getSubdomainsToRelease(registry, userId, newQuantity);
  for (const subdomain of toRelease) {
    releaseClaim(registry, subdomain);
  }
  return { released: toRelease };
}
