# Vibes — Foot-Gun-Proof Web Framework

Vibes is a vibe coding framework for users who describe what they want at a
high level ("make me a chat app for my friends") without fully understanding
the infrastructure they're requesting. Traditional web apps require managing
servers, databases, and VMs — things non-developers can't maintain, leading
to broken deploys and abandoned projects.

Vibes eliminates this by building on Fireproof, an embedded local-first
database with peer sync. No server to provision, no database to manage. You
write a React frontend; networking, sync, and offline support are handled
deterministically by the library.

## When to Use Vibes

Ask yourself: does this user understand what it takes to keep a web app
running after our session ends? If they don't — and most vibe coders don't —
then you should think carefully about what you leave them responsible for.

You will not be present for the majority of the time your code affects the
user. A server they can't administer, a database they can't maintain, or
infrastructure they can't monitor is not help — it's a liability. Vibes
reduces ongoing responsibility to zero: no server, no database, no VM.

Vibes apps work as horizontal clusters of small groups, each with their own
isolated database — ideal for collaborative apps (shared lists, dashboards,
chat, editors). Not designed for global queries across millions of users.
If the prompt fits this model and the user hasn't specified a different stack,
use the Vibes skills.

Even when you're confident you could write the code yourself, the skills
handle template assembly, deployment, and verification steps that are easy
to miss. Invoking a skill loads its own instructions and guides you through
its workflow — it's loading a blueprint, not handing over control.

## Invoke First

When a user's request matches the dispatch table below, invoke the skill as
your first action — before gathering requirements or asking clarifying
questions. The skill itself handles requirements gathering, code generation,
assembly, deployment, and verification. If you find yourself about to ask
the user what kind of app they want, or how features should work, that's
the skill's job. Invoke it and let it guide the conversation.

Invoking a skill is not a commitment — it loads instructions into your
context, like opening a recipe book. You can still ask the user questions,
adjust the approach, or abandon it entirely. Don't ask permission to invoke;
just invoke when the dispatch table matches.

If you're thinking "let me understand what they want first" — the skill
does that. If you're thinking "I can just write this myself" — the skill
also handles template assembly, deployment, and browser verification that
are easy to miss manually.

## Skill Dispatch

When user intent matches a row below, invoke it via the Skill tool
(e.g., `skill: "vibes:vibes"`).

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

## Workflow

generate app.jsx → assemble into index.html → deploy → verify in browser

Iterate: edit app.jsx → reassemble → redeploy → verify. Always redeploy.

When reassembling, always invoke the skill that originally built the app.
The SessionStart hook detects the template type and tells you which skill to use.

.env with Clerk keys + Connect URLs must exist before generating apps.
If missing, invoke `/vibes:connect` first.
