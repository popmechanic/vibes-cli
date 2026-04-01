# Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `marked` + `DOMPurify` as a unified markdown engine across generated apps (via a `<Markdown>` component) and the editor chat (replacing the hand-rolled parser).

**Architecture:** Two integration points share the same libraries but load them differently — the base template uses ES module imports (import map), while the standalone editor uses `<script>` tags. A shared `.vibes-markdown` CSS class styles rendered output in generated apps; the editor keeps its existing `.chat-bubble.assistant` element-level CSS and gains coverage for new elements (`blockquote`, `table`, `hr`, `img`).

**Tech Stack:** `marked@15` (GFM parser, ~7KB gzip), `DOMPurify@3` (HTML sanitizer, ~3KB gzip), React 19, Tailwind v4, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-03-31-markdown-rendering-design.md`

---

### Task 1: Add marked + DOMPurify to base template import map

**Files:**
- Modify: `source-templates/base/template.html:118-134` (import map block)

- [ ] **Step 1: Add import map entries**

In `source-templates/base/template.html`, add two entries to the import map after the `oauth4webapi` entry (line 131):

```json
"marked": "https://esm.sh/marked@15?bundle",
"dompurify": "https://esm.sh/dompurify@3?bundle"
```

The full import map block should read:

```json
{
  "imports": {
    "react": "https://esm.sh/stable/react@19.2.4",
    "react/jsx-runtime": "https://esm.sh/stable/react@19.2.4/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/stable/react@19.2.4/jsx-dev-runtime",
    "react-dom": "https://esm.sh/stable/react-dom@19.2.4",
    "react-dom/client": "https://esm.sh/stable/react-dom@19.2.4/client",
    "tinybase": "https://esm.sh/tinybase@8?external=react,react-dom",
    "tinybase/mergeable-store": "https://esm.sh/tinybase@8/mergeable-store?external=react,react-dom",
    "tinybase/ui-react": "https://esm.sh/tinybase@8/ui-react?external=react,react-dom",
    "tinybase/persisters/persister-browser": "https://esm.sh/tinybase@8/persisters/persister-browser?external=react,react-dom",
    "tinybase/synchronizers/synchronizer-ws-client": "https://esm.sh/tinybase@8/synchronizers/synchronizer-ws-client?external=react,react-dom",
    "oauth4webapi": "https://esm.sh/stable/oauth4webapi@3.3.0",
    "marked": "https://esm.sh/marked@15?bundle",
    "dompurify": "https://esm.sh/dompurify@3?bundle"
  }
}
```

Neither library depends on React, so no `?external=react,react-dom` needed. `?bundle` bundles internal deps to avoid extra network requests.

- [ ] **Step 2: Add imports to module script**

In the same file, add import statements at the top of the `<script type="module">` block (after line 151, `import * as React from "react";`):

```js
import { marked } from "marked";
import DOMPurify from "dompurify";
```

- [ ] **Step 3: Commit**

```bash
git add source-templates/base/template.html
git commit -m "feat: add marked and DOMPurify to base template import map"
```

---

### Task 2: Add Markdown component to base template

**Files:**
- Modify: `source-templates/base/template.html:570-574` (end of module script, before theme exposure)

- [ ] **Step 1: Add Markdown component**

In `source-templates/base/template.html`, add the `Markdown` component after the `window.SharingBridge = SharingBridge;` line (line 489) and before the `// === VibesPanel Event Handler Hook ===` comment (line 492):

```js
      // === Markdown Renderer ===
      // Renders markdown text as styled HTML using marked (GFM) + DOMPurify.
      // Usage in generated apps: <Markdown text={someString} />
      function Markdown({ text }) {
        if (!text) return null;
        var html = React.useMemo(function() {
          return DOMPurify.sanitize(marked.parse(String(text)));
        }, [text]);
        return React.createElement('div', {
          className: 'vibes-markdown',
          dangerouslySetInnerHTML: { __html: html }
        });
      }
      window.Markdown = Markdown;
```

Note: Uses `var` instead of `const` to match the existing code style in the base template module script (which uses ES5-compatible patterns for the global components).

- [ ] **Step 2: Commit**

```bash
git add source-templates/base/template.html
git commit -m "feat: add global Markdown component to base template"
```

---

### Task 3: Add .vibes-markdown CSS to base template

**Files:**
- Modify: `source-templates/base/template.html:31-113` (style block)

- [ ] **Step 1: Add scoped CSS**

In `source-templates/base/template.html`, add the `.vibes-markdown` CSS block inside the `<style>` tag, after the `#container` rule (line 113) and before the closing `</style>` (line 114):

