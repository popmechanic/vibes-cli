---
name: Generation Rules
description: >
  What generated Vibes app code must and must not contain — imports, store creation,
  sync UI, table name rules, template constraints, theme section markers, assembly workflow.
inject: system-prompt
---

**Platform Name vs User Intent**: "Vibes" is the name of this app platform (Vibes DIY). When users say "vibe" or "vibes" in their prompt, interpret it as:
- Their project/brand name ("my vibes tracker")
- A positive descriptor ("good vibes app")
- NOT as "mood/atmosphere" literally

Do not default to ambient mood generators, floating orbs, or meditation apps unless explicitly requested.

**Import Map Note**: The import map points TinyBase modules to esm.sh CDN URLs with `?external=react,react-dom` to prevent the React singleton problem. All TinyBase hooks are exposed as globals by the template — generated code uses them directly without imports.

## Core Rules

- **Use JSX** - Standard React syntax with Babel transpilation
- **Single HTML file** - App code assembled into template
- **TinyBase for data** - Use callback hooks (`useAddRowCallback`, `useSetCellCallback`, etc.) for all writes, query hooks (`useRowIds`, `useCell`, `useRow`) for reads
- **Auto-detect sync** - Template handles store setup, persistence, and WebSocket sync automatically
- **Tailwind for styling** - Mobile-first, responsive design
- **Minimize external dependencies** - Implement dynamic components (autocomplete, drag-and-drop, modals) yourself instead of pulling in libraries. Every esm.sh dependency risks the React singleton problem and adds load time. Only use external packages when the functionality is truly essential.
- **Data must be visible** - Every document type the app saves must be browseable in the UI. Lists should be on the main page, not hidden behind navigation. List items should be clickable for details. Never build a form that saves data the user can't find.
- **Keep code concise** - Shorter files mean faster iteration in the editor. Don't pad with comments or verbose abstractions.
- **Simple string table names** - Use string literals for table names: `useRowIds('todos')`, `useCell('items', id, 'name')`. Do not abstract table names into variables, constants, or template literals — each table name should be a plain string that appears directly in the hook call.

## Generation Process

### Step 0.5: Check for Design Reference

If the user provides a **reference image** (local file path or URL) or a **theme.html** file alongside their app description:

1. **Image reference** — Read the image (local path via Read tool, or URL via WebFetch). Analyze: extract colors, typography, layout structure, spacing, component patterns. Use these observations to guide your design reasoning and theme selection. Map extracted colors to `--comp-*` token values.
2. **theme.html reference** — Read the file. Look for a `<!-- VIBES-THEME-META ... -->` comment block with pre-selected themes and token values. Use these directly instead of the catalog selection in Step 1.75.
3. **No reference** — proceed normally to Step 1.

### Step 1: Design Reasoning

Before writing code, reason about the design in `<design>` tags:

```
<design>
- What is the core functionality and user flow?
- What OKLCH colors fit this theme? (dark/light, warm/cool, vibrant/muted)
- What layout best serves the content? (cards, list, dashboard, single-focus)
- What micro-interactions would feel satisfying? (hover states, transitions)
- What visual style matches the purpose? (minimal, bold, playful, professional)
</design>
```

### Step 1.1: Table Design

Before writing code, plan your TinyBase tables in the `<design>` block:

```
Tables:
- 'items' — main data (cells: name, description, createdAt, done)
- 'categories' — grouping (cells: name, color)

Values:
- 'sortOrder' — current sort preference
```

Use descriptive, lowercase, plural names. These exact strings appear in every hook call — `useRowIds('items')`, `useCell('items', id, 'name')`.

### Step 1.5: Read Design Tokens

**Read this file before generating code:**
```
Read file: ${CLAUDE_PLUGIN_ROOT}/build/design-tokens.txt
```
The token catalog defines all available CSS custom properties: `colors`, `radius`, `shadows`, `spacing`, `typography`, `vibes-core`, `vibes-buttons`, `vibes-grid`. It also includes the VIBES_THEME_CSS with `.btn` button classes, the grid/frame page styles, and a **Component Catalog** with bare HTML structures (card, input, badge, table, tabs, accordion, dialog, etc.).

**In your generated code:**
- **Wrap your App in a full-page container div** with `min-height: 100vh` and an explicit `background-color` — never leave the page background transparent or unstyled
- Use `var(--token-name)` references — NOT hardcoded color values
- Use `--color-*` for semantic colors, `--radius-*` for border-radius, `--shadow-brutalist-*` for neo-brutalist shadows
- Use `className="btn"` for buttons (pre-styled neo-brutalist)
- Use `className="grid-background"` on your app's root container for the default content grid background
- **Pick components from the catalog** (card, input, badge, table, etc.), then write CSS for their class names using the design tokens
- Override `--color-*` tokens in a `:root` style block for per-app theming

