---
name: vibes
description: Self-contained app generator — invoke this skill directly, do not decompose into sub-steps. Generates React web apps with Fireproof database. Use when creating new web applications, adding components, or working with local-first databases. Ideal for quick prototypes and single-page apps that need real-time data sync.
license: MIT
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
metadata:
  author: "Marcus Estes"
  version: "0.1.63"
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

- [Pre-Flight Check](#pre-flight-check-connect-status) - Validate Connect setup before coding
- [Core Rules](#core-rules) - Essential guidelines for app generation
- [Generation Process](#generation-process) - Design reasoning and code output
- [Assembly Workflow](#assembly-workflow) - Build the final app
- [UI Style & Theming](#ui-style--theming) - OKLCH colors and design patterns
- [Fireproof API](#fireproof-api) - Database operations and hooks
- [AI Features](#ai-features-optional) - Optional AI integration
- [Common Mistakes](#common-mistakes-to-avoid) - Avoid these pitfalls
- [Deployment Options](#deployment-options) - Where to deploy

---

# Vibes DIY App Generator

Generate React web applications using Fireproof for local-first data persistence.

## Pre-Flight Check: Connect Status

**MANDATORY: Complete these steps BEFORE generating any app code.**

**Step 0: Check Connect Status**

Run this command first to validate all required credentials:
```bash
if test -f "./.env" && \
   grep -qE "^VITE_CLERK_PUBLISHABLE_KEY=pk_(test|live)_" ./.env 2>/dev/null && \
   grep -qE "^VITE_API_URL=" ./.env 2>/dev/null && \
   grep -qE "^VITE_CLOUD_URL=" ./.env 2>/dev/null; then
  echo "CONNECT_READY"
else
  echo "CONNECT_NOT_READY"
fi
```

**If output is "CONNECT_NOT_READY"**, Connect setup is required:

> Connect with Clerk authentication is required for Vibes apps.

Invoke `/vibes:connect` to deploy Connect, then return here when complete.

**If Connect IS set up** (CONNECT_READY), proceed directly to app generation. The assemble script will populate Connect config from .env.

**Platform Name vs User Intent**: "Vibes" is the name of this app platform (Vibes DIY). When users say "vibe" or "vibes" in their prompt, interpret it as:
- Their project/brand name ("my vibes tracker")
- A positive descriptor ("good vibes app")
- NOT as "mood/atmosphere" literally

Do not default to ambient mood generators, floating orbs, or meditation apps unless explicitly requested.

**Import Map Note**: The import map points `use-fireproof` to `/fireproof-vibes-bridge.js`, a bridge module that wraps the raw Fireproof bundle with sync status forwarding and an onTock kick effect. Your code uses `import { useFireproofClerk } from "use-fireproof"` and the browser resolves this through the bridge → `./fireproof-clerk-bundle.js`. This is intentional—the bridge ensures `useLiveQuery` subscribers see synced data and that `SyncStatusDot` gets live sync status via a window global.

## Core Rules

- **Use JSX** - Standard React syntax with Babel transpilation
- **Single HTML file** - App code assembled into template
- **Fireproof for data** - Use `useFireproofClerk` for database + sync
- **Auto-detect Connect** - Template handles Clerk auth when Connect is configured
- **Tailwind for styling** - Mobile-first, responsive design

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
- Use `var(--token-name)` references — NOT hardcoded color values
- Use `--color-*` for semantic colors, `--radius-*` for border-radius, `--shadow-brutalist-*` for neo-brutalist shadows
- Use `className="btn"` for buttons (pre-styled neo-brutalist)
- Use `className="grid-background"` on your app's root container for the default content grid background
- **Pick components from the catalog** (card, input, badge, table, etc.), then write CSS for their class names using the design tokens
- Override `--color-*` tokens in a `:root` style block for per-app theming

### Step 1.75: Ask Theme Count & Select Layout Themes

**Ask [Themes]**: "How many different themes do you want? (each theme = a completely different layout)"
- "1 theme" — Fastest generation, single layout
- "2 themes" — Two switchable layouts
- "3 themes (Recommended)" — Three switchable layouts for maximum variety

Store the answer as `themeCount` (1, 2, or 3).

**Read the theme catalog FIRST** (it's small — just descriptions, not full theme files):
```
Read file: ${CLAUDE_PLUGIN_ROOT}/skills/vibes/themes/catalog.txt
```

The catalog has 6 themes. Pick exactly `themeCount` themes based on:
- The app's content type and primary purpose
- Each theme's BEST FOR and NOT FOR lists
- If picking 2+: variety — the themes should feel distinct from each other
- Default is always a safe pick but don't default to it blindly

**ONLY THEN read the theme files you actually need** — one at a time, only for the themes you selected:
```
Read file: ${CLAUDE_PLUGIN_ROOT}/skills/vibes/themes/{selected-theme}.txt
```
Do NOT read theme files you won't use. Each file is large, so reading unnecessary ones wastes time.

**Each theme file provides:**
- Color token overrides (`:root` values — use these exactly, they define the mood)
- Design principles (border style, typography, spacing, animation tempo)
- Reference CSS (study the aesthetic, then create your own interpretation)
- Personality notes (how the theme FEELS — guide your creative choices)
- Animation and SVG guidelines

**CRITICAL — Different layouts, not just different colors (when themeCount > 1):**
Each theme MUST have a completely different HTML/JSX layout structure.
- Different page organization (split-pane vs. stacked sections vs. sidebar+main)
- Different element hierarchy (what's prominent, what's secondary)
- Different navigation patterns (tabs vs. nav links vs. HUD bar)
- Same data, same handlers, same state — different visual presentation

Use `if (theme === "xxx")` branches in the render to return entirely different JSX trees per theme. CSS-only differences (just swapping colors/fonts on the same HTML) are NOT sufficient.

**If themeCount is 1**, skip `useVibesTheme()` and the theme branching. Just generate one layout using the selected theme's design principles.

**CREATIVE LIBERTY:** Themes are mood boards, not templates. Two apps using the same theme should FEEL related but LOOK different. Use the color tokens exactly (they're the mood identity), follow the design principles, but invent unique layouts, card designs, hover effects, and decorative elements for each app. The reference CSS is ONE interpretation — don't copy it verbatim.

**Component consistency (when themeCount > 1):** All themes must use the same React state, event handlers, and data hooks. They differ only in JSX structure and CSS. This ensures theme switching works at runtime via `useVibesTheme()`.

**REQUIRED — Register themes for the menu (when themeCount > 1):**
The VibesPanel (settings menu) dynamically reads `window.__VIBES_THEMES__` to render theme-switch buttons. You MUST register your chosen themes at the top of app.jsx (before any component definitions):

```jsx
window.__VIBES_THEMES__ = [
  { id: "scrapbook", name: "Scrapbook" },
  { id: "default", name: "Neo-Brutalist" },
];
```

Replace the `id` and `name` values with your actual selected themes. The `id` must match the theme IDs used in your `useVibesTheme()` hook and `if (theme === "xxx")` branches. The `name` is the human-readable label shown on the button. If `window.__VIBES_THEMES__` is not set, the menu falls back to hardcoded default/archive/industrial buttons which won't match your themes.

**If themeCount is 1**, skip `window.__VIBES_THEMES__` — the design button won't show theme options.

**If the user explicitly requests specific themes**, always follow their choice. Otherwise, pick the best fits from the catalog.

### Step 1.9: Generate Design Preview (OPTIONAL)

**Ask [Preview]**: "Want to preview the design as a standalone HTML page before I build the app?"
- "Yes" → Generate `theme.html` (see below), open in browser, iterate until the user is happy, then proceed to Step 2
- "No" → Skip directly to Step 2

**If the user says yes**, generate a standalone `theme.html` — a self-contained static page that demonstrates the visual design without React, Fireproof, or Clerk:

- **Single HTML file** with inline `<style>` and `<script>`. No external dependencies except Google Fonts via `@import`.
- **CSS custom properties** using `--comp-*` token overrides from the selected theme(s).
- **Realistic placeholder content** matching the app description (not lorem ipsum).
- **Interactive elements** — tabs switch, buttons have hover/active states, forms accept input. Wire with vanilla JS.
- **Animations and inline SVGs** following the theme's ANIMATIONS and SVG ELEMENTS guidelines.
- **Mobile-responsive** with `@media` breakpoints.
- **Multi-theme switching** (if themeCount > 1) — use `[data-theme]` attribute on `<body>` with CSS custom property overrides per theme. Include a small theme-switcher UI. Vanilla JS toggles `document.body.dataset.theme`.

**Embed a metadata comment at the top** for downstream reference:
```html
<!-- VIBES-THEME-META
  source: prompt
  mood: "{theme mood}"
  themes: ["{theme-id-1}", "{theme-id-2}"]
  tokens: { "--comp-bg": "oklch(...)", "--comp-accent": "oklch(...)" }
  layout: "{layout-type}"
-->
```

Write to `./theme.html`. The user can open it in a browser, request changes, and iterate. When they're satisfied, proceed to Step 2 — use the design decisions from the preview to guide app.jsx generation.

> **Assembly: generate (preserve)** — `assemble.js` injects your code as-is. Import and export statements work because the import map intercepts bare specifiers at runtime. Code examples below include imports.
>
> **If you're a launch/builder agent:** Sell transforms vibes artifacts by *stripping* imports. When generating app.jsx for the launch pipeline, omit all imports — the sell template provides everything. Follow builder.md rules; use only the patterns from examples below, not the import lines.

### Step 2: Output Code

After reasoning, output the complete JSX in `<code>` tags:

```
<code>
import React, { useState } from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery, useDocument, syncStatus } = useFireproofClerk("app-name-db");
  // ... component logic

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] p-4">
      {/* Sync status indicator (optional) */}
      <div className="text-xs text-gray-500 mb-2">Sync: {syncStatus}</div>
      {/* Use --app-* tokens for surfaces and accents */}
      <div className="bg-[var(--app-surface)] border-4 border-[var(--app-border)] p-4">
        <button className="px-4 py-2 bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent-hover)]">
          Action
        </button>
      </div>
    </div>
  );
}
</code>
```

**⚠️ CRITICAL: Fireproof Hook Pattern**

The `@necrodome/fireproof-clerk` package exports ONLY `useFireproofClerk`. Always use this pattern:

```jsx
// ✅ CORRECT - This is the ONLY pattern that works
import { useFireproofClerk } from "use-fireproof";
const { database, useDocument, useLiveQuery, syncStatus } = useFireproofClerk("my-db");
const { doc, merge } = useDocument({ _id: "doc1" });

// ❌ WRONG - DO NOT USE (old use-vibes API)
import { toCloud, useFireproof } from "use-fireproof";  // WRONG - old API
import { useDocument } from "use-fireproof";  // WRONG - standalone import
const { attach } = useFireproof("db", { attach: toCloud() });  // WRONG - old pattern
```

**Sync Status**: `syncStatus` provides the current sync state. Values: `"idle"`, `"connecting"`, `"synced"`, `"reconnecting"`, `"error"`. Display it for user feedback.

**Connect Configuration**: Generated apps require Clerk authentication and cloud sync.
The `assemble.js` script populates `window.__VIBES_CONFIG__` from your `.env` file.
Apps will show a configuration error if credentials are missing.

## Assembly Workflow

1. Extract the code from `<code>` tags and write to `app.jsx`
2. Optionally save `<design>` content to `design.md` for documentation
3. Run assembly:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/assemble.js" app.jsx index.html
   ```
4. Deploy the app so the user can see it. Clerk auth requires a public URL — the app cannot be viewed locally. Auto-invoke /vibes:cloudflare to deploy, then present the live URL.

---

> **⚠️ DEPRECATED API:** Never use the old `useFireproof` with `toCloud()` pattern. See [references/DEPRECATED.md](references/DEPRECATED.md) for migration details if you encounter legacy code.

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

## Fireproof API

Fireproof is a local-first database - no loading or error states required, just empty data states. Data persists across sessions and syncs in real-time when Connect is configured.

### Setup
```jsx
import { useFireproofClerk } from "use-fireproof";

const { database, useLiveQuery, useDocument, syncStatus } = useFireproofClerk("my-app-db");
```

**Note**: When Connect is configured (via .env), the template wraps your App in `ClerkFireproofProvider`, enabling authenticated cloud sync automatically. Your code just uses `useFireproofClerk`.

### Choosing Your Pattern

**useDocument** = Form-like editing. Accumulate changes with `merge()`, then save with `submit()` or `save()`. Best for: text inputs, multi-field forms, editing workflows.

**database.put() + useLiveQuery** = Immediate state changes. Each action writes directly. Best for: counters, toggles, buttons, any single-action updates.

```jsx
// FORM PATTERN: User types, then submits
const { doc, merge, submit } = useDocument({ title: "", body: "", type: "post" });
// merge({ title: "..." }) on each keystroke, submit() when done

// IMMEDIATE PATTERN: Each click is a complete action
const { docs } = useLiveQuery("_id", { key: "counter" });
const count = docs[0]?.value || 0;
const increment = () => database.put({ _id: "counter", value: count + 1 });
```

**WARNING — merge() + submit() timing trap:** Never `merge()` a computed value (like `Date.now()` or `crypto.randomUUID()`) and call `submit()` in the same event handler. React batches state updates, so `submit()` reads stale state and the merged field may be missing from the saved document. Use `database.put()` with explicit fields instead:

```jsx
// BAD — ts may not be saved due to React batching
merge({ ts: Date.now() });
submit();

// GOOD — all fields written atomically
await database.put({ text: doc.text, ts: Date.now(), type: "item" });
reset();
```

### useDocument - Form State (NOT useState)

**IMPORTANT**: Don't use `useState()` for form data. Use `merge()` and `submit()` from `useDocument`. Only use `useState` for ephemeral UI state (active tabs, open/closed panels).

```jsx
// Create new documents (auto-generated _id recommended)
const { doc, merge, submit, reset } = useDocument({ text: "", type: "item" });

// Edit existing document by known _id
const { doc, merge, save } = useDocument({ _id: "user-profile:abc@example.com" });

// Methods:
// - merge(updates) - update fields: merge({ text: "new value" })
// - submit(e) - save + reset (for forms creating new items)
// - save() - save without reset (for editing existing items)
// - reset() - discard changes
```

### useLiveQuery - Real-time Lists

```jsx
// Simple: query by field value
const { docs } = useLiveQuery("type", { key: "item" });

// Recent items (_id is roughly temporal - great for simple sorting)
const { docs } = useLiveQuery("_id", { descending: true, limit: 100 });

// Range query
const { docs } = useLiveQuery("rating", { range: [3, 5] });
```

**CRITICAL**: Custom index functions are SANDBOXED and CANNOT access external variables. Query all, filter in render:

```jsx
// GOOD: Query all, filter in render
const { docs: allItems } = useLiveQuery("type", { key: "item" });
const filtered = allItems.filter(d => d.category === selectedCategory);
```

### Direct Database Operations
```jsx
// Create/update
const { id } = await database.put({ text: "hello", type: "item" });

// Delete
await database.del(item._id);
```

### Common Pattern - Form + List
```jsx
import React from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery, useDocument, syncStatus } = useFireproofClerk("my-db");

  // Form for new items (submit resets for next entry)
  const { doc, merge, submit } = useDocument({ text: "", type: "item" });

  // Live list of all items of type "item"
  const { docs } = useLiveQuery("type", { key: "item" });

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] p-4">
      {/* Optional sync status indicator */}
      <div className="text-xs text-gray-500 mb-2">Sync: {syncStatus}</div>
      <form onSubmit={submit} className="mb-4">
        <input
          value={doc.text}
          onChange={(e) => merge({ text: e.target.value })}
          className="w-full px-4 py-3 border-4 border-[var(--app-border)]"
        />
        <button type="submit" className="mt-2 px-4 py-2 bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent-hover)]">
          Add
        </button>
      </form>
      {docs.map(item => (
        <div key={item._id} className="p-2 mb-2 bg-[var(--app-surface)] border-4 border-[var(--app-border)]">
          {item.text}
          <button onClick={() => database.del(item._id)} className="ml-2 text-[var(--vibes-red-accent)]">
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
```

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

The `useAI` hook is automatically included in the template when AI features are detected:

```jsx
import React from "react";
import { useFireproofClerk } from "use-fireproof";

export default function App() {
  const { database, useLiveQuery, syncStatus } = useFireproofClerk("ai-chat-db");
  const { callAI, loading, error } = useAI();

  const handleSend = async (message) => {
    // Save user message
    await database.put({ role: "user", content: message, type: "message" });

    // Call AI
    const response = await callAI({
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: message }]
    });

    // Save AI response
    const aiMessage = response.choices[0].message.content;
    await database.put({ role: "assistant", content: aiMessage, type: "message" });
  };

  // Handle limit exceeded
  if (error?.code === 'LIMIT_EXCEEDED') {
    return (
      <div className="p-4 bg-amber-100 text-amber-800 rounded">
        AI usage limit reached. Please wait for monthly reset or upgrade your plan.
      </div>
    );
  }

  // ... rest of UI
}
```

### useAI API

```jsx
const { callAI, loading, error, clearError } = useAI();

// callAI options
await callAI({
  model: "anthropic/claude-sonnet-4",  // or other OpenRouter models
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" }
  ],
  temperature: 0.7,  // optional
  max_tokens: 1000   // optional
});

// error structure
error = {
  code: "LIMIT_EXCEEDED" | "API_ERROR" | "NETWORK_ERROR",
  message: "Human-readable error message"
}
```

### Deployment with AI

When deploying AI-enabled apps, include the OpenRouter key:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-cloudflare.js" \
  --name myapp \
  --file index.html \
  --ai-key "sk-or-v1-your-key"
```

---

## Sharing / Inviting Users

The template includes a built-in invite UI in VibesPanel (the slide-out menu). For custom sharing in user app code, use the `useSharing` hook:

```javascript
const { inviteUser, listInvites, deleteInvite, findUser, ready } = window.useSharing();

// Invite by email
async function handleInvite(email) {
  if (!ready) return;
  const result = await inviteUser(email, 'read'); // 'read' or 'write'
  console.log('Invited:', result);
}
```

The hook is available on `window.useSharing` after Clerk loads. Check `ready` before calling methods.

---

## Common Mistakes to Avoid

- **DON'T** use `useState` for form fields - use `useDocument`
- **DON'T** use `Fireproof.fireproof()` - use `useFireproofClerk()` hook
- **DON'T** use the old `useFireproof` with `toCloud()` - use `useFireproofClerk` instead
- **DON'T** use white text on light backgrounds
- **DON'T** use `call-ai` directly - use `useAI` hook instead (it handles proxying and limits)
- **DON'T** use Fireproof's `_files` API for images — it has a sync bug where blobs arrive after metadata, causing 404s on other devices.
  Store image data as Uint8Array directly on documents:
  ```jsx
  // Convert file to Uint8Array (with resize)
  async function fileToImageData(file, maxDim = 1200) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(bitmap.width * scale, bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Display from Uint8Array
  function StoredImage({ data, type = 'image/jpeg', alt, className }) {
    const [url, setUrl] = useState(null);
    useEffect(() => {
      if (!data) return;
      // Fireproof CBOR round-trips Uint8Array as plain objects with numeric keys
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(Object.values(data));
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }, [data, type]);
    return url ? <img src={url} alt={alt} className={className} /> : null;
  }
  // Usage: <StoredImage data={doc.imageData} type={doc.imageType} alt="Photo" />
  ```
- **DON'T** call `merge()` and `submit()` in the same handler when adding computed fields
  (timestamps, UUIDs, derived values). React batches the state update from `merge()`, so
  `submit()` writes the old state. Use `database.put()` with explicit fields + `reset()` instead.
- **DON'T** spread `useDocument` doc into `database.put()` — internal CRDT metadata
  contaminates the write and can corrupt the database (`missing block` errors).
  Build documents with explicit fields instead:
  ```jsx
  // BAD — spreads internal metadata
  await database.put({ ...doc, completed: true });

  // GOOD — explicit fields only
  await database.put({ _id: doc._id, type: doc.type, todo: doc.todo, completed: true });
  ```
- **DON'T** wrap your app in `VibeContextProvider` - that's a vibes.diy platform-only component. Standalone apps use `useFireproofClerk()` directly.
- **DON'T** panic if you see "Cannot read properties of null (reading 'useContext')" - the template already handles the React singleton via `?external=react,react-dom` in the import map. Check that the import map wasn't accidentally modified.
- **NOTE:** Apps use `/fireproof-vibes-bridge.js` — this bridge module wraps the local Fireproof bundle with sync status forwarding + onTock kick. The bundle itself (`/fireproof-clerk-bundle.js`) is a temporary workaround that fixes a CID bug and includes sync improvements. Apps work correctly with it.
- **DON'T** hand-write `app.jsx` and assemble it manually — always generate through
  `/vibes:vibes`, even for test or diagnostic apps. The skill generates code that's
  compatible with the template by construction. Hand-written code may include imports
  or patterns that conflict with the template's runtime setup.

---

## When to Read Extended Docs

The shipped default files contain detailed reference material. Read them when the user's prompt matches these signals:

| Need | Signal in Prompt | Read This |
|------|------------------|-----------|
| Design tokens & theming | colors, theme, tokens, brand colors, styling | `${CLAUDE_PLUGIN_ROOT}/build/design-tokens.txt` |
| File uploads | "upload", "images", "photos", "attachments" | `${CLAUDE_PLUGIN_ROOT}/docs/fireproof.txt` → "Working with Images" |
| Auth / sync config | "Clerk", "Connect", "cloud sync", "login" | `${CLAUDE_PLUGIN_ROOT}/docs/fireproof.txt` → "ClerkFireproofProvider Config" |
| Sync status display | "online/offline", "connection status" | `${CLAUDE_PLUGIN_ROOT}/docs/fireproof.txt` → "Sync Status Display" |
| Full Neobrute design details | detailed design system, spacing, typography | `${CLAUDE_PLUGIN_ROOT}/skills/vibes/defaults/style-prompt.txt` |

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

- Label: "Apply a design reference (/design-reference)"
  Description: "Have a design.html or mockup file? This skill mechanically transforms your app to match it exactly - pixel-perfect fidelity with your Fireproof data binding preserved."

- Label: "Explore variations (/riff)"
  Description: "Not sure if this is the best approach? Riff generates 3-10 completely different interpretations of your idea in parallel. You'll get ranked variations with business model analysis to help you pick the winner."

- Label: "Make it a SaaS (/sell)"
  Description: "Ready to monetize? Sell transforms your app into a multi-tenant SaaS with Clerk authentication, subscription billing, and isolated databases per customer. Each user gets their own subdomain."

- Label: "Deploy to Cloudflare (/cloudflare)"
  Description: "Go live on the edge. Deploy to Cloudflare Workers with a subdomain registry, KV storage, and global CDN. Fast, scalable, and always on."

- Label: "I'm done for now"
  Description: "Wrap up this session. Your files are saved locally - come back anytime to continue."
```

**After user responds:**
- "Keep improving" → Acknowledge and stay ready for iteration prompts. After each round of changes to app.jsx, re-run assembly and re-deploy.
- "Apply a design reference" → Auto-invoke /vibes:design-reference skill
- "Explore variations" → Auto-invoke /vibes:riff skill
- "Make it a SaaS" → Auto-invoke /vibes:sell skill
- "Deploy" → Auto-invoke /vibes:cloudflare skill
- "I'm done" → Confirm files saved, wish them well

**Do NOT proceed to code generation until:**
Connect setup is complete with valid Clerk credentials in .env (pre-flight check returns CONNECT_READY).
