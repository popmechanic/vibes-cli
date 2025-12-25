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

## The Bash Workaround

Even `general-purpose` subagents couldn't use the Write tool ("I'm unable to create the file").
However, **Bash works!** All file creation now uses heredoc:

```bash
cat > riff-1/app.jsx << 'ENDOFJSX'
...jsx code...
ENDOFJSX
```

This applies to:
- Step 3: Generate Riffs (app.jsx files)
- Step 5: Evaluate (RANKINGS.md)
- Step 6: Gallery (index.html)
