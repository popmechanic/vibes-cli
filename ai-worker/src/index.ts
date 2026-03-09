import { Hono } from "hono";

type Env = {
  OPENROUTER_API_KEY: string;
  OIDC_ISSUER: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.text("ok"));

export default app;
