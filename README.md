# Vibes - a vibe coding stack made for coding agents

![Vibes](assets/vibes.png)

Instantly make your own small multi-user apps, without a backend. With Vibes, The front-end _is_ the app.

## What is Vibes?

Vibes is a vibe coding framework made for coding agents. It collapses application code and application state into a single HTML file that runs anywhere.

**Why does this matter?** AI doesn't make apps - it makes *text*. By embedding the database in JavaScript (via [Fireproof](https://fireproof.storage)), your coding agent can describe an entire app - including its persistence layer - in one shot. No server setup, no schema imports. Just a working app.

Your data lives locally in the browser, encrypted and portable. It syncs across users automatically. Share your creations with a simple link and friends can jump in immediately.

## Quick Start

Install for your agent, then try: "Make me a todo vibe"

That's it. Your agent generates a single HTML file with a working app.

## Installation

> **Note:** Installation differs by platform. Claude Code has a built-in plugin system. Codex and OpenCode require manual setup.

### Claude Code (via Plugin Marketplace)

In Claude Code, register the marketplace first:

```
/plugin marketplace add popmechanic/vibes-cli
```

Then install the plugin:

```
/plugin install vibes@vibes-cli
```

Restart Claude Code after installation.

**Verify Installation:**
```
/help
# Should see vibes skills like:
# /vibes:vibes - Generate React web apps
# /vibes:riff - Generate app variations
# /vibes:sell - Transform to multi-tenant SaaS
```

**Updating:**
```
/plugin update vibes@vibes-cli
```

### Codex

Tell Codex:

```
Fetch and follow instructions from https://raw.githubusercontent.com/popmechanic/vibes-cli/main/.codex/INSTALL.md
```

### OpenCode / Other Agents

Install manually:

```bash
git clone https://github.com/popmechanic/vibes-cli.git ~/.vibes
cd ~/.vibes/scripts && npm install
```

Then add to your agent's config:

```markdown
## Vibes

<EXTREMELY_IMPORTANT>
You have Vibes installed. Run `~/.vibes/.codex/vibes-codex bootstrap` and follow the instructions.
</EXTREMELY_IMPORTANT>
```

**Updating:**
```bash
cd ~/.vibes && git pull
```

### Troubleshooting

**Claude Code - stuck on old version:**
```
/plugin marketplace remove vibes-cli
/plugin uninstall vibes@vibes-cli
/plugin marketplace add popmechanic/vibes-cli
/plugin install vibes@vibes-cli
```
Then restart Claude Code.

**Permission denied running vibes-codex:**
```bash
chmod +x ~/.vibes/.codex/vibes-codex
```

**Scripts fail with "module not found":**
```bash
cd ~/.vibes/scripts && npm install
```

## Skills

Skills are **model-invoked** - Claude automatically uses them when your task matches the skill's purpose. Just describe what you want to build.

### `vibes`

Generate a complete, working app from a prompt. Perfect when you have a clear idea and want to see it working quickly.

Creates a single HTML file with inline JavaScript, Fireproof database for local-first persistence, and Tailwind CSS styling. No build step - just open and run.

**Example prompts:**
- "Make a chore chart for my roommates"
- "Build a potluck sign-up for Friendsgiving"
- "Create a trivia game about reality TV"

### `design-reference`

Have a design mockup or static HTML file? This skill mechanically transforms it into a working Vibes app while preserving the design exactly.

The transformation is deterministic: CSS is copied verbatim, HTML structure is preserved, only syntax changes (class→className) and dynamic content bindings are added. No interpretation, no "improvements" - pixel-perfect fidelity to your design.

**Example prompts:**
- "Use design.html as the reference for my app"
- "Match this mockup exactly"
- "Convert this static HTML to a Vibes app"

### `riff`

Not sure what to build? Riff generates 3-10 completely different interpretations of your idea in parallel.

Each variation is a genuinely different concept - not just styling changes. You'll get ranked variations with business model analysis to help you pick the winner. Great for exploring a broad idea before committing.

**Example prompt:** "Make me an app that could make money"

**Output:**
```
./
├── index.html          # Gallery showcasing all variations
├── RANKINGS.md         # Scored rankings with recommendations
├── riff-1/
│   ├── index.html      # App variation 1
│   └── BUSINESS.md     # Business model canvas
├── riff-2/
│   └── ...
```

### `sell`

Ready to monetize? Sell transforms your app into a multi-tenant SaaS with Clerk authentication, subscription billing, and isolated databases per customer.

Each user gets their own subdomain (alice.yourapp.com) with their own data. Includes a marketing landing page, admin dashboard, and subscription gating - everything you need to start charging.

![Sell: Multi-Tenant SaaS Philosophy](assets/sell-philosophy.png)

