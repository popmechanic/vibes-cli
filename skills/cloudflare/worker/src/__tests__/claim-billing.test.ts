import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/crypto-jwt", () => ({
  verifyOIDCJWT: vi.fn(),
  verifyOIDCJWTDebug: vi.fn(),
}));

const { verifyOIDCJWTDebug } = await import("../lib/crypto-jwt");
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
  OIDC_PEM_PUBLIC_KEY: "test-key",
  OIDC_ISSUER: "",
  PERMITTED_ORIGINS: "",
  RESERVED_SUBDOMAINS: "",
  BILLING_MODE: "required",
});

describe("POST /claim billing gate", () => {
  const verifyOIDCJWTDebugMock = vi.mocked(verifyOIDCJWTDebug);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKV = createMockKV();
  });

  it("rejects claim when user has no plan (missing pla)", async () => {
    verifyOIDCJWTDebugMock.mockResolvedValue({
      userId: "user_1",
    } as any);

    const res = await app.request(
      "/claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ subdomain: "test" }),
      },
      makeBaseEnv()
    );

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.reason).toBe("no_subscription");
  });

  it("rejects claim when user has free plan", async () => {
    verifyOIDCJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:free",
    } as any);

    const res = await app.request(
      "/claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ subdomain: "test" }),
      },
      makeBaseEnv()
    );

    expect(res.status).toBe(402);
  });

  it("allows claim when user has paid plan (starter)", async () => {
    verifyOIDCJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      plan: "u:starter",
    } as any);

    const res = await app.request(
      "/claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ subdomain: "test" }),
      },
      makeBaseEnv()
    );

    expect(res.status).toBe(201);
    expect(mockKV.put).toHaveBeenCalled();
  });

  it("allows claim when billing mode is off (no plan needed)", async () => {
    verifyOIDCJWTDebugMock.mockResolvedValue({
      userId: "user_1",
    } as any);

    const res = await app.request(
      "/claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ subdomain: "test" }),
      },
      { ...makeBaseEnv(), BILLING_MODE: "off" }
    );

    expect(res.status).toBe(201);
  });

  it("allows admin to claim without plan", async () => {
    verifyOIDCJWTDebugMock.mockResolvedValue({
      userId: "user_admin",
    } as any);

    const res = await app.request(
      "/claim",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ subdomain: "test" }),
      },
      { ...makeBaseEnv(), ADMIN_USER_IDS: "user_admin" }
    );

    expect(res.status).toBe(201);
  });
});
