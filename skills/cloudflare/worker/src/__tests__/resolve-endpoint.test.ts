import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../index";

// Full mock KV namespace with in-memory store (same pattern as integration.test.ts)
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

function seedSubdomain(name: string, record: Record<string, unknown>) {
  mockKV._store.set(`subdomain:${name}`, JSON.stringify(record));
}

describe("GET /resolve/:subdomain", () => {
  beforeEach(() => {
    mockKV = createMockKV();
  });

  it("returns unclaimed for non-existent subdomain", async () => {
    const res = await app.request("/resolve/newsite", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "unclaimed", frozen: false });
  });

  it("returns owner role for owner userId", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
    });
    const res = await app.request("/resolve/mysite?userId=user_1", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "owner", frozen: false });
  });

  it("returns collaborator role for active collaborator", async () => {
    seedSubdomain("mysite", {
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
    });
    const res = await app.request("/resolve/mysite?userId=user_2", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "collaborator", frozen: false });
  });

  it("returns ledgerId for collaborator with stored ledgerId", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [{
        email: "bob@x.com",
        userId: "user_2",
        status: "active",
        right: "write",
        invitedAt: "2025-01-01",
        joinedAt: "2025-01-02",
        ledgerId: "ledger_abc123",
      }],
    });
    const res = await app.request("/resolve/mysite?userId=user_2", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "collaborator", frozen: false, ledgerId: "ledger_abc123" });
  });

  it("returns none for unknown userId", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
    });
    const res = await app.request("/resolve/mysite?userId=user_stranger", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "none", frozen: false });
  });

  it("returns invited when email matches a collaborator invite", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [{
        email: "bob@example.com",
        status: "invited",
        right: "write",
        invitedAt: "2025-01-01",
      }],
    });
    const res = await app.request("/resolve/mysite?email=bob@example.com", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "invited", frozen: false });
  });

  it("returns invited when userId has no access but email matches invite", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [{
        email: "bob@example.com",
        status: "invited",
        right: "write",
        invitedAt: "2025-01-01",
      }],
    });
    const res = await app.request(
      "/resolve/mysite?userId=user_stranger&email=bob@example.com",
      {},
      makeMockEnv()
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "invited", frozen: false });
  });

  it("returns none when no identity params provided", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
    });
    const res = await app.request("/resolve/mysite", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "none", frozen: false });
  });

  it("reports frozen: true for frozen subdomains", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
      status: "frozen",
      frozenAt: "2026-02-10T00:00:00Z",
    });
    const res = await app.request("/resolve/mysite?userId=user_1", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "owner", frozen: true });
  });

  it("reports frozen: true for non-owner on frozen subdomain", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
      status: "frozen",
      frozenAt: "2026-02-10T00:00:00Z",
    });
    const res = await app.request("/resolve/mysite?userId=user_stranger", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "none", frozen: true });
  });

  it("is case-insensitive for subdomain", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
    });
    const res = await app.request("/resolve/MySite?userId=user_1", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "owner", frozen: false });
  });

  it("returns none for email with no invite", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
    });
    const res = await app.request("/resolve/mysite?email=nobody@example.com", {}, makeMockEnv());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ role: "none", frozen: false });
  });
});
