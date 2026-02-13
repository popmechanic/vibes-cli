import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/crypto-jwt", () => ({
  verifyClerkJWT: vi.fn(),
  verifyClerkJWTDebug: vi.fn(),
}));

const { verifyClerkJWTDebug } = await import("../lib/crypto-jwt");
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

const makeBaseEnv = () => ({
  REGISTRY_KV: mockKV,
  CLERK_PEM_PUBLIC_KEY: "test-key",
  CLERK_WEBHOOK_SECRET: "whsec_test",
  PERMITTED_ORIGINS: "",
  RESERVED_SUBDOMAINS: "",
  BILLING_MODE: "required",
  PLAN_QUOTAS: JSON.stringify({ starter: 1, growth: 3, pro: 10 }),
});

function claimRequest(subdomain: string, env?: Record<string, any>) {
  return app.request(
    "/claim",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({ subdomain }),
    },
    env ?? makeBaseEnv()
  );
}

describe("POST /claim quota enforcement", () => {
  const verifyClerkJWTDebugMock = vi.mocked(verifyClerkJWTDebug);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKV = createMockKV();
  });

  it("rejects claim at quota (1/1 starter)", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:starter",
    } as any);

    // Pre-seed: user already owns 1 subdomain
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["existing"], ownedSubdomains: ["existing"], quota: 3 })
    );
    mockKV._store.set(
      "subdomain:existing",
      JSON.stringify({ ownerId: "user_1", claimedAt: "2026-01-01T00:00:00Z", collaborators: [], status: "active" })
    );

    const res = await claimRequest("newsite");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("quota_exceeded");
    expect(body.current).toBe(1);
    expect(body.limit).toBe(1);
  });

  it("allows claim below quota (0/1 starter)", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:starter",
    } as any);

    // No existing subdomains
    const res = await claimRequest("newsite");
    expect(res.status).toBe(201);
  });

  it("allows claim below quota (2/3 growth)", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:growth",
    } as any);

    // Pre-seed: user owns 2 subdomains (quota is 3)
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["site-a", "site-b"], ownedSubdomains: ["site-a", "site-b"], quota: 3 })
    );
    mockKV._store.set(
      "subdomain:site-a",
      JSON.stringify({ ownerId: "user_1", claimedAt: "2026-01-01T00:00:00Z", collaborators: [], status: "active" })
    );
    mockKV._store.set(
      "subdomain:site-b",
      JSON.stringify({ ownerId: "user_1", claimedAt: "2026-01-02T00:00:00Z", collaborators: [], status: "active" })
    );

    const res = await claimRequest("site-c");
    expect(res.status).toBe(201);
  });

  it("admin bypasses quota", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_admin",
      plan: "u:starter",
    } as any);

    // Pre-seed: admin already owns 1 subdomain (at starter quota)
    mockKV._store.set(
      "user:user_admin",
      JSON.stringify({ subdomains: ["existing"], ownedSubdomains: ["existing"], quota: 3 })
    );
    mockKV._store.set(
      "subdomain:existing",
      JSON.stringify({ ownerId: "user_admin", claimedAt: "2026-01-01T00:00:00Z", collaborators: [], status: "active" })
    );

    const res = await claimRequest("another", {
      ...makeBaseEnv(),
      ADMIN_USER_IDS: "user_admin",
    });
    expect(res.status).toBe(201);
  });

  it("no PLAN_QUOTAS env var = unlimited (backward compat)", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:starter",
    } as any);

    // Pre-seed: user owns many subdomains
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["a", "b", "c", "d", "e"], ownedSubdomains: ["a", "b", "c", "d", "e"], quota: 3 })
    );

    const env = makeBaseEnv();
    delete (env as any).PLAN_QUOTAS;

    const res = await claimRequest("newsite", env);
    expect(res.status).toBe(201);
  });

  it("unknown plan slug = unlimited", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:enterprise",
    } as any);

    // Pre-seed: user owns many subdomains
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["a", "b", "c"], ownedSubdomains: ["a", "b", "c"], quota: 3 })
    );

    const res = await claimRequest("newsite");
    expect(res.status).toBe(201);
  });

  it("frozen subdomains count against quota", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:starter",
    } as any);

    // Pre-seed: user owns 1 frozen subdomain (starter quota = 1)
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["frozen-site"], ownedSubdomains: ["frozen-site"], quota: 3 })
    );
    mockKV._store.set(
      "subdomain:frozen-site",
      JSON.stringify({
        ownerId: "user_1",
        claimedAt: "2026-01-01T00:00:00Z",
        collaborators: [],
        status: "frozen",
        frozenAt: "2026-02-01T00:00:00Z",
      })
    );

    const res = await claimRequest("newsite");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("quota_exceeded");
  });

  it("collaborated subdomains do NOT count against quota", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:starter",
    } as any);

    // Pre-seed: user has 1 collab subdomain but 0 owned (starter quota = 1)
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["collab-site"], ownedSubdomains: [], quota: 3 })
    );
    mockKV._store.set(
      "subdomain:collab-site",
      JSON.stringify({
        ownerId: "user_other",
        claimedAt: "2026-01-01T00:00:00Z",
        collaborators: [
          { email: "user1@example.com", userId: "user_1", status: "active", right: "write", invitedAt: "2026-01-01T00:00:00Z" },
        ],
        status: "active",
      })
    );

    const res = await claimRequest("my-own-site");
    expect(res.status).toBe(201);
  });

  it("returns current/limit in 403 response body", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:growth",
    } as any);

    // Pre-seed: user owns 3 subdomains (growth quota = 3)
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({
        subdomains: ["site-a", "site-b", "site-c"],
        ownedSubdomains: ["site-a", "site-b", "site-c"],
        quota: 3,
      })
    );

    const res = await claimRequest("site-d");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Quota exceeded");
    expect(body.reason).toBe("quota_exceeded");
    expect(body.current).toBe(3);
    expect(body.limit).toBe(3);
  });

  it("lazy-migrates ownedSubdomains from subdomains list", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:growth",
    } as any);

    // Pre-seed: user has subdomains but NO ownedSubdomains (pre-migration)
    // User owns 2, collaborates on 1
    mockKV._store.set(
      "user:user_1",
      JSON.stringify({ subdomains: ["owned-a", "owned-b", "collab-c"], quota: 3 })
    );
    mockKV._store.set(
      "subdomain:owned-a",
      JSON.stringify({ ownerId: "user_1", claimedAt: "2026-01-01T00:00:00Z", collaborators: [], status: "active" })
    );
    mockKV._store.set(
      "subdomain:owned-b",
      JSON.stringify({ ownerId: "user_1", claimedAt: "2026-01-02T00:00:00Z", collaborators: [], status: "active" })
    );
    mockKV._store.set(
      "subdomain:collab-c",
      JSON.stringify({ ownerId: "user_other", claimedAt: "2026-01-03T00:00:00Z", collaborators: [], status: "active" })
    );

    // Growth quota = 3, user owns 2 → should allow
    const res = await claimRequest("site-d");
    expect(res.status).toBe(201);

    // Verify lazy migration wrote ownedSubdomains
    const userDataRaw = mockKV._store.get("user:user_1");
    const userData = JSON.parse(userDataRaw!);
    expect(userData.ownedSubdomains).toContain("owned-a");
    expect(userData.ownedSubdomains).toContain("owned-b");
    expect(userData.ownedSubdomains).not.toContain("collab-c");
  });

  it("maintains ownedSubdomains on successful claim", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:growth",
    } as any);

    const res = await claimRequest("my-new-site");
    expect(res.status).toBe(201);

    // Verify ownedSubdomains includes the new claim
    const userDataRaw = mockKV._store.get("user:user_1");
    const userData = JSON.parse(userDataRaw!);
    expect(userData.ownedSubdomains).toContain("my-new-site");
    expect(userData.subdomains).toContain("my-new-site");
  });
});