```css
      /* Markdown content styling — used by <Markdown> component */
      .vibes-markdown { line-height: 1.7; color: var(--comp-text, #111); }
      .vibes-markdown h1 { font-size: 1.75em; font-weight: 700; margin: 1.5em 0 0.5em; }
      .vibes-markdown h2 { font-size: 1.4em; font-weight: 600; margin: 1.4em 0 0.4em; }
      .vibes-markdown h3 { font-size: 1.15em; font-weight: 600; margin: 1.2em 0 0.3em; }
      .vibes-markdown h4, .vibes-markdown h5, .vibes-markdown h6 { font-size: 1em; font-weight: 600; margin: 1em 0 0.25em; }
      .vibes-markdown p { margin: 0.75em 0; }
      .vibes-markdown ul, .vibes-markdown ol { margin: 0.75em 0; padding-left: 1.5em; }
      .vibes-markdown ul { list-style-type: disc; }
      .vibes-markdown ol { list-style-type: decimal; }
      .vibes-markdown li { margin: 0.25em 0; }
      .vibes-markdown a { color: var(--comp-accent, #3b82f6); text-decoration: underline; }
      .vibes-markdown blockquote {
        border-left: 3px solid var(--comp-muted, #94a3b8);
        padding: 0.25em 1em;
        margin: 0.75em 0;
        color: var(--comp-muted, #64748b);
      }
      .vibes-markdown code {
        background: color-mix(in srgb, var(--comp-text, #111) 8%, transparent);
        padding: 0.15em 0.4em;
        border-radius: 4px;
        font-size: 0.9em;
      }
      .vibes-markdown pre {
        background: color-mix(in srgb, var(--comp-text, #111) 6%, transparent);
        padding: 1em;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0.75em 0;
      }
      .vibes-markdown pre code { background: none; padding: 0; }
      .vibes-markdown table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
      .vibes-markdown th, .vibes-markdown td {
        border: 1px solid var(--comp-border, #e5e7eb);
        padding: 0.5em 0.75em;
        text-align: left;
      }
      .vibes-markdown th { font-weight: 600; }
      .vibes-markdown hr { border: none; border-top: 1px solid var(--comp-border, #e5e7eb); margin: 1.5em 0; }
      .vibes-markdown img { max-width: 100%; border-radius: 6px; }
```

- [ ] **Step 2: Commit**

```bash
git add source-templates/base/template.html
git commit -m "feat: add .vibes-markdown scoped CSS to base template"
```

---

### Task 4: Add marked + DOMPurify script tags to editor

**Files:**
- Modify: `skills/vibes/templates/editor.html:1-10` (head section)

- [ ] **Step 1: Add script tags**

In `skills/vibes/templates/editor.html`, add two `<script>` tags in the `<head>` section, after the closing `</style>` tag and before the closing `</head>`:

```html
  <script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
```

These expose `marked` and `DOMPurify` as globals (UMD builds). The editor already loads Babel and other libs the same way.

Note: `marked` UMD exposes `marked.parse()` via the global `marked` object. `DOMPurify` UMD exposes `DOMPurify.sanitize()` via the global `DOMPurify` object. Both APIs match how we use them.

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: add marked + DOMPurify script tags to editor"
```

---

### Task 5: Replace hand-rolled markdown parser in editor

**Files:**
- Modify: `skills/vibes/templates/editor.html:5316-5452` (markdown renderer functions)

- [ ] **Step 1: Delete the four hand-rolled functions**

In `skills/vibes/templates/editor.html`, delete the following functions entirely:

1. `renderMarkdown()` — lines ~5317-5367 (code fence splitting + rendering)
2. `renderInlineMarkdown()` — lines ~5369-5432 (line-by-line header/list/paragraph parsing)
3. `inlineFormat()` — lines ~5434-5448 (bold/italic/code/link regex replacements)
4. `escapeHtml()` — lines ~5450-5452 (the local definition; the global `window.escapeHtml` at line 3368 remains)

Delete from the `// === Lightweight Markdown Renderer ===` comment (line 5316) through the end of `escapeHtml` (line 5452).

- [ ] **Step 2: Add the new renderMarkdown function**

In the same location (where the deleted code was), add:

```js
  // === Markdown Renderer (marked + DOMPurify) ===
  function renderMarkdown(text) {
    if (!text) return '';
    // Pre-pass: close unclosed code fences for streaming
    const fenceCount = (text.match(/^```/gm) || []).length;
    let processed = text;
    let hasUnclosed = false;
    if (fenceCount % 2 !== 0) {
      processed = text + '\n```';
      hasUnclosed = true;
    }
    let html = DOMPurify.sanitize(marked.parse(processed));
    // Style the last code block as pending if unclosed (streaming indicator)
    if (hasUnclosed) {
      html = html.replace(/<pre>(?![\s\S]*<pre>)/,
        '<pre style="opacity:0.5;border-style:dashed;">');
    }
    return html;
  }