### Step 1.75: Select Theme

**Read the theme catalog FIRST** (it's small — just descriptions, not full theme files):
```
Read file: ${CLAUDE_SKILL_DIR}/themes/catalog.txt
```

Pick **1 theme** based on the app's content type and purpose, using each theme's BEST FOR and NOT FOR lists. If the user explicitly requests a specific theme, always follow their choice.

**ONLY THEN read the theme file you selected:**
```
Read file: ${CLAUDE_SKILL_DIR}/themes/{selected-theme}.txt
```

**Each theme file provides:**
- Color token overrides (`:root` values — use these exactly, they define the mood)
- Design principles (border style, typography, spacing, animation tempo)
- Reference CSS (study the aesthetic, then create your own interpretation)
- Personality notes (how the theme FEELS — guide your creative choices)
- Animation and SVG guidelines

Generate one layout using the selected theme's design principles. Do not add `useVibesTheme()` or theme branching — theme switching is handled by the live preview wrapper, not inside the app.

**CREATIVE LIBERTY:** Themes are mood boards, not templates. Two apps using the same theme should FEEL related but LOOK different. Use the color tokens exactly (they're the mood identity), follow the design principles, but invent unique layouts, card designs, hover effects, and decorative elements for each app. The reference CSS is ONE interpretation — don't copy it verbatim.

### Step 1.9: Generate Design Preview (OPTIONAL)

**Ask [Preview]**: "Want to preview the design as a standalone HTML page before I build the app?"
- "Yes" → Generate `theme.html` (see below), open in browser, iterate until the user is happy, then proceed to Step 2
- "No" → Skip directly to Step 2

**If the user says yes**, generate a standalone `theme.html` — a self-contained static page that demonstrates the visual design without React, TinyBase, or auth:

- **Single HTML file** with inline `<style>` and `<script>`. No external dependencies except Google Fonts via `@import`.
- **CSS custom properties** using `--comp-*` token overrides from the selected theme.
- **Realistic placeholder content** matching the app description (not lorem ipsum).
- **Interactive elements** — tabs switch, buttons have hover/active states, forms accept input. Wire with vanilla JS.
- **Animations and inline SVGs** following the theme's ANIMATIONS and SVG ELEMENTS guidelines.
- **Mobile-responsive** with `@media` breakpoints.

**Embed a metadata comment at the top** for downstream reference:
```html
<!-- VIBES-THEME-META
  source: prompt
  mood: "{theme mood}"
  theme: "{theme-id}"
  tokens: { "--comp-bg": "oklch(...)", "--comp-accent": "oklch(...)" }
  layout: "{layout-type}"
-->
```

Write to `./theme.html`. The user can open it in a browser, request changes, and iterate. When they're satisfied, proceed to Step 2 — use the design decisions from the preview to guide app.jsx generation.

> **Assembly: generate (preserve)** — `assemble.js` injects your code as-is. All TinyBase hooks and React are globals — no import statements needed.
>
> **If you're a launch/builder agent:** All hooks are globals provided by the template. Do not write any import statements. Follow builder.md rules.

### Step 2: Output Code

After reasoning, output the complete JSX in `<code>` tags.

**Theme Section Markers**: Organize all theme-sensitive CSS and JSX into marked sections. This enables fast, targeted theme switching.

```
<code>
const STYLE = `
/* @theme:tokens */
:root {
  --comp-bg: oklch(0.15 0.02 280);
  --comp-text: oklch(0.93 0.02 80);
  --comp-accent: oklch(0.72 0.15 75);
}
/* @theme:tokens:end */

/* @theme:typography */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
/* @theme:typography:end */

/* @theme:surfaces */
.card-glass { backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
/* @theme:motion:end */

/* Pure-layout ONLY (no visual properties) */
.app-grid { display: grid; gap: 1rem; }
`;

export default function App() {
  const { isReady, isSyncing } = useApp();
  // ... component logic using TinyBase hooks (useRowIds, useCell, useAddRowCallback, etc.)
  // Note: isReady is always true here — the template gates rendering automatically

  return (
    <>
      <style>{STYLE}</style>
      <div className="min-h-screen bg-[var(--comp-bg)] text-[var(--comp-text)] p-4">
        {/* @theme:decoration */}
        <svg className="atmospheric-bg">...</svg>
        {/* @theme:decoration:end */}

        {/* App content (not theme-sensitive) */}
        <div className="app-grid">...</div>
      </div>
    </>
  );
}
</code>
```

**Section rules:**
- `@theme:tokens` — `:root` CSS variables (colors, spacing tokens)
- `@theme:typography` — `@import` font URLs
- `@theme:surfaces` — ANY class with visual properties: color, background, border, box-shadow, font-family, font-size, font-weight, text-shadow, fill, stroke, opacity, gradients. Mixed layout+visual classes go here too.
- `@theme:motion` — `@keyframes` and animation definitions
- `@theme:decoration` — SVG elements, atmospheric backgrounds (in JSX)
- **Outside markers:** ONLY pure-layout classes (display, grid, gap, padding, margin, position, width/height, flex, overflow). If a class has ANY visual property, it goes in `@theme:surfaces`.

**TinyBase Hook Pattern**

All TinyBase hooks are globals provided by the template — no imports needed. The template creates the store, sets up persistence, and manages sync. Generated app code only needs to call hooks:

```jsx
// Hooks are globals — just use them directly
const { isReady, isSyncing } = useApp();
const ids = useRowIds('todos');
const text = useCell('todos', id, 'text');
const addTodo = useAddRowCallback('todos', () => ({ text: '', done: false }));
```

The template scope already contains React, the store, and all TinyBase hooks. Adding `import` statements creates duplicate module instances that break React's shared context. Similarly, calling `createMergeableStore()` creates a second disconnected store — the template's store is the one connected to sync.

**Sync Status**: `isSyncing` from `useApp()` indicates active sync. The template handles WebSocket connection and reconnection automatically.

**Don't build sync/connection status UI — not even decorative.** The template already renders a `SyncStatusDot` in the top-right corner that shows "synced", "connecting", "reconnecting", or "offline" automatically. Any text or element that implies connection state — whether dynamic OR static — confuses users by appearing alongside the built-in indicator. Use `isSyncing` for logic (e.g., disabling a save button while syncing) but never render status text or icons.

This includes **all** of the following, even as static/decorative labels:
```jsx
// NEVER render any of these — dynamic or static:
{isSyncing && <div className="sync-badge">Syncing...</div>}
<span className="status">{isOnline ? 'Online' : 'Offline'}</span>
<div className="connection-status">Connected</div>
<span>CREW ONLINE</span>        // static "online" label
<span>LIVE</span>               // static "live" badge
<div>● Connected</div>          // decorative connection dot

// isSyncing is fine for logic, just not for display:
const { isReady, isSyncing } = useApp();
if (!isReady) return <div>Loading...</div>;
```

**What Generated Code Must Never Contain:**
- `import` statements of any kind
- `createStore`, `createMergeableStore`, `createPersister`, `createSynchronizer`
- WebSocket URLs, auth logic, connection handling
- Direct `store.*` method calls — use callback hooks exclusively
- Schema definitions or store configuration
- Sync/connection status indicators — dynamic OR static (dots, badges, "online" labels, "connected" text, "LIVE" badges, "syncing" spinners, crew/user online counts) — the built-in `SyncStatusDot` already handles this
- Skipping `useApp()` in the root App component — always call `const { isReady, isSyncing } = useApp();` to activate sync
- `useState` for persistent data — use TinyBase tables for all data that should survive a reload; `useState` is only for ephemeral UI (modals, hover, in-progress form text)
- Objects or arrays as cell values — cells are scalars only (string, number, boolean)
- Non-string-literal table names — every table name must be a plain string literal directly in the hook call, not a variable, constant, or template literal

**User Identity (when needed)**

For user identity, use `useUser()` which returns `{ isSignedIn, user }` where `user` has `.email`, `.id`, `.firstName` (private apps only).

For shared/multiplayer apps: every user-owned row must include `createdBy: oidcUser.email` (not `useApp().user` which is always null in shared contexts).

## Assembly Workflow

1. Extract the code from `<code>` tags and write to `app.jsx`
2. Optionally save `<design>` content to `design.md` for documentation
3. **Ask [Preview]**: "Want to preview the app before deploying?"
   - "Yes — open live preview" — Start the preview server for iterating on the design
   - "No — deploy now" — Skip preview, go straight to deploy

   If yes: set `VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"` then run `bun "$VIBES_ROOT/scripts/server.ts"` and tell the user to open `http://localhost:3333`. They can chat to iterate on the design and switch themes. When satisfied, stop the server and continue.
4. Run assembly:
   ```bash
   VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
   bun "$VIBES_ROOT/scripts/assemble.js" app.jsx index.html
   ```
5. Deploy the app so the user can see it. Auto-invoke /vibes:cloudflare to deploy, then present the live URL.
