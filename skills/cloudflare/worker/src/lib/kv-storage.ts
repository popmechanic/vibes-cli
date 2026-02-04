/**
 * KV Storage Adapter for Registry
 * Replaces file-based storage with Cloudflare KV.
 */

import type { Registry } from "./registry-logic";

const REGISTRY_KEY = "registry";

export class RegistryKV {
  constructor(private kv: KVNamespace) {}

  async read(): Promise<Registry> {
    const data = await this.kv.get(REGISTRY_KEY);
    if (!data) {
      return { claims: {}, reserved: [], preallocated: {} };
    }
    return JSON.parse(data);
  }

  async write(registry: Registry): Promise<void> {
    await this.kv.put(REGISTRY_KEY, JSON.stringify(registry));
  }
}
