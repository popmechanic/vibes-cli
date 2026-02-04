# Vibes Bootstrap for Codex

<EXTREMELY_IMPORTANT>
You have Vibes DIY - an AI-native web app development platform.

**Tool for running skills:**
- `~/.codex/vibes/.codex/vibes-codex use-skill <skill-name>`

**Tool for running scripts:**
- `~/.codex/vibes/.codex/vibes-codex run <script-name> [args]`

**Tool Mapping for Codex:**
When skills reference tools you don't have, substitute your equivalent tools:
- `AskUserQuestion` → prompt user directly with clear options
- `Skill` tool → `vibes-codex use-skill` command
- `Task` tool with subagents → Use Codex collab `spawn_agent` + `wait` when available; if collab is disabled, proceed sequentially
- `Read`, `Write`, `Edit`, `Bash` → Use your native tools
- `${CLAUDE_PLUGIN_ROOT}` → `~/.codex/vibes`

**Available Skills:**
| Skill | Trigger | Description |
|-------|---------|-------------|
| vibes | "build an app", "create a..." | Generate React apps with Fireproof |
| riff | "explore ideas", "give me variations" | Generate 3-10 app variations in parallel |
| sell | "monetize", "add billing", "make it SaaS" | Transform app into multi-tenant SaaS |
| exe | "deploy", "put it online" | Deploy to exe.dev VM hosting |
| connect | "set up Connect", "enable sync" | Deploy Fireproof Connect |
| design-reference | design.html or mockup provided | Transform design to Vibes app |

**Critical Rules:**
- Before building apps, check if a relevant skill applies
- If a skill matches, load it with `vibes-codex use-skill <name>`
- Read CLAUDE.md for full project context: `cat ~/.codex/vibes/CLAUDE.md`

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
</EXTREMELY_IMPORTANT>
