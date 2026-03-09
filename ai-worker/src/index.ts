import { Hono } from "hono";
import { aiCors } from "./cors";

type Env = {
  OPENROUTER_API_KEY: string;
  OIDC_ISSUER: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("/*", aiCors);

app.get("/health", (c) => c.text("ok"));

export default app;
