import { describe, it, expect, vi } from "vitest";
import { discoverLedgerId } from "../ledger-discovery";

function mockFetch(response: object) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("discoverLedgerId", () => {
  it("finds ledger by app name in ledger name", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-1", name: "other-app.vibesos.com", role: "admin" },
        { ledgerId: "led-2", name: "my-app.vibesos.com", role: "admin" },
      ],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|owner@test.com",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBe("led-2");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("returns first ledger when no name match", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-1", name: "something-else", role: "admin" },
      ],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBe("led-1");
  });

  it("returns null when no ledgers exist", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBeNull();
  });

  it("does not match partial app names as substring", async () => {
    const fetchFn = mockFetch({
      type: "resListLedgersByUser",
      ledgers: [
        { ledgerId: "led-wrong", name: "my-app.vibesos.com", role: "admin" },
        { ledgerId: "led-right", name: "app.vibesos.com", role: "admin" },
      ],
    });

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "app",
      fetchFn,
    });

    // Should match "app.vibesos.com", not "my-app.vibesos.com"
    expect(result).toBe("led-right");
  });

  it("returns null on fetch error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network fail"));

    const result = await discoverLedgerId({
      apiUrl: "https://dashboard.workers.dev/api",
      serviceToken: "key|owner-1|",
      appName: "my-app",
      fetchFn,
    });

    expect(result).toBeNull();
  });
});
