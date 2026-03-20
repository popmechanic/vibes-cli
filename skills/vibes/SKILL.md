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

- [Terminal or Editor](#step-0-terminal-or-editor-ui) - Choose how to build (ask first!)
- [Pre-Flight Check](#pre-flight-check) - Validate credentials before coding
- [Core Rules](#core-rules) - Essential guidelines for app generation
- [Generation Process](#generation-process) - Design reasoning and code output
- [Assembly Workflow](#assembly-workflow) - Build the final app
- [UI Style & Theming](#ui-style--theming) - OKLCH colors and design patterns
- [TinyBase Data API](#tinybase-data-api) - Data store operations and hooks
- [AI Features](#ai-features-optional) - Optional AI integration
- [Common Mistakes](#common-mistakes-to-avoid) - Avoid these pitfalls
- [Deployment Options](#deployment-options) - Where to deploy

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
**DO NOT check .env, credentials, or project state before asking this question.**
**DO NOT invoke any other skill before asking this question.**
**If Editor is chosen, skip ALL pre-flight checks — the editor handles everything.**

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

**MANDATORY: Complete these steps BEFORE generating any app code.**

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

### Step 1.5: Read Design Tokens (MANDATORY)

**You MUST read this file before generating code:**
```
Read file: ${CLAUDE_PLUGIN_ROOT}/build/design-tokens.txt
```
The token catalog defines all available CSS custom properties: `colors`, `radius`, `shadows`, `spacing`, `typography`, `vibes-core`, `vibes-buttons`, `vibes-grid`. It also includes the VIBES_THEME_CSS with `.btn` button classes, the grid/frame page styles, and a **Component Catalog** with bare HTML structures (card, input, badge, table, tabs, accordion, dialog, etc.).

**In your generated code:**
- **ALWAYS wrap your App in a full-page container div** with `min-height: 100vh` and an explicit `background-color` — never leave the page background transparent or unstyled
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

Generate one layout using the selected theme's design principles. Do NOT add `useVibesTheme()` or theme branching — theme switching is handled by the live preview wrapper, not inside the app.

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
  const { isSyncing, user } = useApp();
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

**⚠️ CRITICAL: TinyBase Hook Pattern**

All TinyBase hooks are globals — never import them. The template sets up the store, persister, and synchronizer. Your code only uses hooks:

```jsx
// ✅ CORRECT — hooks are globals, no imports needed
const { isReady, isSyncing, user } = useApp();
const ids = useRowIds('todos');
const text = useCell('todos', id, 'text');
const addTodo = useAddRowCallback('todos', () => ({ text: '', done: false }));

// ❌ WRONG — DO NOT USE
import { useRow } from "tinybase/ui-react";           // WRONG - no imports
const store = createMergeableStore();                   // WRONG - template creates the store
store.setCell('todos', id, 'done', true);               // WRONG - use callback hooks
```

**Sync Status**: `isSyncing` from `useApp()` indicates active sync. The template handles WebSocket connection and reconnection automatically.

**What Generated Code Must Never Contain:**
- `import` statements of any kind
- `createStore`, `createMergeableStore`, `createPersister`, `createSynchronizer`
- WebSocket URLs, auth logic, connection handling
- Direct `store.*` method calls — use callback hooks exclusively
- Schema definitions or store configuration

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

All of these are globally available — no imports needed:
```
React, useState, useEffect, useRef, useCallback, useMemo,
createContext, useContext,
useApp,
useTable, useRow, useCell, useValue, useValues,
useRowIds, useSortedRowIds, useRowCount,
useAddRowCallback, useSetCellCallback, useSetRowCallback,
useSetPartialRowCallback, useDelRowCallback, useDelCellCallback,
useSetValueCallback
```

### Data Access Patterns

**Status check with useApp():**
```jsx
const { isReady, isSyncing, user } = useApp();
```
The template gates rendering until the store is ready. `useApp().isReady` is always `true` inside your App component — the template shows a loading state automatically. You can still destructure it for explicitness, but forgetting it won't crash the app.

**Fine-grained reactivity — each component calls its own hooks:**
```jsx
// GOOD — only re-renders when this row changes
function TodoItem({ id }) {
  const text = useCell('todos', id, 'text');
  const done = useCell('todos', id, 'done');
  return <div>{text}</div>;
}

// BAD — useTable re-renders on ANY cell change in the table
function App() {
  const todos = useTable('todos');
  // ...
}
```

**Adding rows with useAddRowCallback:**
```jsx
const addTodo = useAddRowCallback(
  'todos',
  (text) => ({
    text: text ?? '',
    done: false,
    createdBy: user?.name ?? 'anonymous',
    createdAt: Date.now(),
  }),
  [user],  // deps — include anything from closure that changes
);
```

**Toggling/incrementing with MapCell pattern:**
```jsx
const toggleDone = useSetCellCallback(
  'todos', id, 'done',
  (_e) => (currentValue) => !currentValue,
);
```

**Partial updates (prefer over full row replacement):**
```jsx
const updateName = useSetPartialRowCallback(
  'todos', id,
  (newName) => ({ name: newName }),
);
```

**Listing rows — use useRowIds + child components:**
```jsx
function TodoList() {
  const ids = useRowIds('todos');
  return ids.map(id => <TodoItem key={id} id={id} />);
}
```

**Pagination with useSortedRowIds:**
```jsx
const PAGE_SIZE = 25;
const itemIds = useSortedRowIds('items', 'createdAt', true, page * PAGE_SIZE, PAGE_SIZE);
```

**Values for app-level state:**
```jsx
const theme = useValue('theme');
const setTheme = useSetValueCallback('theme', (newTheme) => newTheme);
```

**Deleting rows:**
```jsx
const deleteTodo = useDelRowCallback('todos', id);
```

### Choosing Your Pattern

- **useCell / useRow** = Read single cells or full rows. Prefer `useCell` for fine-grained reactivity.
- **useAddRowCallback** = Create new rows with auto-generated IDs. Best for: forms, new items.
- **useSetCellCallback** = Update a single cell. Best for: toggles, counters, inline edits.
- **useSetPartialRowCallback** = Update multiple cells without replacing the whole row. Best for: form edits.
- **useRowIds + child components** = List all rows. Each child reads its own data via `useCell`.
- **useSortedRowIds** = Sorted/paginated lists. Best for: tables, feeds, leaderboards.
- **useValue / useSetValueCallback** = App-level singleton state (theme, settings, counters).

### Key Rules
- **Prefer `useCell` in child components** over `useTable` — avoids re-rendering the entire list on every change
- **Every app needs a "Load Demo Data" button** — visible only when the table is empty (`useRowCount('tableName') === 0`), using `useAddRowCallback` (not `useEffect` on mount)
- **Demo data must be realistic** for the app's domain, 3-5 rows with enough variety to populate all views
- **Cells are scalars only** — strings, numbers, booleans. Do NOT put objects or arrays in cells (cell-level last-writer-wins loses concurrent edits to different fields inside a nested object)
- **`isReady` check is now handled by the template** — your App component only renders after the store is hydrated. You can still use `const { isReady } = useApp()` for explicitness but it's always `true`.

---

## AI Features (Optional)

If the user's prompt suggests AI-powered features (chatbot, summarization, content generation, etc.), the app needs AI capabilities via the `useAI` hook.

### Detecting AI Requirements

Look for these patterns in the user's prompt:
- "chatbot", "chat with AI", "ask AI"
- "summarize", "generate", "write", "create content"
- "analyze", "classify", "recommend"
- "AI-powered", "intelligent", "smart" (in context of features)

### Collecting OpenRouter Key

When AI is needed, ask the user:

> This app needs AI capabilities. Please provide your OpenRouter API key.
> Get one at: https://openrouter.ai/keys

Store the key for use with the `--ai-key` flag during deployment.

### Using the useAI Hook

The `useAI` hook is automatically included in the template when AI features are detected.

**IMPORTANT:** Isolate `useAI()` in a child component to prevent AI loading/error state changes from re-rendering your data components. Use a child component for AI interactions:

```jsx
// AI interactions in a child component — isolated from data re-renders
function AIChatInput({ onSend }) {
  const { callAI, loading, error } = useAI();
  const [input, setInput] = React.useState("");

  const handleSend = async () => {
    if (!input.trim()) return;
    const message = input;
    setInput("");
    onSend({ role: "user", content: message });

    const aiText = await callAI({
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: message }]
    });
    if (aiText) onSend({ role: "assistant", content: aiText });
  };

  return (
    <div>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." />
      <button onClick={handleSend} disabled={loading}>{loading ? "Thinking..." : "Send"}</button>
      {error && <p style={{ color: "red" }}>{error.message}</p>}
    </div>
  );
}

// Main app — TinyBase hooks for data, AI in child component
export default function App() {
  const messageIds = useRowIds('messages');

  const addMessage = useAddRowCallback(
    'messages',
    (msg) => ({ role: msg.role, content: msg.content, timestamp: Date.now() }),
  );

  return (
    <div>
      {messageIds.map(id => <MessageRow key={id} id={id} />)}
      <AIChatInput onSend={addMessage} />
    </div>
  );
}

function MessageRow({ id }) {
  const role = useCell('messages', id, 'role');
  const content = useCell('messages', id, 'content');
  return <p><b>{role}:</b> {content}</p>;
}
```

### useAI API

```jsx
const { callAI, streamAI, loading, error, clearError } = useAI();
```

**`callAI` — non-streaming (one-shot requests):**

```jsx
const text = await callAI({
  model: "anthropic/claude-sonnet-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" }
  ],
});
if (!text) return; // error state set automatically
```

Returns `string` on success, `null` on error (never throws).

**`streamAI` — streaming (chat UIs):**

```jsx
const stream = streamAI({
  model: "anthropic/claude-sonnet-4",
  messages: [{ role: "user", content: userMessage }],
});
if (!stream) return; // error state set

let accumulated = "";
for await (const chunk of stream) {
  accumulated += chunk;
  setResponse(accumulated);
}
```

Returns an async iterator on success, `null` on error. App controls its own state.

**OpenRouter parameters** — pass any [OpenRouter API param](https://openrouter.ai/docs/api/reference/overview) directly:

```jsx
const text = await callAI({
  messages: [...],
  temperature: 0.7,
  max_tokens: 1000,
  response_format: { type: "json_object" },
  tools: [...],
});
```

**`raw: true`** — for tool calls or usage stats, get the full OpenRouter response object:

```jsx
const response = await callAI({ messages: [...], raw: true });
const toolCalls = response.choices[0].message.tool_calls;
```

**Error codes:**

```
error = {
  code: "NOT_CONFIGURED" | "AUTH_REQUIRED" | "UNAUTHORIZED" | "RATE_LIMITED" | "API_ERROR" | "NETWORK_ERROR",
  message: "Human-readable error message"
}
```

### Deployment with AI

When deploying AI-enabled apps, include the OpenRouter key:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
  --name myapp \
  --file index.html \
  --ai-key "sk-or-v1-your-key"
```

---

## Sharing / Inviting Users

Sharing is handled at the deployment level — the WebSocket sync room is scoped per app. Users who have the app URL can collaborate in real-time. Access control is managed by the deploy infrastructure.

---

## Reference App

Complete working example — a shared grocery list. Study this pattern before generating code:

```jsx
export default function App() {
  const { user } = useApp();
  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-bold mb-4">Grocery List</h1>
      <AddItem user={user} />
      <ItemList />
    </div>
  );
}

function AddItem({ user }) {
  const [input, setInput] = useState('');
  const addItem = useAddRowCallback(
    'items',
    (text) => ({
      name: text ?? '',
      bought: false,
      addedBy: user?.name ?? 'someone',
      createdAt: Date.now(),
    }),
    [user],
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
  const addedBy = useCell('items', id, 'addedBy');
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
      <span className="text-xs opacity-50">{addedBy}</span>
      <button onClick={remove} className="text-red-400 text-sm">x</button>
    </div>
  );
}
```

**Key patterns demonstrated:**
- `useApp()` for user context (isReady is always true — template gates rendering)
- `useAddRowCallback` with deps array including `user`
- `useSortedRowIds` with pagination (PAGE_SIZE 25)
- `useCell` in child components for fine-grained reactivity (not useTable)
- `useSetCellCallback` with MapCell pattern for toggles
- `useDelRowCallback` for deletion
- No imports, no store access, no schema

---

## Common Mistakes to Avoid

- **DON'T** use `useTable` on large tables — it re-renders on ANY cell change. Use `useRowIds` to get IDs, then `useCell` in child components for fine-grained reactivity.
  ```jsx
  // BAD — re-renders entire list when any todo changes
  function App() {
    const todos = useTable('todos');
    return Object.entries(todos).map(([id, row]) => <div key={id}>{row.text}</div>);
  }

  // GOOD — each child only re-renders when its own data changes
  function TodoList() {
    const ids = useRowIds('todos');
    return ids.map(id => <TodoItem key={id} id={id} />);
  }
  function TodoItem({ id }) {
    const text = useCell('todos', id, 'text');
    return <div>{text}</div>;
  }
  ```
- **DON'T** forget deps in `useAddRowCallback` — stale closures will capture old values:
  ```jsx
  // BAD — user is stale after it changes
  const addTodo = useAddRowCallback('todos', () => ({ createdBy: user?.name }));

  // GOOD — user in deps array
  const addTodo = useAddRowCallback('todos', () => ({ createdBy: user?.name }), [user]);
  ```
- **DON'T** use `useSetRowCallback` when you only need to update some cells — it replaces the entire row, deleting any cells you omit. Use `useSetPartialRowCallback` instead.
- **DON'T** put objects or arrays in cells — TinyBase cells are scalars (string, number, boolean). Cell-level last-writer-wins means concurrent edits to different fields inside a nested object will lose data. Flatten your data model.
- `isReady` check is now handled by the template — your App component only renders after the store is hydrated. You can still use `const { isReady } = useApp()` for explicitness but it's always `true`.
- **DON'T** use white text on light backgrounds
- **DON'T** use `fetch()` to call AI APIs directly — use `useAI` hook instead (it handles auth and proxying)
- **DON'T** write `import` statements — all hooks and React are globals provided by the template
- **DON'T** call `createStore`, `createMergeableStore`, or any store constructor — the template creates and manages the store
- **DON'T** call `store.setCell()` or other direct store methods — use callback hooks (`useSetCellCallback`, `useAddRowCallback`, etc.) which are properly bound to the store
- **DON'T** panic if you see "Cannot read properties of null (reading 'useContext')" - the template already handles the React singleton via `?external=react,react-dom` in the import map. Check that the import map wasn't accidentally modified.
- **DON'T** hand-write `app.jsx` and assemble it manually — always generate through
  `/vibes:vibes`, even for test or diagnostic apps. The skill generates code that's
  compatible with the template by construction. Hand-written code may include imports
  or patterns that conflict with the template's runtime setup.
- **DON'T** seed demo data in `useEffect` on mount — the store may not be ready. Use a "Load Demo Data" button with `useAddRowCallback`:
  ```jsx
  // BAD — races against store hydration
  React.useEffect(() => {
    if (useRowCount('todos') === 0) { /* seed data */ }
  }, []);

  // GOOD — user-triggered, store is ready by then
  function App() {
    const count = useRowCount('todos');
    const addTodo = useAddRowCallback('todos', (item) => item, []);
    const seedDemo = () => {
      DEFAULTS.forEach(item => addTodo(item));
    };
    return count === 0 ? <button onClick={seedDemo}>Load Demo Data</button> : <TodoList />;
  }
  ```

---

## When to Read Extended Docs

The shipped default files contain detailed reference material. Read them when the user's prompt matches these signals:

| Need | Signal in Prompt | Read This |
|------|------------------|-----------|
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

**Do NOT proceed to code generation until:**
Pre-flight check is complete (auth is automatic on deploy — no credentials to collect).
