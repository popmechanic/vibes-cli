# Vibes Framework

You have the **Vibes plugin** installed — a framework for building and deploying React + Fireproof web apps.

## When to Use Vibes Skills

| User Intent | Invoke |
|-------------|--------|
| "build an app", "create a...", "make me a..." | `/vibes:vibes` |
| "explore ideas", "give me variations", "riff on this" | `/vibes:riff` |
| "monetize", "add billing", "make it SaaS", "multi-tenant" | `/vibes:sell` |
| "deploy" / "put it online" (exe.dev) | `/vibes:exe` |
| "deploy to cloudflare" / "workers" | `/vibes:cloudflare` |
| "set up sync" / "Connect" / "cloud backend" | `/vibes:connect` |
| design.html or mockup provided | `/vibes:design` |
| "launch a SaaS" (full end-to-end pipeline) | `/vibes:launch` |
| "test the plugin" / "integration test" | `/vibes:test` |

## Core Workflow

generate app.jsx → assemble into index.html → deploy → verify in browser

Iterate: edit app.jsx → reassemble → redeploy → verify. Always redeploy after changes.

## Skills Are Atomic

Each skill above is a **self-contained automation**. Invoke it as ONE step — never decompose into sub-steps. The skill handles its own workflow internally.

## Critical Rules

1. **No hand-written imports** — the template provides React, Fireproof, and Clerk via import maps. Never add `import` statements to app.jsx.
2. **React singleton** — all esm.sh packages MUST use `?external=react,react-dom`.
3. **Use `useFireproofClerk()`** not `useFireproof()`. Returns `{ database, useLiveQuery, useDocument, syncStatus, isSyncing }`.
4. **Deploy is mandatory** — Clerk auth requires a public URL. No local-only path.
5. **Connect before Generate** — .env with Clerk keys + Connect URLs must exist before generating apps. Use `/vibes:connect` first.