```

This is a drop-in replacement — `updateStreamingBubble()` (line ~5471) already calls `renderMarkdown(streamingText.trimStart())` and sets `bubble.innerHTML` with the result. No changes needed to the streaming flow.

The regex `/<pre>(?![\s\S]*<pre>)/` matches the last `<pre>` tag in the output (negative lookahead ensures no subsequent `<pre>` exists). This gives the unclosed streaming code block the dimmed/dashed appearance, matching the previous behavior.

- [ ] **Step 3: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: replace hand-rolled markdown parser with marked + DOMPurify in editor"
```

---

### Task 6: Update editor addMessage to render assistant markdown

**Files:**
- Modify: `skills/vibes/templates/editor.html:5543-5580` (addMessage function)

- [ ] **Step 1: Update addMessage for assistant role**

Currently `addMessage()` uses `bubble.textContent = content` for all non-deploy messages (line 5570). Assistant messages should render markdown instead.

Replace this block (lines 5569-5571):

```js
    } else {
      bubble.textContent = content;
    }
```

With:

```js
    } else if (role === 'assistant') {
      bubble.innerHTML = renderMarkdown(content);
      bubble.style.whiteSpace = 'normal';
    } else {
      bubble.textContent = content;
    }
```

The `whiteSpace = 'normal'` is needed because the base `.chat-bubble` CSS may set `white-space: pre-wrap`. Setting it to `normal` enables proper HTML rendering, matching what `getOrCreateStreamingBubble()` already does (line 5464).

The `convertChoiceMarkers(bubble)` call at line 5573-5575 already handles HTML bubbles (it checks `bubble.style.whiteSpace === 'normal'` at line 5254 and extracts choices from `<p>` elements). No changes needed there.

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: render markdown in non-streaming assistant messages"
```

---

### Task 7: Add missing element CSS to editor

**Files:**
- Modify: `skills/vibes/templates/editor.html:1309-1354` (assistant bubble element CSS)

- [ ] **Step 1: Add CSS for new markdown elements**

The existing `.chat-bubble.assistant` CSS (lines 1310-1354) already covers: `code`, `pre`, `pre code`, `strong`, `em`, `a`, `h1-h3`, `ul/ol`, `li`, `p`. These styles are tuned for the chat bubble context (compact margins, chat-sized typography) and should be kept as-is.

Add CSS for the elements that `marked` produces but the existing rules don't cover. Insert after line 1354 (after `.chat-bubble.assistant p:last-child`):

```css
    .chat-bubble.assistant blockquote {
      border-left: 3px solid var(--vibes-blue);
      padding: 0.2em 0.75em;
      margin: 0.3rem 0;
      color: #555;
    }
    .chat-bubble.assistant table { border-collapse: collapse; width: 100%; margin: 0.3rem 0; font-size: 0.85em; }
    .chat-bubble.assistant th,
    .chat-bubble.assistant td {
      border: 1px solid rgba(0,0,0,0.15);
      padding: 0.3em 0.5em;
      text-align: left;
    }
    .chat-bubble.assistant th { font-weight: 700; background: rgba(0,0,0,0.04); }
    .chat-bubble.assistant hr { border: none; border-top: 1px solid rgba(0,0,0,0.15); margin: 0.5rem 0; }
    .chat-bubble.assistant img { max-width: 100%; border-radius: 4px; margin: 0.3rem 0; }
    .chat-bubble.assistant ul { list-style-type: disc; }
    .chat-bubble.assistant ol { list-style-type: decimal; }
```

Note: the `list-style-type` rules are added because `marked` produces `<ul>` and `<ol>` elements but the browser reset may strip list markers. The existing CSS at lines 1346-1350 handles margin/padding but not `list-style-type`.

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: add CSS for blockquote, table, hr, img in editor chat"
```

---

### Task 8: Update generation rules with markdown rendering guidance

**Files:**
- Modify: `skills/vibes/references/generation-rules.md:204-206` (after section rules, before TinyBase Hook Pattern)

- [ ] **Step 1: Add markdown rendering rule**

In `skills/vibes/references/generation-rules.md`, add a new section between the "Section rules" block (ends line 204) and the "TinyBase Hook Pattern" heading (line 206):

```markdown

**Markdown Content**

The template provides a `<Markdown text={...} />` component that renders markdown as styled HTML (GitHub-Flavored Markdown via `marked`, sanitized with `DOMPurify`). Use it for any text that may contain formatting:

```jsx
// ✅ Content that may contain markdown — use <Markdown>
<Markdown text={useCell('notes', id, 'body')} />
<Markdown text={aiResponse} />

// ✅ Short labels, titles, single-line display text — plain React children
<h1>{useCell('notes', id, 'title')}</h1>
<span>{status}</span>

