import { describe, it, expect, vi } from "vitest";
import { discoverLedgerId } from "../ledger-discovery";

// Mock global fetch for D1 API calls
function mockD1Response(rows: Array<{ ledgerId: string; name: string }>) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({
      result: [{ results: rows, success: true }],
      success: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

const baseOpts = {
  accountId: "test-account",
  apiToken: "test-token",
  d1DatabaseId: "test-d1-id",
};

describe("discoverLedgerId", () => {
  it("finds ledger by app name in ledger name", async () => {
    const fetchFn = mockD1Response([
      { ledgerId: "led-1", name: "other-app.vibesos.com" },
      { ledgerId: "led-2", name: "my-app.vibesos.com" },
    ]);
    globalThis.fetch = fetchFn;

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "my-app",
    });

    expect(result).toBe("led-2");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("returns first ledger when no name match", async () => {
    globalThis.fetch = mockD1Response([
      { ledgerId: "led-1", name: "something-else" },
    ]);

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "my-app",
    });

    expect(result).toBe("led-1");
  });

  it("returns null when no ledgers exist", async () => {
    globalThis.fetch = mockD1Response([]);

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "my-app",
    });

    expect(result).toBeNull();
  });

  it("finds ledger with oidc- prefix (actual OIDC bridge format)", async () => {
    globalThis.fetch = mockD1Response([
      { ledgerId: "led-1", name: "other-app.vibesos.com" },
      { ledgerId: "led-2", name: "oidc-ai-dog.vibesos.com-aper-biscuit-chat-v1-z2qX2RYZ3EDaQ62Q1t" },
    ]);

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "ai-dog",
    });

    expect(result).toBe("led-2");
  });

  it("does not match partial app names as substring", async () => {
    globalThis.fetch = mockD1Response([
      { ledgerId: "led-wrong", name: "my-app.vibesos.com" },
      { ledgerId: "led-right", name: "app.vibesos.com" },
    ]);

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "app",
    });

    expect(result).toBe("led-right");
  });

  it("returns null on fetch error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network fail"));

    const result = await discoverLedgerId({
      ...baseOpts,
      appName: "my-app",
    });

    expect(result).toBeNull();
  });
});
