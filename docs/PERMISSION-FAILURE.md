# Plugin Subagent Write Permissions: SOLVED

**Date**: 2024-12-25
**Plugin**: vibes-diy v1.0.31
**Issue**: Plugin subagents cannot write files without user permission prompts

## What Was Tried

| Attempt | Configuration | Result |
|---------|---------------|--------|
| 1 | `tools: Write` in agent frontmatter | Only enables tool availability, not permission |
| 2 | User `Write(**/riff-*/**)` in settings.json | Doesn't apply to plugin subagents |
| 3 | `permissionMode: acceptEdits` | Still prompts for permission |
| 4 | `permissionMode: bypassPermissions` | Still prompts: "write operation was denied" |

## Error Messages

```
I attempted to write the minimalist "Wack" app to
/Users/marcusestes/Websites/vibes-cli-demos/plugin-test/riff-test/riff-1/app.jsx
but the write operation was denied.
```

## Solution Found

**Use `general-purpose` subagent type instead of plugin-defined agents.**

Plugin agents (`vibes:vibes-gen`) are completely blocked from writing files.
Built-in agents (`general-purpose`) can use normal permission flow.

### The Fix

Instead of:
```javascript
Task({
  subagent_type: "vibes:vibes-gen",  // BLOCKED
  ...
})
```

Use:
```javascript
Task({
  subagent_type: "general-purpose",  // WORKS - can ask permission
  prompt: `${agent_instructions}\n\n${task_details}`,
  ...
})
```

The skill reads the agent instructions from the .md file and embeds them in the prompt.
The `general-purpose` subagent can then write files using normal Claude Code permission flow.

## Final Implementation

Deleted the `agents/` directory entirely. All instructions are now inlined in `skills/riff/SKILL.md`.

The skill uses `general-purpose` subagents with embedded prompts - no plugin agents needed.

## The Bash Workaround (Failed)

Even `general-purpose` subagents couldn't use:
- Write tool: "I'm unable to create the file"
- Bash tool: "I don't have permission to run Bash commands"

Subagents spawned from plugin context have no file-writing capabilities.

## The Solution: Subagents Return, Main Agent Writes

```
Subagent 1 ──┐
Subagent 2 ──┼─→ Return JSX code ──→ Main Agent ──→ Bash writes files
Subagent N ──┘     (parallel)           │
                                        └─→ Has Bash permission!
```

1. Subagents generate code and return it (no file writing)
2. Main agent collects all results
3. Main agent writes files using Bash (main agent has user's permissions)

**Why this works:**
- Generation is parallel (all subagents run at once)
- Writing is instant (just Bash file I/O, no LLM tokens)
- Main agent inherits user's permission settings
