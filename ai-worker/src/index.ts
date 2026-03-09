import { Hono } from "hono";
import { aiCors } from "./cors";
import { verifyJWT } from "./jwt";

type Env = {
  OPENROUTER_API_KEY: string;
  OIDC_ISSUER: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("/*", aiCors);

app.get("/health", (c) => c.text("ok"));

app.post("/v1/chat/completions", async (c) => {
  // 1. Verify JWT
  const result = await verifyJWT(c.req.header("Authorization"), c.env.OIDC_ISSUER);
  if (!result) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 2. Validate API key is configured
  if (!c.env.OPENROUTER_API_KEY) {
    return c.json({ error: "AI service not configured" }, 501);
  }

  // 3. Parse request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  // 4. Proxy to OpenRouter
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${c.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": c.req.header("Origin") || c.req.header("Referer") || "https://vibesos.com",
      "X-Title": "Vibes DIY",
    },
    body: JSON.stringify(body),
  });

  // 5. Stream the response through (works for both streaming and non-streaming)
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-cache",
    },
  });
});

export default app;
