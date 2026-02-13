/**
 * KV Storage Adapter for Registry
 * Per-subdomain key model with collaborator support.
 *
 * Key schema:
 *   subdomain:<name>     → SubdomainRecord
 *   user:<userId>        → UserRecord
 *   config:reserved      → string[]
 *   config:preallocated  → Record<string, string>
 */

import type { SubdomainRecord, UserRecord } from "../types";

// Legacy types for migration
import type { Registry } from "./registry-logic";

const LEGACY_KEY = "registry";

function normalizeRecord(raw: any): SubdomainRecord {
  return { ...raw, status: raw.status || 'active', collaborators: raw.collaborators || [] };
}

export class RegistryKV {
  constructor(private kv: KVNamespace) {}

  // --- Subdomain operations ---

  async getSubdomain(subdomain: string): Promise<SubdomainRecord | null> {
    const data = await this.kv.get(`subdomain:${subdomain}`);
    if (!data) return null;
    return normalizeRecord(JSON.parse(data));
  }

  async putSubdomain(
    subdomain: string,
    record: SubdomainRecord
  ): Promise<void> {
    await this.kv.put(`subdomain:${subdomain}`, JSON.stringify(record));
  }

  async deleteSubdomain(subdomain: string): Promise<void> {
    await this.kv.delete(`subdomain:${subdomain}`);
  }

  // --- User operations ---

  async getUser(userId: string): Promise<UserRecord | null> {
    const data = await this.kv.get(`user:${userId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async putUser(userId: string, record: UserRecord): Promise<void> {
    await this.kv.put(`user:${userId}`, JSON.stringify(record));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.kv.delete(`user:${userId}`);
  }

  // --- Config operations ---

  async getReserved(): Promise<string[]> {
    const data = await this.kv.get("config:reserved");
    if (!data) return [];
    return JSON.parse(data);
  }

  async putReserved(reserved: string[]): Promise<void> {
    await this.kv.put("config:reserved", JSON.stringify(reserved));
  }

  async getPreallocated(): Promise<Record<string, string>> {
    const data = await this.kv.get("config:preallocated");
    if (!data) return {};
    return JSON.parse(data);
  }

  async putPreallocated(
    preallocated: Record<string, string>
  ): Promise<void> {
    await this.kv.put("config:preallocated", JSON.stringify(preallocated));
  }

  // --- List/query operations ---

  async listSubdomains(): Promise<Map<string, SubdomainRecord>> {
    const result = new Map<string, SubdomainRecord>();
    let cursor: string | undefined;

    do {
      const list = await this.kv.list({
        prefix: "subdomain:",
        ...(cursor ? { cursor } : {}),
      });

      for (const key of list.keys) {
        const name = key.name.slice("subdomain:".length);
        const data = await this.kv.get(key.name);
        if (data) {
          result.set(name, JSON.parse(data));
        }
      }

      cursor = list.list_complete ? undefined : (list.cursor as string);
    } while (cursor);

    return result;
  }

  // --- Migration from legacy blob format ---

  async migrateFromBlob(): Promise<boolean> {
    const legacyData = await this.kv.get(LEGACY_KEY);
    if (!legacyData) return false;

    const registry: Registry = JSON.parse(legacyData);

    // Migrate claims to per-subdomain keys
    const userSubdomains: Record<string, string[]> = {};

    for (const [subdomain, claim] of Object.entries(registry.claims || {})) {
      const record: SubdomainRecord = {
        ownerId: claim.userId,
        claimedAt: claim.claimedAt,
        collaborators: [],
        status: 'active',
      };
      await this.putSubdomain(subdomain, record);

      if (!userSubdomains[claim.userId]) {
        userSubdomains[claim.userId] = [];
      }
      userSubdomains[claim.userId].push(subdomain);
    }

    // Create user index keys
    for (const [userId, subdomains] of Object.entries(userSubdomains)) {
      const quota = registry.quotas?.[userId] ?? 3;
      await this.putUser(userId, { subdomains, quota });
    }

    // Migrate config
    if (registry.reserved?.length) {
      await this.putReserved(registry.reserved);
    }
    if (registry.preallocated && Object.keys(registry.preallocated).length) {
      await this.putPreallocated(registry.preallocated);
    }

    // Delete legacy key
    await this.kv.delete(LEGACY_KEY);

    return true;
  }

  // --- Legacy compatibility (for /registry.json endpoint) ---

  async readLegacyFormat(): Promise<Registry> {
    const subdomains = await this.listSubdomains();
    const reserved = await this.getReserved();
    const preallocated = await this.getPreallocated();

    const claims: Record<string, { userId: string; claimedAt: string }> = {};
    for (const [name, record] of subdomains) {
      claims[name] = {
        userId: record.ownerId,
        claimedAt: record.claimedAt,
      };
    }

    return { claims, reserved, preallocated };
  }
}
