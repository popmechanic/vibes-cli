# autoresearch-vibes Plugin

Automated eval loop for improving Vibes SKILL.md TinyBase documentation.

## What This Plugin Does

Drives an autoresearch loop that:
1. Generates apps from a prompt battery (10 app categories: 3 tiers — ambiguous boundaries, sync traps, regression)
2. Runs a static analysis pre-check on each generated app (scripts/eval-static-check.js)
3. Tests each with two simulated users via Chrome DevTools MCP
4. Checks for per-user state isolation bugs using graded scoring (0–4 per app, aggregate percentage)
5. Records failures in a structured napkin
6. Uses failures to improve SKILL.md (subagent generation via sonnet model)
7. Repeats until improvements plateau

See design spec: `docs/superpowers/specs/2026-03-23-eval-v2-design.md`

## Prerequisites

This plugin requires the vibes plugin's eval infrastructure:
- `eval/eval-shim.js` — useUser() mock (reads ?testUser URL param)
- `scripts/assemble.js --eval-mode` — assembly with shim injection
- `scripts/server/sync-server.ts` — standalone TinyBase sync on port 3334
- `scripts/eval-static-check.js` — static analysis pre-check (runs before browser tests)
- `eval/` directory — config, napkin, scoreboard, specs, generated apps
- Chrome DevTools MCP configured in `.mcp.json`

## Usage

```bash
claude --plugin-dir ./autoresearch-vibes
```

Then invoke: `/autoresearch-vibes:eval`

The skill runs one iteration per invocation. State persists in `eval/` artifacts.
