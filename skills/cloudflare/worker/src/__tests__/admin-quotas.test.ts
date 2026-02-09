import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/crypto-jwt", () => ({
  verifyClerkJWT: vi.fn(),
  verifyClerkJWTDebug: vi.fn(),
}));

const { verifyClerkJWTDebug } = await import("../lib/crypto-jwt");
const { default: app } = await import("../index");

const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
};

const baseEnv = {
  REGISTRY_KV: mockKV,
  CLERK_PEM_PUBLIC_KEY: "test-key",
  CLERK_WEBHOOK_SECRET: "whsec_test",
  PERMITTED_ORIGINS: "",
  RESERVED_SUBDOMAINS: "",
  BILLING_MODE: "required",
};

describe("POST /admin/quotas", () => {
  const verifyClerkJWTDebugMock = vi.mocked(verifyClerkJWTDebug);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKV.get.mockResolvedValue(
      JSON.stringify({ claims: {}, reserved: [], preallocated: {} })
    );
  });

  it("returns 403 when admin list is missing", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({ userId: "user_admin" } as any);

    const res = await app.request(
      "/admin/quotas",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ userId: "user_target", enabled: true }),
      },
      { ...baseEnv, ADMIN_USER_IDS: "" }
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not admin", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({ userId: "user_other" } as any);

    const res = await app.request(
      "/admin/quotas",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ userId: "user_target", enabled: true }),
      },
      { ...baseEnv, ADMIN_USER_IDS: "user_admin" }
    );

    expect(res.status).toBe(403);
  });

  it("allows admin to toggle quota", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({ userId: "user_admin" } as any);

    const res = await app.request(
      "/admin/quotas",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ userId: "user_target", enabled: true }),
      },
      { ...baseEnv, ADMIN_USER_IDS: "user_admin" }
    );

    expect(res.status).toBe(200);
    expect(mockKV.put).toHaveBeenCalled();

    const [key, value] = mockKV.put.mock.calls[0];
    expect(key).toBe("registry");
    const registry = JSON.parse(value);
    expect(registry.quotas.user_target).toBe(1);
  });
});
