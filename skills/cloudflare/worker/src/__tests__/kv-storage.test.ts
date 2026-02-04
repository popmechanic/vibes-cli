import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistryKV } from "../lib/kv-storage";

// Mock KV namespace
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
};

describe("RegistryKV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty registry when KV is empty", async () => {
    mockKV.get.mockResolvedValue(null);
    const kv = new RegistryKV(mockKV as unknown as KVNamespace);
    const registry = await kv.read();
    expect(registry.claims).toEqual({});
    expect(registry.reserved).toEqual([]);
  });

  it("reads registry from KV", async () => {
    const stored = {
      claims: { test: { userId: "u1", claimedAt: "2025-01-01" } },
      reserved: ["admin"],
      preallocated: {},
    };
    mockKV.get.mockResolvedValue(JSON.stringify(stored));
    const kv = new RegistryKV(mockKV as unknown as KVNamespace);
    const registry = await kv.read();
    expect(registry.claims.test.userId).toBe("u1");
  });

  it("writes registry to KV", async () => {
    const kv = new RegistryKV(mockKV as unknown as KVNamespace);
    const registry = { claims: {}, reserved: ["admin"], preallocated: {} };
    await kv.write(registry);
    expect(mockKV.put).toHaveBeenCalledWith("registry", JSON.stringify(registry));
  });

  it("preserves all registry fields on write", async () => {
    const kv = new RegistryKV(mockKV as unknown as KVNamespace);
    const registry = {
      claims: { mysite: { userId: "user_123", claimedAt: "2025-02-04T00:00:00Z" } },
      reserved: ["admin", "api"],
      preallocated: { vip: "user_456" },
      quotas: { user_123: 5 },
    };
    await kv.write(registry);
    expect(mockKV.put).toHaveBeenCalledWith("registry", JSON.stringify(registry));
  });
});
