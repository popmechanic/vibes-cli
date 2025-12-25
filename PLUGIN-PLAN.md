# Vibes - Claude Code Plugin

> Generate React web apps with Fireproof database - no build step, single HTML file, deploy anywhere.

## Overview

This plugin enables Claude Code users to vibe code React applications. Apps are single HTML files with:

- **React 19** with JSX (Babel runtime transpilation)
- **Fireproof** for local-first database with encrypted sync
- **Tailwind CSS** for styling
- **ES modules** via import map (CDN)

## Installation

```bash
/plugin marketplace add popmechanic/vibes-skill
/plugin install vibes@vibes-diy
```

**Important**: Restart Claude Code after installation to load skills.

When installed, the plugin lives at:
```
~/.claude/plugins/cache/vibes-diy/vibes/1.0.0/
```

## Skills & Commands

| Name | Type | Description |
|------|------|-------------|
| `vibes` | Skill (model-invoked) | Generate or modify Vibes apps based on user intent |
| `riff` | Skill (model-invoked) | Generate multiple app variations in parallel with business models |
| `sync` | Command (user-invoked) | Refresh cached documentation from upstream |

**Note**: Skills are model-invoked - Claude automatically uses them when the task matches. Users don't type `/vibes:vibes`, they just describe what they want to build.

## Agents

Used internally by the `riff` skill:

| Agent | Description |
|-------|-------------|
| `vibes-gen` | Generates a single Vibes app with business model canvas |
| `vibes-eval` | Evaluates and ranks riffs on business potential (5 criteria, 1-10 each) |
| `vibes-gallery` | Creates a dark mode gallery page showcasing all riffs |

## Plugin Structure

```
vibes-skill/
├── .claude-plugin/
│   ├── plugin.json           # Plugin manifest
│   └── marketplace.json      # Marketplace catalog
├── skills/
│   ├── vibes/
│   │   ├── SKILL.md          # Main skill definition
│   │   ├── DEPLOYMENT.md     # Static hosting guide
│   │   ├── templates/
│   │   │   └── index.html    # HTML template
│   │   └── cache/
│   │       ├── fireproof.txt    # Cached Fireproof docs
│   │       ├── style-prompt.txt # Default UI style (Neobrute Blueprint)
│   │       └── import-map.json
│   └── riff/
│       └── SKILL.md          # Riff skill definition
├── agents/
│   ├── vibes-gen.md
│   ├── vibes-eval.md
│   └── vibes-gallery.md
├── commands/
│   └── sync.md               # Sync command
├── scripts/
│   ├── sync.js               # Node script for syncing docs
│   └── assemble.js           # Template assembly script
├── vibes.png                 # Logo
└── README.md
```

## Key Technical Details

### Fireproof Pattern (Critical)

Apps must use the `useFireproof` hook - there is NO global Fireproof object:

```javascript
// CORRECT
import { useFireproof } from "use-fireproof";
const { database, useLiveQuery, useDocument } = useFireproof("my-app-db");

// WRONG - throws "Fireproof is not defined"
const db = Fireproof.fireproof("my-db");  // No global exists!
```

### Single HTML File

All code lives inline in the HTML file:
- App code in `<script type="text/babel">` (runtime JSX transpilation)
- Menu components in `<script type="module">` (React.createElement, no Babel needed)
- Template includes VibesSwitch and HiddenMenuWrapper components

### Import Map

The import map is synced from the vibes.diy repository. Current values are cached in `cache/import-map.json`.

**Critical**: The import map must include 9 entries (including absolute URL remappings) to prevent duplicate React instances. Run `/vibes:sync` to update from upstream.

See `CLAUDE.md` for detailed import map requirements.

## Riff Workflow

The `riff` skill generates multiple app variations in parallel:

1. User provides a loose prompt (e.g., "make me an app that could make money")
2. Skill creates `riff-1/`, `riff-2/`, etc. directories
3. Launches parallel `vibes-gen` agents to create variations
4. Runs `vibes-eval` to score and rank all riffs
5. Runs `vibes-gallery` to create a gallery landing page

Output structure:
```
./
├── index.html      # Gallery page
├── RANKINGS.md     # Scored rankings
├── riff-1/
│   ├── index.html  # App variation
│   └── BUSINESS.md # Business model canvas
├── riff-2/
│   └── ...
```

## UI Style (Neobrute Blueprint)

Generated apps use the Vibes default visual style - "Neobrute Blueprint":

- **Neo-brutalist aesthetic**: blocky geometry, oversized controls, thick 4-12px outlines
- **Hard shadow plates**: offset 6-12px bottom-right; active press reduces offset
- **Graph paper background**: grey-blue (#f1f5f9) with grid lines (#cbd5e1/#94a3b8)
- **Corner rule**: square (0px) OR very rounded (50%)—no in-between
- **Color palette**: #f1f5f9 #cbd5e1 #94a3b8 #64748b #0f172a #242424 #ffffff
- **Never use white text**—#ffffff is for surfaces only

The style prompt is cached at `cache/style-prompt.txt` and fetched from the vibes.diy repo.

## Sync Workflow

The `sync` command updates cached documentation:

```bash
bun scripts/fetch-prompt.ts --force
```

This fetches:
- Fireproof docs from https://use-fireproof.com/llms-full.txt
- Style prompt from https://github.com/VibesDIY/vibes.diy/blob/main/prompts/pkg/style-prompts.ts
- Import map versions from vibes.diy repository

## Assembly Workflow

The `vibes` skill uses a post-processing pipeline for efficient generation:

1. LLM generates only the App component code (JSX)
2. Code is written to `app.jsx`
3. `scripts/assemble.js` inserts code into template
4. Complete HTML with menu is output

The template at `skills/vibes/templates/index.html` includes:
- VibesSwitch and HiddenMenuWrapper menu components (React.createElement)
- Babel runtime for JSX transpilation
- Import map for ES module resolution

## Resources

- **Web App**: https://vibes.diy
- **GitHub**: https://github.com/popmechanic/vibes-skill
- **Discord**: https://discord.gg/vnpWycj4Ta
- **Fireproof**: https://fireproof.storage
