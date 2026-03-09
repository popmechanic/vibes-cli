import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { aiCors } from "../cors";

// Create a minimal app to test CORS behavior
function createTestApp() {
  const app = new Hono();
  app.use("/*", aiCors);
  app.post("/test", (c) => c.text("ok"));
  return app;
}

describe("CORS middleware", () => {
  it("allows localhost origins", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3333" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3333");
  });

  it("allows *.vibesos.com", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "https://ai.vibesos.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ai.vibesos.com");
  });

  it("allows *.vibes.diy", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "https://myapp.vibes.diy" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://myapp.vibes.diy");
  });

  it("allows *.workers.dev", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "https://my-worker.marcus-e.workers.dev" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://my-worker.marcus-e.workers.dev");
  });

  it("rejects unknown origins", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" },
    });
    // Hono CORS middleware doesn't set the header when origin is rejected
    const origin = res.headers.get("Access-Control-Allow-Origin");
    expect(origin).toBeNull();
  });

  it("includes correct allowed methods", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("includes correct allowed headers", async () => {
    const app = createTestApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000" },
    });
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers");
    expect(allowHeaders).toContain("Content-Type");
    expect(allowHeaders).toContain("Authorization");
  });
});