// ❌ Wrong — content with potential markdown rendered raw
<p>{useCell('notes', id, 'body')}</p>
<div>{aiResponse}</div>
```

**Heuristic:** if the text could be more than one line or comes from AI, use `<Markdown>`. Plain labels, titles, and single-line text stay as direct React children.

```

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/references/generation-rules.md
git commit -m "docs: add markdown rendering guidance to generation rules"
```

---

### Task 9: Update AI integration example

**Files:**
- Modify: `skills/vibes/references/ai-integration.md:82-86` (MessageRow example)

- [ ] **Step 1: Update MessageRow to use Markdown**

In `skills/vibes/references/ai-integration.md`, replace the MessageRow function (lines 82-86):

```jsx
function MessageRow({ id }) {
  const role = useCell('messages', id, 'role');
  const content = useCell('messages', id, 'content');
  return <p><b>{role}:</b> {content}</p>;
}
```

With:

```jsx
function MessageRow({ id }) {
  const role = useCell('messages', id, 'role');
  const content = useCell('messages', id, 'content');
  return (
    <div>
      <b>{role}:</b>
      <Markdown text={content} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/references/ai-integration.md
git commit -m "docs: update AI chat example to use Markdown component"
```

---

### Task 10: Add Markdown to SKILL.md globals reference

**Files:**
- Modify: `skills/vibes/SKILL.md:125` (generation-rules.md reference line)

- [ ] **Step 1: Update the generation rules reference**

In `skills/vibes/SKILL.md`, the line at 125 reads:

```
Read `${CLAUDE_SKILL_DIR}/references/generation-rules.md` for platform constraints, core rules, what generated code must/must not contain, generation process, and assembly workflow.
```

Update it to:

```
Read `${CLAUDE_SKILL_DIR}/references/generation-rules.md` for platform constraints, core rules, what generated code must/must not contain, generation process, assembly workflow, and the `<Markdown>` component for rendering formatted text.
```

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/SKILL.md
git commit -m "docs: mention Markdown component in SKILL.md"
```

---

### Task 11: Rebuild templates and verify

**Files:**
- Regenerated: `skills/*/templates/index.html` (generated by merge-templates.js)

- [ ] **Step 1: Run merge-templates to regenerate final templates**

```bash
cd /Users/marcusestes/Websites/VibesCLI/VibesOS
bun scripts/merge-templates.js --force
```

Expected: The script regenerates `skills/*/templates/index.html` files from the updated base template + each skill's `template.delta.html`. The output should show each template being written.

- [ ] **Step 2: Verify import map in generated templates**

```bash
grep -c '"marked"' skills/vibes/templates/index.html
grep -c '"dompurify"' skills/vibes/templates/index.html
```

Expected: Both return `1` — the import map entries are present.

- [ ] **Step 3: Verify Markdown component in generated templates**

```bash
grep -c 'window.Markdown' skills/vibes/templates/index.html
```

Expected: Returns `1` — the Markdown component is present.

- [ ] **Step 4: Verify .vibes-markdown CSS in generated templates**

```bash
grep -c 'vibes-markdown' skills/vibes/templates/index.html
```

Expected: Returns a number > 1 (multiple CSS rules reference the class).

- [ ] **Step 5: Verify script tags in editor**

```bash
grep -c 'marked@15' skills/vibes/templates/editor.html
grep -c 'dompurify@3' skills/vibes/templates/editor.html
```

Expected: Both return `1`.

- [ ] **Step 6: Verify hand-rolled parser is removed from editor**

```bash
grep -c 'renderInlineMarkdown' skills/vibes/templates/editor.html
grep -c 'inlineFormat' skills/vibes/templates/editor.html
```

Expected: Both return `0` — the old functions are gone.

- [ ] **Step 7: Commit generated templates**

```bash
git add skills/*/templates/index.html
git commit -m "chore: regenerate templates with markdown support"
```

---

### Task 12: Manual smoke test

- [ ] **Step 1: Test editor chat markdown**

Start the editor server:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
bun "$VIBES_ROOT/scripts/server.ts" --mode=editor
```

Open `http://localhost:3333` in a browser. Send a message that will produce markdown in the response (e.g., "make a todo app"). Verify:
- Bold text renders as bold (not `**text**`)
- Code blocks render with background/border styling
- Lists render with proper bullets/numbers
- No raw markdown syntax visible

- [ ] **Step 2: Test generated app Markdown component**

Create a simple test app that uses the Markdown component. In the editor, prompt for an app that displays formatted content (e.g., "build a notes app where notes support markdown formatting"). Verify:
- The agent uses `<Markdown text={...} />` in the generated code
- Rendered output shows styled headings, bold, lists, code blocks
- Theme tokens apply correctly (accent color on links, border color on tables)
