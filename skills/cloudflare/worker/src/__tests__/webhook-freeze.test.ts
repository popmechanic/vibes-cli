import { describe, it, expect, vi, beforeEach } from "vitest";

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
  OIDC_PEM_PUBLIC_KEY: "test-key",
  OIDC_ISSUER: "",
  PERMITTED_ORIGINS: "",
  RESERVED_SUBDOMAINS: "",
});

describe("Webhook stub (future Stripe integration)", () => {
  beforeEach(() => {
    mockKV = createMockKV();
  });

  it("returns 501 for any webhook request (not yet implemented)", async () => {
    const res = await app.request(
      "/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checkout.session.completed", data: {} }),
      },
      makeMockEnv()
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toBe("Webhook handler not yet implemented");
  });
});
