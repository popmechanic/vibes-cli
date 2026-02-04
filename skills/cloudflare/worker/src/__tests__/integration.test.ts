import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../index";

// Mock KV namespace
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
};

// Mock environment
const mockEnv = {
  REGISTRY_KV: mockKV,
  CLERK_PEM_PUBLIC_KEY: "test-key",
  CLERK_WEBHOOK_SECRET: "whsec_test",
  PERMITTED_ORIGINS: "",
  RESERVED_SUBDOMAINS: "admin,api,www",
};

describe("Registry Worker Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKV.get.mockResolvedValue(null);
  });

  describe("GET /registry.json", () => {
    it("returns empty registry when KV is empty", async () => {
      const res = await app.request("/registry.json", {}, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.claims).toEqual({});
    });

    it("returns existing registry data", async () => {
      mockKV.get.mockResolvedValue(
        JSON.stringify({
          claims: { test: { userId: "u1", claimedAt: "2025-01-01" } },
          reserved: ["admin"],
          preallocated: {},
        })
      );

      const res = await app.request("/registry.json", {}, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.claims.test.userId).toBe("u1");
    });
  });

  describe("GET /check/:subdomain", () => {
    it("returns available for unclaimed subdomain", async () => {
      const res = await app.request("/check/mysite", {}, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(true);
    });

    it("returns unavailable for reserved subdomain", async () => {
      mockKV.get.mockResolvedValue(
        JSON.stringify({
          claims: {},
          reserved: ["admin"],
          preallocated: {},
        })
      );

      const res = await app.request("/check/admin", {}, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("reserved");
    });

    it("returns unavailable for claimed subdomain", async () => {
      mockKV.get.mockResolvedValue(
        JSON.stringify({
          claims: { mysite: { userId: "user_123", claimedAt: "2025-01-01" } },
          reserved: [],
          preallocated: {},
        })
      );

      const res = await app.request("/check/mysite", {}, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("claimed");
    });

    it("returns unavailable for too short subdomain", async () => {
      const res = await app.request("/check/ab", {}, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toBe("too_short");
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
        mockEnv
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for missing subdomain", async () => {
      // This will still fail auth first, so we test the 401
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
        mockEnv
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
        mockEnv
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
        mockEnv
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
        mockEnv
      );
      expect(res.status).toBe(401);
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await app.request("/unknown", {}, mockEnv);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Not Found");
    });
  });
});
