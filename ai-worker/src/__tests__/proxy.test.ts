import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../index";

// Helper to make requests to the app with env bindings
function request(
  path: string,
  init?: RequestInit,
  env: Record<string, string> = {}
) {
  const defaultEnv = {
    OPENROUTER_API_KEY: "test-api-key",
    OIDC_ISSUER: "https://example.com",
    ...env,
  };
  return app.request(path, init, defaultEnv);
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("POST /v1/chat/completions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 without auth", async () => {
    const res = await request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 with invalid Bearer token", async () => {
    const res = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 501 when OPENROUTER_API_KEY is not set", async () => {
    // Generate a valid-looking JWT that will pass parsing but we mock verifyJWT
    // Instead, we test at the app level by mocking the jwt module
    const jwt = await import("../jwt");
    vi.spyOn(jwt, "verifyJWT").mockResolvedValue({ sub: "user-1" });

    const res = await request(
      "/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-token",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      },
      { OPENROUTER_API_KEY: "", OIDC_ISSUER: "https://example.com" }
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body).toEqual({ error: "AI service not configured" });
  });

  it("returns 400 for invalid JSON body", async () => {
    const jwt = await import("../jwt");
    vi.spyOn(jwt, "verifyJWT").mockResolvedValue({ sub: "user-1" });

    const res = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
      },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid request body" });
  });

  it("forwards request to OpenRouter with API key", async () => {
    const jwt = await import("../jwt");
    vi.spyOn(jwt, "verifyJWT").mockResolvedValue({ sub: "user-1" });

    const mockResponse = new Response(
      JSON.stringify({ choices: [{ message: { content: "Hello!" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const res = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
        Origin: "https://myapp.vibes.diy",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);

    // Verify fetch was called with correct args
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
          "X-Title": "Vibes DIY",
        }),
      })
    );
  });

  it("passes through OpenRouter error status codes", async () => {
    const jwt = await import("../jwt");
    vi.spyOn(jwt, "verifyJWT").mockResolvedValue({ sub: "user-1" });

    const mockResponse = new Response(
      JSON.stringify({ error: { message: "Rate limited" } }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const res = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(429);
  });

  it("passes through streaming response body", async () => {
    const jwt = await import("../jwt");
    vi.spyOn(jwt, "verifyJWT").mockResolvedValue({ sub: "user-1" });

    const sseData =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
    const mockResponse = new Response(sseData, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const res = await request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await res.text();
    expect(body).toContain("data:");
    expect(body).toContain("[DONE]");
  });
});
