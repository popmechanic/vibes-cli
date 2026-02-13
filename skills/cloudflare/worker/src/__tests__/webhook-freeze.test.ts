import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock svix to bypass webhook signature verification
vi.mock("svix", () => ({
  Webhook: vi.fn().mockImplementation(() => ({
    verify: vi.fn().mockImplementation((payload: string) => JSON.parse(payload)),
  })),
}));

const { default: app } = await import("../index");

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
  RESERVED_SUBDOMAINS: "",
});

function seedSubdomain(name: string, record: Record<string, unknown>) {
  mockKV._store.set(`subdomain:${name}`, JSON.stringify(record));
}

function seedUser(userId: string, subdomains: string[]) {
  mockKV._store.set(`user:${userId}`, JSON.stringify({ subdomains, quota: 3 }));
}

function getSubdomain(name: string) {
  const raw = mockKV._store.get(`subdomain:${name}`);
  return raw ? JSON.parse(raw) : null;
}

async function sendWebhook(env: ReturnType<typeof makeMockEnv>, event: Record<string, unknown>) {
  return app.request(
    "/webhook",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_test",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1_test",
      },
      body: JSON.stringify(event),
    },
    env
  );
}

describe("Webhook freeze/unfreeze", () => {
  beforeEach(() => {
    mockKV = createMockKV();
  });

  it("subscription.deleted freezes only owned subdomains, not collaborated ones", async () => {
    // user_1 owns subdomain-a
    seedSubdomain("subdomain-a", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [{ email: "u2@x.com", userId: "user_2", status: "active", right: "write", invitedAt: "2025-01-01", joinedAt: "2025-01-02" }],
      status: "active",
    });

    // user_2 owns subdomain-b
    seedSubdomain("subdomain-b", {
      ownerId: "user_2",
      claimedAt: "2025-01-01",
      collaborators: [],
      status: "active",
    });

    // user_2's index contains BOTH (as collaborator on A, owner of B)
    seedUser("user_2", ["subdomain-a", "subdomain-b"]);

    // Webhook: user_2's subscription is deleted
    const res = await sendWebhook(makeMockEnv(), {
      type: "subscription.deleted",
      data: { user_id: "user_2" },
    });
    expect(res.status).toBe(200);

    // subdomain-b (owned by user_2) should be frozen
    const recordB = getSubdomain("subdomain-b");
    expect(recordB.status).toBe("frozen");
    expect(recordB.frozenAt).toBeDefined();

    // subdomain-a (owned by user_1, user_2 is just a collaborator) should NOT be frozen
    const recordA = getSubdomain("subdomain-a");
    expect(recordA.status).toBe("active");
  });

  it("subscription.created unfreezes only owned subdomains", async () => {
    // user_1 owns subdomain-a (frozen)
    seedSubdomain("subdomain-a", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [{ email: "u2@x.com", userId: "user_2", status: "active", right: "write", invitedAt: "2025-01-01", joinedAt: "2025-01-02" }],
      status: "frozen",
      frozenAt: "2025-02-01T00:00:00Z",
    });

    // user_2 owns subdomain-b (frozen)
    seedSubdomain("subdomain-b", {
      ownerId: "user_2",
      claimedAt: "2025-01-01",
      collaborators: [],
      status: "frozen",
      frozenAt: "2025-02-01T00:00:00Z",
    });

    // user_2's index contains both
    seedUser("user_2", ["subdomain-a", "subdomain-b"]);

    // Webhook: user_2 resubscribes
    const res = await sendWebhook(makeMockEnv(), {
      type: "subscription.created",
      data: { user_id: "user_2" },
    });
    expect(res.status).toBe(200);

    // subdomain-b (owned by user_2) should be unfrozen
    const recordB = getSubdomain("subdomain-b");
    expect(recordB.status).toBe("active");
    expect(recordB.frozenAt).toBeUndefined();

    // subdomain-a (owned by user_1) should remain frozen
    const recordA = getSubdomain("subdomain-a");
    expect(recordA.status).toBe("frozen");
  });

  it("subscription.deleted does not freeze already-frozen subdomains", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
      status: "frozen",
      frozenAt: "2025-01-15T00:00:00Z",
    });
    seedUser("user_1", ["mysite"]);

    const res = await sendWebhook(makeMockEnv(), {
      type: "subscription.deleted",
      data: { user_id: "user_1" },
    });
    expect(res.status).toBe(200);

    // Should preserve original frozenAt timestamp
    const record = getSubdomain("mysite");
    expect(record.status).toBe("frozen");
    expect(record.frozenAt).toBe("2025-01-15T00:00:00Z");
  });

  it("subscription.deleted with no user record is a no-op", async () => {
    const res = await sendWebhook(makeMockEnv(), {
      type: "subscription.deleted",
      data: { user_id: "user_nobody" },
    });
    expect(res.status).toBe(200);
  });

  it("preserves user index after freeze (for later unfreeze)", async () => {
    seedSubdomain("mysite", {
      ownerId: "user_1",
      claimedAt: "2025-01-01",
      collaborators: [],
      status: "active",
    });
    seedUser("user_1", ["mysite"]);

    await sendWebhook(makeMockEnv(), {
      type: "subscription.deleted",
      data: { user_id: "user_1" },
    });

    // User index should still exist
    const userRaw = mockKV._store.get("user:user_1");
    expect(userRaw).toBeDefined();
    const userRecord = JSON.parse(userRaw!);
    expect(userRecord.subdomains).toContain("mysite");
  });
});
