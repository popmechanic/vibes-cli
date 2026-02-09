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

describe("POST /claim billing gate", () => {
  const verifyClerkJWTDebugMock = vi.mocked(verifyClerkJWTDebug);

  beforeEach(() => {
    vi.clearAllMocks();
    mockKV.get.mockResolvedValue(null);
  });

  it("ignores JWT plan claim and requires webhook quota", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
      pla: "pro",
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
      baseEnv
    );

    expect(res.status).toBe(402);
  });

  it("allows claim when webhook quota exists", async () => {
    verifyClerkJWTDebugMock.mockResolvedValue({
      userId: "user_1",
    } as any);

    mockKV.get.mockResolvedValue(
      JSON.stringify({
        claims: {},
        reserved: [],
        preallocated: {},
        quotas: { user_1: 1 },
      })
    );

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
      baseEnv
    );

    expect(res.status).toBe(201);
    expect(mockKV.put).toHaveBeenCalled();
  });
});
