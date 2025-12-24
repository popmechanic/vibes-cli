# Vibes DIY Claude Code Plugin

> A Claude Code plugin for generating React web apps with Fireproof database - no build step, deploy anywhere.

## Overview

This plugin enables CLI users to vibe code React applications using the same prompt system as [vibes.diy](https://vibes.diy), but fully within Claude Code. Apps use:

- **React 19** for UI components (with `React.createElement`, no JSX build step)
- **Fireproof** for local-first database with encrypted sync
- **Tailwind CSS** for styling
- **CDN imports** via import map (no build step required)

## User Commands

| Command | Type | Description |
|---------|------|-------------|
| `/vibes:vibes` | Skill (model-invoked) | Generate or modify Vibes apps based on user intent |
| `/vibes:update-prompt` | Command (user-invoked) | Refresh cached documentation from upstream |

## Plugin Structure

```
vibes-skill/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── skills/
│   └── vibes/
│       ├── SKILL.md          # Main skill definition
│       ├── DEPLOYMENT.md     # Static hosting deployment guide
│       ├── templates/
│       │   └── index.html    # HTML template (skill reads this)
│       └── cache/
│           ├── fireproof.txt # Cached Fireproof docs (skill reads this)
│           └── import-map.json
├── commands/
│   └── sync.md               # Command to sync with upstream
├── scripts/
│   ├── fetch-prompt.ts       # Bun script for fetching docs
│   ├── transpile.ts          # Bun script for JSX→createElement
│   └── build-transpiler.sh   # Compiles transpile.ts to executable
├── bin/
│   └── transpile             # Compiled Bun executable (no deps needed)
├── src/
│   └── vibes-menu/           # TSX source from vibes.diy monorepo
│       ├── VibesSwitch.tsx
│       ├── VibesSwitch.styles.ts
│       ├── HiddenMenuWrapper.tsx
│       └── HiddenMenuWrapper.styles.ts
├── cache/
│   └── vibes-menu-transpiled.js  # Transpiled output (for reference)
└── templates/
    └── index.html            # Master template (copy to skills/vibes/templates/)
```

**Note**: The skill reads files relative to `SKILL.md`, so `templates/` and `cache/` must exist inside `skills/vibes/`. After updating the master template, copy it to `skills/vibes/templates/`.

---

## Vibes Menu Sync Workflow

The Vibes menu button (VibesSwitch + HiddenMenuWrapper) is ported from the vibes.diy monorepo. This section documents how to keep it in sync.

### Source Location

Components are in the vibes.diy monorepo at:
```
vibes.diy/vibes.diy/pkg/app/components/vibes/
├── VibesSwitch/
│   ├── VibesSwitch.tsx
│   └── VibesSwitch.styles.ts
└── HiddenMenuWrapper/
    ├── HiddenMenuWrapper.tsx
    └── HiddenMenuWrapper.styles.ts
```

GitHub: https://github.com/VibesDIY/vibes.diy/tree/main/vibes.diy/pkg/app/components/vibes

### Sync Steps (When vibes.diy Updates)

1. **Copy updated TSX files** from vibes.diy to `src/vibes-menu/`:
   ```bash
   # Fetch latest from GitHub raw URLs
   curl -o src/vibes-menu/VibesSwitch.tsx \
     https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/vibes.diy/pkg/app/components/vibes/VibesSwitch/VibesSwitch.tsx
   # ... repeat for other files
   ```

2. **Run the transpiler** to convert JSX → React.createElement:
   ```bash
   ./bin/transpile
   ```
   Output goes to `cache/vibes-menu-transpiled.js`

3. **Update templates/index.html** with the transpiled code:
   - Copy relevant functions from `cache/vibes-menu-transpiled.js`
   - Paste into the `<script type="module">` section

4. **Copy to skill directory** (so the skill can read them):
   ```bash
   cp templates/index.html skills/vibes/templates/
   cp cache/fireproof.txt skills/vibes/cache/
   ```

5. **Commit all changes**:
   - `src/vibes-menu/*.tsx` (source)
   - `cache/vibes-menu-transpiled.js` (generated)
   - `templates/index.html` (master template)
   - `skills/vibes/templates/index.html` (skill copy)
   - `skills/vibes/cache/` (skill copies)

### For Plugin Developers Only

If you modify `scripts/transpile.ts`, rebuild the executable:

```bash
./scripts/build-transpiler.sh
```

This compiles a standalone Bun binary to `bin/transpile`. Commit the binary so users don't need Bun installed.

### Why This Approach?

| Approach | Pros | Cons |
|----------|------|------|
| ~~NPM package~~ | Single source of truth | Requires npm publish workflow |
| ~~Runtime Babel~~ | Always current | Users need npm install |
| **Bun executable** | Zero user dependencies, fast | Manual sync required |

The Bun executable approach aligns with the "no build" philosophy:
- Users never run `npm install`
- The transpiler binary is self-contained (~60MB)
- Bun's built-in JSX transform eliminates Babel dependency

---

## Component Details

### 1. Plugin Manifest

**File:** `.claude-plugin/plugin.json`

```json
{
  "name": "vibes",
  "description": "Generate React web apps with Fireproof database - no build step, deploy anywhere",
  "version": "1.0.0",
  "author": {
    "name": "Vibes DIY"
  },
  "homepage": "https://vibes.diy",
  "repository": "https://github.com/VibesDIY/vibes.diy"
}
```

### 2. Transpiler Script

**File:** `scripts/transpile.ts`

Converts TSX source files to browser-ready JavaScript using Bun's built-in transpiler.

**Features:**
- Uses Bun's native JSX transform (no Babel)
- Converts `JSX` → `React.createElement()`
- Strips TypeScript types
- Outputs to `cache/vibes-menu-transpiled.js`

**Compiled Binary:** `bin/transpile`

Users run the pre-compiled binary - no Bun or Node required:
```bash
./bin/transpile
```

### 3. Main Skill (SKILL.md)

The skill provides Claude with:

**Workflow Detection:**
1. Check if project has index.html with Vibes imports
2. If Vibes project exists → add/modify components
3. If non-Vibes project exists → ask user preference:
   - "Add Vibes files to current directory"
   - "Create a `vibes/` subdirectory"
4. If empty directory → initialize with template

**System Prompt Instructions:**
- Use `React.createElement()` directly (NO JSX - requires build step)
- Use `const e = React.createElement` shorthand
- Use Fireproof for data persistence
- Use `useDocument` with `merge()` and `submit()` instead of `useState` for forms
- Use Tailwind CSS for mobile-first styling
- Keep everything in a single HTML file with inline `<script type="module">`
- Never create separate .js files (causes CORS errors locally)

### 4. HTML Template

**File:** `templates/index.html`

Full template with Vibes menu components inlined:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vibes App</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19",
      "react-dom": "https://esm.sh/react-dom@19",
      "react-dom/client": "https://esm.sh/react-dom@19/client",
      "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
      "call-ai": "https://esm.sh/call-ai@0.18.9?external=react,react-dom"
    }
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    // All code inline - includes VibesSwitch, HiddenMenuWrapper, App
  </script>
