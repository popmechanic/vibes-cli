import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../index";

// Full mock KV namespace with in-memory store
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
        if (!opts?.prefix || key.startsWith(opts.prefix)) {
          keys.push({ name: key });
        }
      }
      return { keys, list_complete: true, cursor: "" };
    }),
    _store: store,
  };
}

let mockKV: ReturnType<typeof createMockKV>;

const makeMockEnv = () => ({
  REGISTRY_KV: mockKV,
  CLERK_PEM_PUBLIC_KEY: "test-key",
  CLERK_WEBHOOK_SECRET: "whsec_test",
  PERMITTED_ORIGINS: "",
  RESERVED_SUBDOMAINS: "admin,api,www",
});

describe("Registry Worker Integration", () => {
  beforeEach(() => {
    mockKV = createMockKV();
  });

  describe("GET /registry.json", () => {
    it("returns empty registry when KV is empty", async () => {
      const res = await app.request("/registry.json", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.claims).toEqual({});
    });

    it("returns existing registry data", async () => {
      // Pre-populate with per-key data
      mockKV._store.set(
        "subdomain:test",
        JSON.stringify({ ownerId: "u1", claimedAt: "2025-01-01", collaborators: [] })
      );
      mockKV._store.set("config:reserved", JSON.stringify(["admin"]));

      const res = await app.request("/registry.json", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.claims.test.userId).toBe("u1");
    });
  });

  describe("GET /check/:subdomain", () => {
    it("returns available for unclaimed subdomain", async () => {
      const res = await app.request("/check/mysite", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
    });

    it("returns unavailable for reserved subdomain from env (empty KV)", async () => {
      const res = await app.request("/check/admin", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("reserved");
    });

    it("returns unavailable for reserved subdomain from KV", async () => {
      mockKV._store.set("config:reserved", JSON.stringify(["admin"]));

      const res = await app.request("/check/admin", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("reserved");
    });

    it("returns unavailable for claimed subdomain", async () => {
      mockKV._store.set(
        "subdomain:mysite",
        JSON.stringify({ ownerId: "user_123", claimedAt: "2025-01-01", collaborators: [] })
      );

      const res = await app.request("/check/mysite", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("claimed");
    });

    it("returns unavailable for too short subdomain", async () => {
      const res = await app.request("/check/ab", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("too_short");
    });
  });

  describe("GET /check/:subdomain/access", () => {
    it("returns 400 without userId param", async () => {
      const res = await app.request("/check/mysite/access", {}, makeMockEnv());
      expect(res.status).toBe(400);
    });

    it("returns no access for unclaimed subdomain", async () => {
      const res = await app.request("/check/mysite/access?userId=user_1", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasAccess).toBe(false);
      expect(data.role).toBe("none");
    });

    it("returns owner access", async () => {
      mockKV._store.set(
        "subdomain:mysite",
        JSON.stringify({ ownerId: "user_1", claimedAt: "2025-01-01", collaborators: [] })
      );
      const res = await app.request("/check/mysite/access?userId=user_1", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasAccess).toBe(true);
      expect(data.role).toBe("owner");
    });

    it("returns collaborator access for active collaborator", async () => {
      mockKV._store.set(
        "subdomain:mysite",
        JSON.stringify({
          ownerId: "user_1",
          claimedAt: "2025-01-01",
          collaborators: [{
            email: "bob@x.com",
            userId: "user_2",
            status: "active",
            right: "write",
            invitedAt: "2025-01-01",
            joinedAt: "2025-01-02",
          }],
        })
      );
      const res = await app.request("/check/mysite/access?userId=user_2", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasAccess).toBe(true);
      expect(data.role).toBe("collaborator");
    });

    it("returns no access for non-member", async () => {
      mockKV._store.set(
        "subdomain:mysite",
        JSON.stringify({ ownerId: "user_1", claimedAt: "2025-01-01", collaborators: [] })
      );
      const res = await app.request("/check/mysite/access?userId=user_stranger", {}, makeMockEnv());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.hasAccess).toBe(false);
    });
  });

  describe("POST /claim", () => {
    it("returns 401 without authorization", async () => {
      const res = await app.request(
        "/claim",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain: "test" }),
        },
        makeMockEnv()
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing subdomain", async () => {
      const res = await app.request(
        "/claim",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer invalid",
          },
          body: JSON.stringify({}),
        },
        makeMockEnv()
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await app.request(
        "/claim",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer invalid",
          },
          body: "not json",
        },
        makeMockEnv()
      );
      // Still 401 because auth fails first
      expect(res.status).toBe(401);
    });
  });

  describe("POST /webhook", () => {
    it("returns 401 for invalid signature", async () => {
      const res = await app.request(
        "/webhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "svix-id": "test",
            "svix-timestamp": "1234567890",
            "svix-signature": "invalid",
          },
          body: JSON.stringify({ type: "test" }),
        },
        makeMockEnv()
      );
      expect(res.status).toBe(401);
    });

    it("returns 401 for missing webhook headers", async () => {
      const res = await app.request(
        "/webhook",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "test" }),
        },
        makeMockEnv()
      );
      expect(res.status).toBe(401);
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await app.request("/unknown", {}, makeMockEnv());
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Not Found");
    });
  });
});
