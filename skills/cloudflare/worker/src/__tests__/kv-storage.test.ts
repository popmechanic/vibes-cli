import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistryKV } from "../lib/kv-storage";

// Mock KV namespace
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async (opts: { prefix?: string; cursor?: string }) => {
      const keys: { name: string }[] = [];
      for (const key of store.keys()) {
        if (!opts.prefix || key.startsWith(opts.prefix)) {
          keys.push({ name: key });
        }
      }
      return { keys, list_complete: true, cursor: "" };
    }),
    _store: store,
  };
}

describe("RegistryKV", () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let kv: RegistryKV;

  beforeEach(() => {
    mockKV = createMockKV();
    kv = new RegistryKV(mockKV as unknown as KVNamespace);
  });

  describe("subdomain operations", () => {
    it("returns null for non-existent subdomain", async () => {
      const result = await kv.getSubdomain("alice");
      expect(result).toBeNull();
    });

    it("stores and retrieves a subdomain record", async () => {
      const record = {
        ownerId: "user_abc",
        claimedAt: "2026-02-08T00:00:00Z",
        collaborators: [],
      };
      await kv.putSubdomain("alice", record);
      const result = await kv.getSubdomain("alice");
      // normalizeRecord adds status: 'active' if missing
      expect(result).toEqual({ ...record, status: 'active' });
      expect(mockKV.put).toHaveBeenCalledWith(
        "subdomain:alice",
        JSON.stringify(record)
      );
    });

    it("normalizes legacy records without status field", async () => {
      // Simulate a legacy record missing `status`
      await mockKV.put("subdomain:legacy", JSON.stringify({
        ownerId: "user_old",
        claimedAt: "2025-01-01T00:00:00Z",
      }));
      const result = await kv.getSubdomain("legacy");
      expect(result?.status).toBe('active');
      expect(result?.collaborators).toEqual([]);
    });

    it("preserves frozen status on read", async () => {
      await kv.putSubdomain("frozen-site", {
        ownerId: "user_abc",
        claimedAt: "2026-02-08T00:00:00Z",
        collaborators: [],
        status: 'frozen',
        frozenAt: '2026-02-10T00:00:00Z',
      });
      const result = await kv.getSubdomain("frozen-site");
      expect(result?.status).toBe('frozen');
      expect(result?.frozenAt).toBe('2026-02-10T00:00:00Z');
    });

    it("deletes a subdomain record", async () => {
      await kv.putSubdomain("alice", {
        ownerId: "user_abc",
        claimedAt: "2026-02-08T00:00:00Z",
        collaborators: [],
      });
      await kv.deleteSubdomain("alice");
      const result = await kv.getSubdomain("alice");
      expect(result).toBeNull();
    });

    it("stores collaborators within subdomain record", async () => {
      const record = {
        ownerId: "user_abc",
        claimedAt: "2026-02-08T00:00:00Z",
        collaborators: [
          {
            email: "bob@example.com",
            status: "invited" as const,
            right: "write" as const,
            invitedAt: "2026-02-09T00:00:00Z",
          },
          {
            email: "carol@x.com",
            userId: "user_def",
            status: "active" as const,
            right: "write" as const,
            invitedAt: "2026-02-09T00:00:00Z",
            joinedAt: "2026-02-09T01:00:00Z",
          },
        ],
      };
      await kv.putSubdomain("alice", record);
      const result = await kv.getSubdomain("alice");
      expect(result?.collaborators).toHaveLength(2);
      expect(result?.collaborators[0].status).toBe("invited");
      expect(result?.collaborators[1].status).toBe("active");
    });
  });

  describe("user operations", () => {
    it("returns null for non-existent user", async () => {
      const result = await kv.getUser("user_xyz");
      expect(result).toBeNull();
    });

    it("stores and retrieves a user record", async () => {
      const record = { subdomains: ["alice", "bob"], quota: 3 };
      await kv.putUser("user_abc", record);
      const result = await kv.getUser("user_abc");
      expect(result).toEqual(record);
      expect(mockKV.put).toHaveBeenCalledWith(
        "user:user_abc",
        JSON.stringify(record)
      );
    });

    it("deletes a user record", async () => {
      await kv.putUser("user_abc", { subdomains: ["alice"], quota: 3 });
      await kv.deleteUser("user_abc");
      const result = await kv.getUser("user_abc");
      expect(result).toBeNull();
    });
  });

  describe("config operations", () => {
    it("returns empty array for missing reserved config", async () => {
      const result = await kv.getReserved();
      expect(result).toEqual([]);
    });

    it("stores and retrieves reserved subdomains", async () => {
      await kv.putReserved(["admin", "api", "www"]);
      const result = await kv.getReserved();
      expect(result).toEqual(["admin", "api", "www"]);
    });

    it("returns empty object for missing preallocated config", async () => {
      const result = await kv.getPreallocated();
      expect(result).toEqual({});
    });

    it("stores and retrieves preallocated subdomains", async () => {
      await kv.putPreallocated({ demo: "user_admin" });
      const result = await kv.getPreallocated();
      expect(result).toEqual({ demo: "user_admin" });
    });
  });

  describe("listSubdomains", () => {
    it("returns empty map when no subdomains exist", async () => {
      const result = await kv.listSubdomains();
      expect(result.size).toBe(0);
    });

    it("lists all subdomain records", async () => {
      await kv.putSubdomain("alice", {
        ownerId: "user_a",
        claimedAt: "2026-02-08T00:00:00Z",
        collaborators: [],
      });
      await kv.putSubdomain("bob", {
        ownerId: "user_b",
        claimedAt: "2026-02-09T00:00:00Z",
        collaborators: [],
      });
      // Add a non-subdomain key to ensure filtering works
      await mockKV.put("config:reserved", '["admin"]');

      const result = await kv.listSubdomains();
      expect(result.size).toBe(2);
      expect(result.get("alice")?.ownerId).toBe("user_a");
      expect(result.get("bob")?.ownerId).toBe("user_b");
    });
  });

  describe("migrateFromBlob", () => {
    it("returns false when no legacy key exists", async () => {
      const migrated = await kv.migrateFromBlob();
      expect(migrated).toBe(false);
    });

    it("migrates legacy blob to per-key format", async () => {
      const legacyRegistry = {
        claims: {
          alice: { userId: "user_a", claimedAt: "2026-01-01T00:00:00Z" },
          bob: { userId: "user_b", claimedAt: "2026-01-02T00:00:00Z" },
        },
        reserved: ["admin", "api"],
        preallocated: { demo: "user_admin" },
      };
      await mockKV.put("registry", JSON.stringify(legacyRegistry));

      const migrated = await kv.migrateFromBlob();
      expect(migrated).toBe(true);

      // Verify subdomain keys created
      const alice = await kv.getSubdomain("alice");
      expect(alice?.ownerId).toBe("user_a");
      expect(alice?.collaborators).toEqual([]);

      const bob = await kv.getSubdomain("bob");
      expect(bob?.ownerId).toBe("user_b");

      // Verify user index keys created
      const userA = await kv.getUser("user_a");
      expect(userA?.subdomains).toEqual(["alice"]);

      const userB = await kv.getUser("user_b");
      expect(userB?.subdomains).toEqual(["bob"]);

      // Verify config keys created
      const reserved = await kv.getReserved();
      expect(reserved).toEqual(["admin", "api"]);

      const preallocated = await kv.getPreallocated();
      expect(preallocated).toEqual({ demo: "user_admin" });

      // Verify legacy key deleted
      const legacyData = await mockKV.get("registry");
      expect(legacyData).toBeNull();
    });
  });

  describe("readLegacyFormat", () => {
    it("reconstructs legacy format from per-key data", async () => {
      await kv.putSubdomain("alice", {
        ownerId: "user_a",
        claimedAt: "2026-01-01T00:00:00Z",
        collaborators: [
          {
            email: "bob@x.com",
            status: "active",
            right: "write",
            invitedAt: "2026-01-02T00:00:00Z",
          },
        ],
      });
      await kv.putReserved(["admin"]);
      await kv.putPreallocated({ demo: "user_admin" });

      const legacy = await kv.readLegacyFormat();
      expect(legacy.claims.alice.userId).toBe("user_a");
      expect(legacy.reserved).toEqual(["admin"]);
      expect(legacy.preallocated).toEqual({ demo: "user_admin" });
    });
  });
});
