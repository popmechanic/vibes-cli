---
name: vibes
argument-hint: "[prompt]"
description: Self-contained app generator — invoke this skill directly, do not decompose into sub-steps. Generates React web apps with TinyBase reactive data store. Use when creating new web applications, adding components, or working with real-time data. Ideal for quick prototypes and single-page apps that need real-time data sync.
license: MIT
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
metadata:
  author: "Marcus Estes"
---

> **Plan mode**: If you are planning work, this entire skill is ONE plan step: "Invoke /vibes:vibes". Do not decompose the steps below into separate plan tasks.

**Display this ASCII art immediately when starting:**

```
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░░▒▓███████▓▒░
░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░      ░▒▓█▓▒░
 ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░▒▓███████▓▒░░▒▓██████▓▒░  ░▒▓██████▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
  ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░             ░▒▓█▓▒░
   ░▒▓██▓▒░  ░▒▓█▓▒░▒▓███████▓▒░░▒▓████████▓▒░▒▓███████▓▒░
```

## Quick Navigation

- [Terminal or Editor](#step-0-terminal-or-editor-ui) — Choose how to build (ask first!)
- [Pre-Flight Check](#pre-flight-check) — Validate credentials before coding
- [Core Rules](#core-rules) — Essential guidelines for app generation
- [Generation Process](#generation-process) — Design reasoning and code output
- [Assembly Workflow](#assembly-workflow) — Build the final app
- [UI Style & Theming](#ui-style--theming) — OKLCH colors and design patterns
- [TinyBase Data API](#tinybase-data-api) — Hook reference, patterns, architectures
- [AI Features](#ai-features-optional) — Optional AI integration
- [Bug Prevention](#patterns-that-prevent-bugs) — Quick checklist
- [Extended Docs](#when-to-read-extended-docs) — Reference files for deeper patterns
- [Deployment Options](#deployment-options) — Where to deploy

---

# Vibes DIY App Generator

Generate React web applications using TinyBase for reactive data with real-time sync.

## Auth Check (silent — only prompt if needed)

Before asking Terminal or Editor, check for cached auth:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun --input-type=module -e "
import { readCachedTokens, isTokenExpired } from '$VIBES_ROOT/scripts/lib/cli-auth.js';
const tokens = readCachedTokens();
if (tokens && !isTokenExpired(tokens.expiresAt)) {
  console.log('AUTH_OK');
} else {
  console.log('AUTH_NEEDED');
}
"
```

- If `AUTH_OK` → proceed silently to "Terminal or Editor?" (do not mention auth)
- If `AUTH_NEEDED` → ask: "To deploy apps, you'll need a Vibes account. Sign in now? (A browser window will open for Pocket ID — takes about 10 seconds.)"
  - If yes:
    ```bash
    VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
    bun --input-type=module -e "
    import { getAccessToken } from '$VIBES_ROOT/scripts/lib/cli-auth.js';
    import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '$VIBES_ROOT/scripts/lib/auth-constants.js';
    const tokens = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID });
    if (tokens) console.log('Signed in successfully!');
    "
    ```
    Confirm success, then proceed to "Terminal or Editor?"
  - If no → proceed anyway (auth will be needed at deploy time)

---

## Step 0: Terminal or Editor UI?

**This is the very first question — ask before anything else (after auth check above).**
Do not check .env, credentials, or project state before asking this question.
Do not invoke any other skill before asking this question.
If Editor is chosen, skip all pre-flight checks — the editor handles everything.

Ask the user:
> "How do you want to build? **Editor** (opens a browser UI with live preview, chat, and deploy button) or **Terminal** (I'll generate and deploy from here)?"

Present Editor as the first/recommended option.

- **If Editor**: Start the editor server and **END YOUR TURN. Do not ask any more questions. Do not continue to Pre-Flight Check or any step below.** The editor UI handles the entire workflow — setup, generation, preview, deploy.

  Launch the editor server:
  ```bash
  VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
  bun "$VIBES_ROOT/scripts/server.ts" --mode=editor --prompt "USER_PROMPT_HERE"
  ```
  If no prompt was given, omit `--prompt`:
  ```bash
  VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
  bun "$VIBES_ROOT/scripts/server.ts" --mode=editor
  ```
  Tell the user: "Open http://localhost:3333 — the editor handles everything from here."
  **Your job is done. Stop. Do not read further. Do not proceed to any step below.**

- **If Terminal**: Continue with the pre-flight check and normal generation workflow below.

---

## ⛔ EVERYTHING BELOW IS TERMINAL MODE ONLY

**If the user chose Editor above, STOP. Do not read or execute anything below this line.**
**The editor UI handles setup, generation, preview, and deployment.**

---

## Pre-Flight Check

**Complete these steps before generating any app code.**

- Auth is automatic — on first deploy, a browser window opens for Pocket ID login
- Tokens are cached at `~/.vibes/auth.json` for subsequent deploys
- Sync infrastructure deploys automatically on first app deploy — no manual setup needed

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

**Don't build sync/connection status UI.** The template already renders a `SyncStatusDot` in the top-right corner that shows "synced", "connecting", "reconnecting", or "offline" automatically. If your app adds its own sync indicator, users will see two overlapping status elements — yours and the built-in one. Use `isSyncing` for logic (e.g., disabling a save button while syncing) but not for rendering status text or icons.

```jsx
// These all duplicate the built-in SyncStatusDot — don't render sync state:
{isSyncing && <div className="sync-badge">Syncing...</div>}
<span className="status">{isOnline ? 'Online' : 'Offline'}</span>
<div className="connection-status">Connected</div>

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
- Sync/connection status indicators (dots, badges, "online/offline" text, "syncing" spinners) — the built-in `SyncStatusDot` already handles this, and a custom one will visually overlap with it

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

---

## UI Style & Theming

### OKLCH Colors (Recommended)

Use OKLCH for predictable, vibrant colors. Unlike RGB/HSL, OKLCH has perceptual lightness - changing L by 10% looks the same across all hues.

```css
oklch(L C H)
/* L = Lightness (0-1): 0 black, 1 white */
/* C = Chroma (0-0.4): 0 gray, higher = more saturated */
/* H = Hue (0-360): color wheel degrees */
```

**Theme-appropriate palettes:**

```jsx
{/* Dark/moody theme */}
className="bg-[oklch(0.15_0.02_250)]"  /* Deep blue-black */

{/* Warm/cozy theme */}
className="bg-[oklch(0.25_0.08_30)]"   /* Warm brown */

{/* Fresh/bright theme */}
className="bg-[oklch(0.95_0.03_150)]"  /* Mint white */

{/* Vibrant accent */}
className="bg-[oklch(0.7_0.2_145)]"    /* Vivid green */
```

### Better Gradients with OKLCH

Use `in oklch` for smooth gradients without muddy middle zones:

```jsx
{/* Smooth gradient - no gray middle */}
className="bg-[linear-gradient(in_oklch,oklch(0.6_0.2_250),oklch(0.6_0.2_150))]"

{/* Sunset gradient */}
className="bg-[linear-gradient(135deg_in_oklch,oklch(0.7_0.25_30),oklch(0.5_0.2_330))]"

{/* Dark glass effect */}
className="bg-[linear-gradient(180deg_in_oklch,oklch(0.2_0.05_270),oklch(0.1_0.02_250))]"
```

### Neobrute Style (Optional)

For bold, graphic UI:

- **Borders**: thick 4px, dark `border-[#0f172a]`
- **Shadows**: hard offset `shadow-[6px_6px_0px_#0f172a]`
- **Corners**: square (0px) OR pill (rounded-full) - no in-between

```jsx
<button className="px-6 py-3 bg-[oklch(0.95_0.02_90)] border-4 border-[#0f172a] shadow-[6px_6px_0px_#0f172a] hover:shadow-[4px_4px_0px_#0f172a] font-bold">
  Click Me
</button>
```

### Glass Morphism (Dark themes)

```jsx
<div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-2xl">
  {/* content */}
</div>
```

### Color Modifications

Lighten/darken using L value:
- **Hover**: increase L by 0.05-0.1
- **Active/pressed**: decrease L by 0.05
- **Disabled**: reduce C to near 0

---

## TinyBase Data API

TinyBase is a reactive data store with fine-grained hooks. Data persists across sessions and syncs in real-time via WebSocket when deployed. The template manages all store setup, persistence, and synchronization — your code only uses hooks.

### Globals Available (provided by the template)

All of these are globally available — no imports needed. React globals: `React, useState, useEffect, useRef, useCallback, useMemo, createContext, useContext`. Auth (private apps only): `useUser, SignInButton, UserButton, SignedIn, SignedOut`. TinyBase existence/introspection hooks: `useHasRow, useHasCell, useHasValue, useCellIds, useTableIds`.

### TinyBase Hook API Reference

Every callback hook returns a function that takes **one argument** (the parameter). Do not call with `(null, value)` — the second argument is the Store, not your value.

**Reading data:**
```
useCell(tableId, rowId, cellId)        → Cell | undefined     (string, number, boolean, or undefined)
useRow(tableId, rowId)                 → {cellId: Cell}       (object of all cells in the row)
useTable(tableId)                      → {rowId: Row}         (re-renders on ANY change — use sparingly)
useValue(valueId)                      → Value | undefined    (string, number, boolean, or undefined)
useValues()                            → {valueId: Value}     (all app-level values)
useRowIds(tableId)                     → string[]             (all row IDs in the table)
useSortedRowIds(tableId, cellId?, descending?, offset?, limit?) → string[]
useRowCount(tableId)                   → number
useHasRow(tableId, rowId)              → boolean          (true if row exists — use for safe detail views)
useHasCell(tableId, rowId, cellId)     → boolean          (true if cell exists and is not undefined)
useHasValue(valueId)                   → boolean          (true if value has been set)
useCellIds(tableId, rowId)             → string[]         (all cell names in a row — for dynamic/flexible schemas)
useTableIds()                          → string[]         (all table names in the store)
```

**Writing data — callback hooks (all return `(parameter) → void`):**
```
useAddRowCallback(tableId, (parameter) → Row, deps?)
  Call:     addItem('my text')
  Callback: (text) => ({ text, createdAt: Date.now() })
  Returns:  the new row ID (string) via optional `then` callback

useSetCellCallback(tableId, rowId, cellId, (parameter) → Cell | MapCell, deps?)
  Call:     setName('new name')
  Callback: (newName) => newName                          — direct value
  Callback: (_e) => (currentValue) => !currentValue       — MapCell toggle pattern

useSetValueCallback(valueId, (parameter) → Value, deps?)
  Call:     setTheme('dark')
  Callback: (newTheme) => newTheme

useSetRowCallback(tableId, rowId, (parameter) → Row, deps?)
  Replaces the ENTIRE row — cells you omit get deleted. Prefer useSetPartialRowCallback.

useSetPartialRowCallback(tableId, rowId, (parameter) → Partial<Row>, deps?)
  Call:     updateItem({ name: 'new', done: true })
  Only updates the cells you return. Other cells preserved.

useDelRowCallback(tableId, rowId)
  Call:     deleteItem()   — no arguments needed

useDelCellCallback(tableId, rowId, cellId)
  Call:     clearName()    — no arguments needed

useDelTableCallback(tableId)
  Call:     clearAllTodos()  — removes every row in the table

useDelValueCallback(valueId)
  Call:     clearTheme()     — removes a stored Value
```

**State hooks (read + write like useState, but persisted and synced):**
```
useCellState(tableId, rowId, cellId)   → [Cell | undefined, (newValue: Cell) → void]
useRowState(tableId, rowId)            → [Row, (newRow: Row) → void]
useValueState(valueId)                 → [Value | undefined, (newValue: Value) → void]
```

**App context:**
```
useApp()  → { isReady: boolean, isSyncing: boolean }
  Required in root App component — activates sync. isReady is always true (template gates rendering).

useUser() → { isSignedIn: boolean, isLoaded: boolean, user: { email, id, firstName, lastName, username } }
  Private apps only. Email is always present. Use oidcUser.email as the user identifier.
```

### Data Access Patterns

### Always Call useApp()

Call `useApp()` in the root App component — this activates the sync connection. Without it, TinyBase data stays local-only and never syncs across devices.

```jsx
function App() {
  const { isReady, isSyncing } = useApp();
  // ... rest of your app
}
```

This is not optional. Never skip it. Never move it to a child component.

### Getting the Signed-In User

Do not use `useApp().user` — it is always null. Use `useUser()` instead:

```jsx
const { user: oidcUser, isSignedIn } = useUser();
const userEmail = oidcUser.email;   // always a string — OIDC guarantees it
const userName = oidcUser.firstName || oidcUser.email.split('@')[0];
```

`useUser()` is a global (no import needed). It returns `{ isSignedIn, isLoaded, user }` where `user` has `.email`, `.id`, `.firstName`, `.lastName`, `.username`.

**Email is always present** — the OIDC provider guarantees it, so use `oidcUser.email` directly (no `?.`, no fallback). The template gates rendering behind auth, so by the time your component runs, the user is always signed in and `email` is always a string. If you add optional chaining or a fallback like `|| 'anonymous'`, you're guarding against a case that can't happen — and the fallback creates a bug where every user appears identical.

**For auth gating:**
```jsx
const { isSignedIn } = useUser();
if (!isSignedIn) return <SignInButton />;
```

`useUser()` is only available in private apps (apps deployed with the Private toggle). In public apps, `useUser` is undefined — check with `typeof useUser === 'function'` before calling it.

For detailed code examples (reactivity, master-detail, filtering, forms, custom ordering, multi-table references), read `${CLAUDE_SKILL_DIR}/references/tinybase-patterns.md`.

**Essential patterns at a glance:**

```jsx
// List rows — useRowIds + child components (fine-grained reactivity)
const ids = useRowIds('todos');
ids.map(id => <TodoItem key={id} id={id} />);

// Read cells in child components
const text = useCell('todos', id, 'text');

// Add rows
const addTodo = useAddRowCallback('todos', (text) => ({
  text, done: false, createdAt: Date.now(),
}), []);

// Toggle with MapCell pattern
const toggleDone = useSetCellCallback('todos', id, 'done', (_e) => (cur) => !cur);

// State hooks — [value, setter] like useState but persisted
const [name, setName] = useCellState('todos', id, 'name');
const [theme, setTheme] = useValueState('theme');

// Pagination
const itemIds = useSortedRowIds('items', 'createdAt', true, page * 25, 25);

// Delete
const deleteTodo = useDelRowCallback('todos', id);
```

### Choosing Your Pattern

- **useCellState** = Read + write a single cell. Best for: inline editing, toggles.
- **useValueState** = Read + write an app-level value. Best for: settings, preferences.
- **useCell / useRow** = Read-only. Prefer `useCell` for fine-grained reactivity.
- **useAddRowCallback** = Create new rows. Best for: forms, new items.
- **useSetCellCallback** = Update a cell (supports MapCell toggle pattern). Best for: onClick handlers.
- **useSetPartialRowCallback** = Update multiple cells without replacing the row. Best for: form saves.
- **useRowIds + child components** = List all rows. Each child reads its own data.
- **useSortedRowIds** = Sorted/paginated lists. Best for: tables, feeds, leaderboards.
- **useValue / useSetValueCallback** = Read / write app-level values via callbacks.

### Common App Architectures

| App Type | Tables | Key Patterns |
|----------|--------|-------------|
| **Todo/Task list** | `tasks` | `useRowIds` + child items, `useSetCellCallback` for toggles, `useSortedRowIds` for ordering |
| **Kanban board** | `cards` | Status cell for columns, filter by status per column, `store.setCell` for cross-column moves |
| **Chat / Messaging** | `messages`, `users` | `useSortedRowIds('messages', 'timestamp')`, user email as row key in `users` table, auto-scroll with `useRef` |
| **Recipe / Content app** | `items` | Master-detail with `useState(selectedId)`, `useHasRow` for safe detail view, `useCellState` for live editing |
| **Multiplayer game** | `players`, `board` | Email-keyed rows in `players` for per-user state, shared game state in Values, turn tracking via `useValueState('currentTurn')` |
| **Dashboard / Analytics** | `entries` | `useSortedRowIds` with pagination, computed stats inline, `useValueState` for filter persistence |
| **Settings / Preferences** | (Values only) | `useValueState` for each setting — persists and syncs without needing a table |

### Game and Timer Patterns

Timer countdown is local UI state (`useState`), scores and progress belong in TinyBase. For turn-based games, store board state as shared data and player identity as per-user rows keyed by email. Full patterns: `${CLAUDE_SKILL_DIR}/references/game-patterns.md`.

### Multiplayer and Shared Apps

For multiplayer apps, read the full guide: `${CLAUDE_SKILL_DIR}/references/multiplayer-guide.md`.

Key principles:
- **Per-user state**: key rows by `oidcUser.email` — `useCellState('players', myEmail, 'team')`
- **Shared state**: use Values or auto-generated row IDs — `useValueState('gameStatus')`
- **User attribution**: add `createdBy: userEmail` to user-owned rows, filter by it to show "my stuff"
- **Users table**: every shared app registers users on load via `useSetRowCallback('users', myEmail, ...)`
- **Write through hooks**, not `store.*` — hooks notify React's reactivity system
- **Private apps required** — multiplayer needs auth for user identity (`useUser()`)
- **Direct `store.*` access**: only in `useEffect` when the row ID is determined at runtime (e.g., slot assignment)

---

## AI Features (Optional)

If the user's prompt suggests AI features (chatbot, summarize, generate, analyze, recommend), read the full guide: `${CLAUDE_SKILL_DIR}/references/ai-integration.md`.

Quick summary:
- **Detection signals**: "chatbot", "AI", "summarize", "generate", "smart"
- **Ask for OpenRouter key**: `https://openrouter.ai/keys`
- **`useAI()` returns**: `{ callAI, streamAI, loading, error, clearError }`
- **Isolate in a child component** — prevents AI loading state from re-rendering data components
- **Deploy with**: `--ai-key "sk-or-v1-..."` flag on deploy command

---

## Sharing / Inviting Users

Sharing is handled at the deployment level — the WebSocket sync room is scoped per app. Users who have the app URL can collaborate in real-time. Access control is managed by the deploy infrastructure.

---

## Reference App

Complete working example — a shared grocery list. Study this pattern before generating code:

```jsx
export default function App() {
  const { isReady, isSyncing } = useApp();
  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">Grocery List</h1>
      <AddItem />
      <ItemList />
    </div>
  );
}

function AddItem() {
  const [input, setInput] = useState('');
  const addItem = useAddRowCallback(
    'items',
    (text) => ({
      name: text ?? '',
      bought: false,
      createdAt: Date.now(),
    }),
    [],
  );
  const handleAdd = () => {
    if (input.trim()) {
      addItem(input.trim());
      setInput('');
    }
  };
  return (
    <div className="flex gap-2 mb-4">
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        className="flex-1 border rounded px-3 py-2"
        placeholder="Add item..."
      />
      <button onClick={handleAdd} className="btn">Add</button>
    </div>
  );
}

function ItemList() {
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;
  const totalItems = useRowCount('items');
  const itemIds = useSortedRowIds('items', 'createdAt', true, page * PAGE_SIZE, PAGE_SIZE);
  return (
    <div>
      {itemIds.map(id => <GroceryItem key={id} id={id} />)}
      {totalItems > (page + 1) * PAGE_SIZE && (
        <button onClick={() => setPage(p => p + 1)} className="w-full py-2 text-sm opacity-60">
          Load more
        </button>
      )}
    </div>
  );
}

function GroceryItem({ id }) {
  const name = useCell('items', id, 'name');
  const bought = useCell('items', id, 'bought');
  const toggleBought = useSetCellCallback(
    'items', id, 'bought',
    (_e) => (current) => !current,
  );
  const remove = useDelRowCallback('items', id);

  return (
    <div className="flex items-center gap-2 py-2 border-b">
      <button onClick={toggleBought} className="w-6 h-6 flex items-center justify-center">
        {bought ? '✓' : '○'}
      </button>
      <span className={bought ? 'line-through opacity-40 flex-1' : 'flex-1'}>
        {name}
      </span>
      <button onClick={remove} className="text-red-400 text-sm">x</button>
    </div>
  );
}
```

**Key patterns demonstrated:**
- `useApp()` activates sync — called in root component
- `useAddRowCallback` with deps array for closures
- `useSortedRowIds` with pagination (PAGE_SIZE 25)
- `useCell` in child components for fine-grained reactivity
- `useSetCellCallback` with MapCell pattern `(_e) => (current) => !current` for toggles
- `useDelRowCallback` for deletion
- No imports, no store access, no schema — all hooks are globals

---

## Patterns That Prevent Bugs

Quick checklist — for detailed explanations and code examples, read `${CLAUDE_SKILL_DIR}/references/bug-prevention.md`.

- **Use `useCell` in child components**, not `useTable` — avoids re-rendering the entire list on every change
- **Use string literals for table names** — `useRowIds('todos')`, not variables or constants
- **Include closure deps** in callback hooks — `[oidcUser.email]` not `[]` when using email
- **Use `useSetPartialRowCallback`** instead of `useSetRowCallback` — preserves concurrent edits to other cells
- **Cells are scalars only** — strings, numbers, booleans. Objects in cells break CRDT granularity
- **Guard cell values** — `useCell`/`useValue` return `undefined` when unset; use `String(val || '')`
- **One argument per callback** — `setVal(x)` not `setVal(null, x)`. Second arg is the Store reference.
- **No imports, no `createStore`, no `store.*` writes** — hooks are globals, the template manages infrastructure
- **Seed demo data via button**, not `useEffect` on mount — hydration races cause data loss or duplication
- **Every app needs a "Load Demo Data" button** — visible when table is empty (`useRowCount('tableName') === 0`)
- **`isReady` is always true** — the template gates rendering. Use `useApp()` for sync activation, not readiness checks.

---

## When to Read Extended Docs

Read these reference files when the user's prompt matches the signals below:

| Need | Signal in Prompt | Read This |
|------|------------------|-----------|
| TinyBase data patterns | forms, lists, filtering, ordering, pagination, master-detail | `${CLAUDE_SKILL_DIR}/references/tinybase-patterns.md` |
| Multiplayer / shared apps | multiplayer, collaborative, shared, multi-user, game with players | `${CLAUDE_SKILL_DIR}/references/multiplayer-guide.md` |
| Game development | game, timer, countdown, turn-based, score | `${CLAUDE_SKILL_DIR}/references/game-patterns.md` |
| AI-powered features | AI, chatbot, summarize, generate, openrouter | `${CLAUDE_SKILL_DIR}/references/ai-integration.md` |
| Bug prevention reference | debugging, troubleshooting, reviewing code | `${CLAUDE_SKILL_DIR}/references/bug-prevention.md` |
| Design tokens & theming | colors, theme, tokens, brand colors, styling | `${CLAUDE_PLUGIN_ROOT}/build/design-tokens.txt` |
| Full Neobrute design details | detailed design system, spacing, typography | `${CLAUDE_SKILL_DIR}/defaults/style-prompt.txt` |
| Advanced visual effects | "interactive", "animated", "3D", "particles", "shader", "canvas" | `${CLAUDE_SKILL_DIR}/defaults/advanced-effects-prompt.txt` |

---

## Deployment Options

After generating your app, deploy it:

- **Cloudflare** - Edge deployment with Workers. Use `/vibes:cloudflare` to deploy.

---

## What's Next?

After generating and assembling the app, present these options using AskUserQuestion:

```
Question: "Your app is live! Want to turn it into a product? The /sell skill adds multi-tenant SaaS with auth and billing. Or pick another direction:"
Header: "Next"
Options:
- Label: "Keep improving this app"
  Description: "Continue iterating on what you've built. Add new features, refine the styling, or adjust functionality. Great when you have a clear vision and want to polish it further."

- Label: "Apply a design reference (/design)"
  Description: "Have a design.html or mockup file? This skill mechanically transforms your app to match it exactly - pixel-perfect fidelity with your TinyBase data binding preserved."

- Label: "Explore variations (/riff)"
  Description: "Not sure if this is the best approach? Riff generates 3-10 completely different interpretations of your idea in parallel. You'll get ranked variations with business model analysis to help you pick the winner."

- Label: "Make it a SaaS (/sell)"
  Description: "Ready to monetize? Sell transforms your app into a multi-tenant SaaS with Pocket ID authentication, subscription billing, and isolated databases per customer. Each user gets their own subdomain."

- Label: "Deploy to Cloudflare (/cloudflare)"
  Description: "Go live on the edge. Deploy to Cloudflare Workers with a subdomain registry, KV storage, and global CDN. Fast, scalable, and always on."

- Label: "I'm done for now"
  Description: "Wrap up this session. Your files are saved locally - come back anytime to continue."
```

**After user responds:**
- "Keep improving" → Acknowledge and stay ready for iteration prompts. After each round of changes to app.jsx, re-run assembly and re-deploy.
- "Apply a design reference" → Auto-invoke /vibes:design skill
- "Explore variations" → Auto-invoke /vibes:riff skill
- "Make it a SaaS" → Auto-invoke /vibes:sell skill
- "Deploy" → Auto-invoke /vibes:cloudflare skill
- "I'm done" → Confirm files saved, wish them well

**Do not proceed to code generation until:**
Pre-flight check is complete (auth is automatic on deploy — no credentials to collect).
