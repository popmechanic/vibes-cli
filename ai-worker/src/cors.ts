import { cors } from "hono/cors";

export const aiCors = cors({
  origin: (origin) => {
    if (!origin) return origin;
    if (origin.includes("localhost")) return origin;
    if (origin.endsWith(".vibesos.com")) return origin;
    if (origin.endsWith(".vibes.diy")) return origin;
    if (origin.endsWith(".workers.dev")) return origin;
    return undefined;
  },
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});
