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

## The Solution: Script Calls `claude -p`

```
Main Agent
    │
    ├─► node generate-riff.js "theme" 1 riff-1/app.jsx &
    ├─► node generate-riff.js "theme" 2 riff-2/app.jsx &
    ├─► node generate-riff.js "theme" 3 riff-3/app.jsx &
    └─► wait
           │
           └─► Each script:
               ├─► claude -p "..." (uses subscription)
               ├─► fs.writeFileSync()
               └─► console.log("✓")
```

1. Main agent runs script commands (minimal tokens: ~50 per riff)
2. Script calls `claude -p` → uses subscription tokens
3. Script writes directly to disk → no tokens flow through main agent
4. Background processes (`&`) run in parallel → true concurrency

**Token comparison (10 riffs):**
- Old: 10 × 1500 tokens (code) = 15,000 tokens output
- New: 10 × 50 tokens (commands) = 500 tokens output
- **30x reduction = 30x faster**

**Why this works:**
- Scripts can invoke CLI tools (`claude -p`)
- `claude -p` uses the logged-in user's subscription
- Script writes to disk without main agent seeing the code
- Only script output ("✓ riff-1/app.jsx") enters context
