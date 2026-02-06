# Vibes Bootstrap for Coding Agents

<EXTREMELY_IMPORTANT>
You have Vibes - a vibe coding stack made for coding agents.

**Tool for running skills:**
- `~/.vibes/.codex/vibes-codex use-skill <skill-name>`

**Tool for running scripts:**
- `~/.vibes/.codex/vibes-codex run <script-name> [args]`

**Tool Mapping:**
When skills reference Claude Code tools, substitute your equivalent:
- `AskUserQuestion` → prompt user directly with clear options
- `Skill` tool → `vibes-codex use-skill` command
- `Task` tool with subagents → spawn parallel agents if available; otherwise proceed sequentially
- `Read`, `Write`, `Edit`, `Bash` → Use your native tools
- `${CLAUDE_PLUGIN_ROOT}` → `~/.vibes`

**Available Skills:**
| Skill | Trigger | Description |
|-------|---------|-------------|
| vibes | "build an app", "create a..." | Generate React apps with Fireproof |
| riff | "explore ideas", "give me variations" | Generate 3-10 app variations in parallel |
| sell | "monetize", "add billing", "make it SaaS" | Transform app into multi-tenant SaaS |
| exe | "deploy", "put it online" | Deploy to exe.dev VM hosting |
| connect | "set up Connect", "enable sync" | Deploy Fireproof Connect |
| design-reference | design.html or mockup provided | Transform design to Vibes app |
| cloudflare | "deploy to cloudflare", "cloudflare workers" | Deploy to Cloudflare Workers with KV registry |
| test | "test the plugin", "integration test" | E2E test — assemble fixture, deploy, verify in browser |

> **Note:** The `launch` skill (full SaaS pipeline with Agent Teams) is available in Claude Code only. For Codex/OpenCode, run `vibes`, `sell`, `connect`, and `cloudflare` skills sequentially.

**Critical Rules:**
- Before building apps, check if a relevant skill applies
- If a skill matches, load it with `vibes-codex use-skill <name>`
- Read CLAUDE.md for full project context: `cat ~/.vibes/CLAUDE.md`

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
</EXTREMELY_IMPORTANT>
