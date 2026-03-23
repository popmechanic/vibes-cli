# autoresearch-vibes Plugin

Automated eval loop for improving Vibes SKILL.md TinyBase documentation.

## What This Plugin Does

Drives an autoresearch loop that:
1. Generates apps from a prompt battery (7 app categories)
2. Tests each with two simulated users via Chrome DevTools MCP
3. Checks for per-user state isolation bugs
4. Records failures in a structured napkin
5. Uses failures to improve SKILL.md
6. Repeats until improvements plateau

## Prerequisites

This plugin requires the vibes plugin's eval infrastructure:
- `eval/eval-shim.js` — useUser() mock (reads ?testUser URL param)
- `scripts/assemble.js --eval-mode` — assembly with shim injection
- `scripts/server/sync-server.ts` — standalone TinyBase sync on port 3334
- `eval/` directory — config, napkin, scoreboard, specs, generated apps
- Chrome DevTools MCP configured in `.mcp.json`

## Usage

Invoke the eval skill: `/autoresearch-vibes:eval`

The skill runs one iteration per invocation. State persists in `eval/` artifacts.