</body>
</html>
```

### 5. Deployment Guide

**File:** `skills/vibes/DEPLOYMENT.md`

Covers deployment to:
- **Netlify**: Drag-and-drop or CLI deploy
- **Vercel**: `vercel` command or dashboard
- **GitHub Pages**: Push to gh-pages branch
- **Cloudflare Pages**: Connect repo or direct upload
- **Any static host**: Just upload the HTML file

Key points:
- No build step required
- Import map handles dependencies via CDN
- Single HTML file is the entire app

---

## VibesSwitch Animation Details

The toggle button uses **SVG path morphing** for animation:

```javascript
// Two different path data strings for the white pill
const originalD = "M426.866,285.985...";  // Pill on RIGHT (D.I.Y visible)
const stretchedD = "M165.866,285.985..."; // Pill STRETCHED left (VIBES visible)

// CSS transition on the `d` attribute
style: { transition: "d 0.3s ease, transform 0.8s ease, fill 2s ease" }
```

**Letter color transitions with staggered timing:**
- V: 0.6s, I: 1.3s, B: 0.5s, E: 0.8s, S: 1.2s
- D: 1s, I: 1s, Y: 1s

**HiddenMenuWrapper animations:**
- Bounce on mount: `vibes-drop-to-close` keyframe (800ms)
- Content slide: `translateY(-${menuHeight}px)` with 0.4s ease
- Content blur: 4px when menu open
- Button position: `bottom: 16px`, `right: 0`

---

## Design Decisions

| Question | Decision |
|----------|----------|
| Plugin name | `vibes` (commands: `/vibes:vibes`, etc.) |
| JSX handling | Transpile to `React.createElement` (no runtime build) |
| Transpiler distribution | Compiled Bun executable (no user deps) |
| Menu sync strategy | Manual copy + transpile (Bun executable) |
| User flow | Single `/vibes:vibes` skill with context detection |
| Existing project | Ask user preference (current dir vs vibes/ subdir) |
| Initialization | Full HTML template with menu components |
| File structure | Single HTML file with inline JS (no CORS issues) |

---

## Technical Notes

### Why React.createElement Instead of JSX?

JSX requires a build step (Babel/TypeScript transpilation). To maintain the "no build" philosophy:

1. **Generated apps** use `React.createElement()` directly
2. **Source files** (in `src/vibes-menu/`) use JSX/TSX for readability
3. **Transpiler** converts JSX → createElement before distribution

### Import Map Configuration

The import map uses `?external=react,react-dom` to prevent duplicate React instances:

```json
{
  "use-fireproof": "https://esm.sh/use-vibes@0.18.9?external=react,react-dom",
  "call-ai": "https://esm.sh/call-ai@0.18.9?external=react,react-dom"
}
```

Without this, each package would bundle its own React, causing hooks errors.

### CSS Variables for Theming

The menu components use CSS variables with fallbacks:

```css
:root {
  --vibes-black: #000;
  --vibes-white: #fff;
  --hm-menu-bg: #e5e5e5;
  --hm-content-bg: #1e1e1e;
}
```

---

## Resources

- **Vibes DIY Web App**: https://vibes.diy
- **Source Repository**: https://github.com/VibesDIY/vibes.diy
- **Fireproof Docs**: https://use-fireproof.com/llms-full.txt
- **Claude Code Plugin Docs**: https://docs.anthropic.com/en/docs/claude-code
