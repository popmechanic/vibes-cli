# Cross-Harness Architecture

Vibes skills conform to the [Agent Skills standard](https://agentskills.io). Each skill is a directory under `skills/` with a `SKILL.md` file containing YAML frontmatter (name, description, license, allowed-tools, metadata) and Markdown instructions. This document covers what the standard provides, where it stops, and how Vibes bridges the gaps.

## Agent Skills Standard Compliance

| Spec Requirement | Status |
|---|---|
| SKILL.md with YAML frontmatter | Compliant (9 skills) |
| `name` matches parent directory | Compliant |
| `description` < 1024 chars | Compliant |
| Progressive disclosure (frontmatter at startup, body on activation) | Compliant |
| Line count < 500 (recommended) | 6/9 comply; vibes (607), sell (779), test (719) exceed due to multi-phase workflows |

## What the Standard Covers

- **SKILL.md format**: YAML frontmatter schema with `name`, `description`, `license`, `allowed-tools`, `metadata`
- **Directory structure**: conventions for `scripts/`, `references/`, `assets/` subdirectories
- **Progressive disclosure**: agents read frontmatter at startup for skill selection, load the full body only on activation
- **`allowed-tools`**: pre-approved tool declarations so agents can grant permissions before execution

## What We Add: The `.codex/` System

The Agent Skills standard defines the skill format but not:
- How agents discover skills across install locations
- How to translate tool names between agents
- How to detect project state and recommend skills

The `.codex/` directory solves these last-mile problems.

### vibes-codex CLI

File: `.codex/vibes-codex`

A 4-command router for non-Claude-Code agents:

| Command | Purpose |
|---|---|
| `bootstrap` | Inject context: tool mappings, skill list, critical rules |
| `use-skill <name>` | Load a skill's SKILL.md (strips frontmatter, outputs body) |
| `run <script> [args]` | Execute a vibes script with `VIBES_PLUGIN_ROOT` set |
| `find-skills` | List available skills with descriptions from frontmatter |

### vibes-bootstrap.md

File: `.codex/vibes-bootstrap.md`

Tool mapping table that translates Claude Code tool names to generic equivalents:

| Claude Code Tool | Generic Equivalent |
|---|---|
| `AskUserQuestion` | Prompt user directly |
| `Skill` tool | `vibes-codex use-skill` command |
| `Task` tool (subagents) | Spawn parallel agents if available; otherwise sequential |
| `Read`, `Write`, `Edit`, `Bash` | Use native equivalents |
| `${CLAUDE_PLUGIN_ROOT}` | `~/.vibes` |

### INSTALL.md

File: `.codex/INSTALL.md`

Fetchable installation guide: clone to `~/.vibes`, install deps, add a config block to the agent's system prompt that triggers `vibes-codex bootstrap` on startup.

### resolve-paths.js

File: `lib/resolve-paths.js`

Canonical path resolution that finds the plugin directory across four install locations (checked in order):

1. `VIBES_PLUGIN_ROOT` environment variable
2. Claude Code plugin cache (`~/.claude/plugins/cache/vibes-cli/vibes/<version>`)
3. Standard git clone (`~/.vibes`)
4. Development mode (relative to script location)

## Three-Tier Distribution Model

| Tier | Agent | Discovery | Context Injection |
|---|---|---|---|
| Native | Claude Code | Marketplace install | SessionStart hook via `hooks/hooks.json` (automatic) |
| CLI | Codex, OpenCode | `git clone` + config | `vibes-codex bootstrap` (manual trigger) |
| Manual | Cursor, Gemini, others | `git clone` | Read `skills/` directory directly |

**Native tier** uses a SessionStart hook (`hooks/session-start.sh`) that fires on startup, resume, clear, and compact events. It reads `hooks/session-context.md` for static skill-awareness context, then detects project state (`.env` presence, Clerk keys, `app.jsx`, `index.html`) and appends dynamic hints.

**CLI tier** relies on the agent's config to trigger `vibes-codex bootstrap` at session start. The bootstrap command outputs the same skill-awareness context plus a tool mapping table.

**Manual tier** works with any agent that can read files. Point the agent at `skills/` and let it read SKILL.md files directly.

## Adding Vibes Skills to Other Agents

For any agent that supports the Agent Skills standard:

1. Clone: `git clone https://github.com/popmechanic/vibes-cli.git ~/.vibes`
2. Install deps: `cd ~/.vibes/scripts && npm install`
3. Point your agent's skill search path at `~/.vibes/skills/`

For agents without native skill support, add the bootstrap block to your agent's config (see `.codex/INSTALL.md` for the exact snippet).

## Agent-Specific Skill: `launch`

The `launch` skill (`skills/launch/SKILL.md`) requires Claude Code Agent Teams (`Task`, `Teammate`, `SendMessage` tools). Its frontmatter declares this via a `compatibility` field:

```yaml
compatibility: Requires Claude Code with Agent Teams support
```

The `.codex/vibes-codex` CLI auto-discovers skills from the filesystem and excludes any skill whose `compatibility` field mentions "Claude Code". The bootstrap context directs non-Claude-Code agents to the sequential alternative: run `vibes`, `sell`, `connect`, and `cloudflare` skills one after another.
