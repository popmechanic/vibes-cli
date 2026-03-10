import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverLedgerId } from "../ledger-discovery";

function mockFetchResponse(response: object, status = 200) {
  return new Response(JSON.stringify(response), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseOpts = {
  apiUrl: "https://connect-test.vibesos.com/api",
  serviceToken: "key|owner-1|",
};

describe("discoverLedgerId", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("finds ledger via dashboard HTTP API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-1", name: "other-app.vibesos.com", role: "admin" },
        { ledgerId: "led-2", name: "my-app.vibesos.com", role: "admin" },
      ],
    }));

    const result = await discoverLedgerId({ ...baseOpts, appName: "my-app" });
    expect(result).toBe("led-2");
  });

  it("falls back to D1 when dashboard returns non-ok", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse({ error: "1042" }, 404)) // dashboard fails
      .mockResolvedValueOnce(mockFetchResponse({ // D1 succeeds
        result: [{ results: [{ ledgerId: "led-d1", name: "oidc-my-app.vibesos.com-db-user1" }], success: true }],
        success: true,
      }));

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "my-app",
      d1Fallback: { accountId: "acct", apiToken: "tok", d1DatabaseId: "d1-id" },
    });
    expect(result).toBe("led-d1");
  });

  it("returns first ledger when no name match", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      type: "resListLedgersByUser",
      ledgers: [{ ledgerId: "led-1", name: "something-else", role: "admin" }],
    }));

    const result = await discoverLedgerId({ ...baseOpts, appName: "my-app" });
    expect(result).toBe("led-1");
  });

  it("returns null when no ledgers exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      type: "resListLedgersByUser",
      ledgers: [],
    }));

    const result = await discoverLedgerId({ ...baseOpts, appName: "my-app" });
    expect(result).toBeNull();
  });

  it("finds ledger with oidc- prefix", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-1", name: "other-app.vibesos.com", role: "admin" },
        { ledgerId: "led-2", name: "oidc-ai-dog.vibesos.com-aper-biscuit-chat-v1-z2qX", role: "admin" },
      ],
    }));

    const result = await discoverLedgerId({ ...baseOpts, appName: "ai-dog" });
    expect(result).toBe("led-2");
  });

  it("does not match partial app names as substring", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-wrong", name: "my-app.vibesos.com", role: "admin" },
        { ledgerId: "led-right", name: "app.vibesos.com", role: "admin" },
      ],
    }));

    const result = await discoverLedgerId({ ...baseOpts, appName: "app" });
    expect(result).toBe("led-right");
  });

  it("returns null on fetch error with no D1 fallback", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network fail"));

    const result = await discoverLedgerId({ ...baseOpts, appName: "my-app" });
    expect(result).toBeNull();
  });
});