**The philosophy:** Most SaaS turns every community into rows in one database. Sell turns every community into its own world. This is horizontal scaling where the unit is the tenant database—not the server fleet.

**Output:** A single unified `index.html` that handles all routes:
```
yourdomain.com          → Landing page with pricing
*.yourdomain.com        → Tenant app with auth gate
admin.yourdomain.com    → Admin dashboard
```

**Example flow:**
1. Build an app with `/vibes`
2. Run `/sell` to transform it
3. Configure Clerk keys and pricing
4. Deploy with `/exe`

### `exe`

Go live right now. Deploy creates a persistent VM at yourapp.exe.xyz with HTTPS, nginx, and Claude pre-installed.

Your app stays online 24/7 even when you close your laptop. Zero downtime redeployments let you iterate live. Great for demos, pilots, or production.

### `cloudflare`

Deploy to Cloudflare Workers with a subdomain registry. Uses KV for storage and native Web Crypto for JWT verification.

Includes the full registry server for multi-tenant apps: subdomain claiming, availability checking, Clerk webhook handling, and quota enforcement. Static assets (your app, bundles, images) are served alongside the worker.

**Example prompts:**
- "Deploy to Cloudflare"
- "Put this on Cloudflare Workers"

### `launch`

The full SaaS pipeline in one command. Takes you from a prompt to a live, deployed multi-tenant SaaS app with Clerk authentication, subscription billing, and Cloudflare hosting.

Uses **Agent Teams** to parallelize independent steps for maximum speed. A builder agent generates app code while you configure Clerk, and an infra agent deploys Connect in parallel. Typical time: ~20-25 minutes for a new app (vs ~40-60 min doing each step sequentially).

**Example prompts:**
- "Launch a SaaS app for wedding photo sharing"
- "Build and deploy a team dashboard with billing"
- "Full pipeline: task manager with subscriptions"

### `test`

End-to-end integration test for plugin developers. Assembles a pre-written fixture with real Clerk credentials, deploys a Connect studio and Cloudflare worker, and presents a live URL for browser verification.

Walks you through each step interactively: credentials, Connect setup, fixture selection, assembly, deploy, and verification.

**Example prompt:** "Test the plugin" or "Run an integration test"

## Why Vibes?

Every vibe-coded project starts in the vibe zone - the AI understands you, progress is fast, each change moves the app forward.

Then something small goes wrong. A fix that mostly works. An edge case layered on top. You correct it, then correct the correction, and suddenly progress slows to a crawl.

You've drifted out of the vibe zone.

![Vibe Zone](assets/vibezone.png)

**Vibes DIY keeps things simple enough that you stay in the vibe zone.** Single-file apps. Local-first data. No server complexity. The AI can see and understand everything it needs to help you.

## How Data Works

Vibes apps use [Fireproof](https://fireproof.storage), a local-first database:

- **Offline-first**: Apps work without internet, sync when connected
- **Encrypted**: Data is encrypted before leaving the browser
- **Shareable**: Real-time sync across users via cloud relay
- **Portable**: Export your data anytime

The hidden settings menu (gear icon) lets you configure sync for collaboration.

## Client-Side Multi-Tenancy

Traditional SaaS multi-tenancy requires backend code, database configuration, tenant isolation logic, and DevOps expertise. Setup takes weeks.

Vibes eliminates these categories of work entirely.

Each subdomain creates a separate database namespace. Tenant isolation happens automatically—tenant A cannot query tenant B's data because the databases are physically separate. Data leaks become architecturally impossible.

The implementation:

```javascript
const subdomain = window.location.hostname.split('.')[0];
const { database } = useFireproofClerk(`app-${subdomain}`);
```

Three lines. No backend. No database configuration. No tenant middleware.

### What This Enables

- **Indie hackers**: Ship commercial apps in hours, not weeks
- **Designers who code**: Build SaaS without learning DevOps
- **Domain experts**: Package expertise as subscription software
- **Rapid validation**: Deploy real infrastructure for customer pilots

The architecture works best for per-user tools, white-label dashboards, customer portals, and micro-SaaS with independent tenants. Each tenant gets their own world.

### The Constraint Is the Feature

You cannot run global queries across all tenants. Some ideas won't fit. This is groupware—tools for communities, not platforms that own them. No one can be Zuckerberg over a Vibes app. That's the point.

## Links

- [vibes.diy](https://vibes.diy) - Try the web builder
- [Discord](https://discord.gg/vnpWycj4Ta) - Join the community
- [GitHub](https://github.com/VibesDIY) - Open source
- [Substack](https://vibesdiy.substack.com/) - Updates and tutorials
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development guide

## License

MIT
