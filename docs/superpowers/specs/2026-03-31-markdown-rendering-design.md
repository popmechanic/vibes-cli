# Markdown Rendering for Generated Apps and Editor Chat

**Issue:** [popmechanic/VibesOS#33](https://github.com/popmechanic/VibesOS/issues/33)
**Date:** 2026-03-31

## Problem

Markdown content is displayed as raw syntax in two places:

1. **Generated apps** — AI responses and user-authored content stored in TinyBase cells render literal `**bold**` asterisks instead of formatted text.
2. **Editor chat** — The VibesOS editor has a hand-rolled ~130-line markdown parser (`renderMarkdown`, `renderInlineMarkdown`, `inlineFormat`, `escapeHtml` in `editor.html`) that covers basic formatting but is missing tables, blockquotes, horizontal rules, images, nested lists, and task lists.

## Solution

Adopt `marked` (GFM parser) + `DOMPurify` (HTML sanitizer) as the single markdown engine across the entire platform:

1. **Generated apps:** Add a global `<Markdown text={...} />` React component to the base template. Update generation rules to guide the agent to use it for content-rich text.
2. **Editor chat:** Replace the hand-rolled parser with `marked` + `DOMPurify`, loaded via `<script>` tags. Shared `.vibes-markdown` CSS ensures consistent styling.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering scope | Opt-in component, not automatic | Not all text is markdown — labels, titles, buttons should stay plain |
| Markdown flavor | Full GitHub-Flavored Markdown | Covers headings, bold, italic, links, code, tables, task lists — 95% of cases |
| Styling approach | Scoped CSS in base template | Avoids extra dependencies, uses existing `--comp-*` design tokens for theme consistency |
| Sanitization | DOMPurify wraps every parse | Non-negotiable for XSS protection when rendering HTML from user/AI content |
| Syntax highlighting | Not included | Keeps bundle small; can be added later if needed |
| Editor chat | Replace hand-rolled parser with `marked` | One engine for the whole platform; gains tables, blockquotes, images, nested lists |
| Editor loading | `<script>` tags (not import map) | Editor is standalone HTML, doesn't use the base template's import map |

## 1. Dependencies & Import Map

Two new entries in `source-templates/base/template.html` import map:

```json
"marked": "https://esm.sh/marked@15?bundle",
"dompurify": "https://esm.sh/dompurify@3?bundle"
```

- Neither depends on React — no `?external=react,react-dom` needed
- `?bundle` flag bundles internal deps to avoid extra network requests
- Combined size: ~10KB gzipped, loaded once and cached

Imported in the base template's `<script type="module">` block:

```js
import { marked } from "marked";
import DOMPurify from "dompurify";
```

## 2. The Markdown Component

Defined in the base template's module script alongside `SyncStatusDot`, `SharingBridge`, etc.

```js
function Markdown({ text }) {
  if (!text) return null;
  const html = React.useMemo(function() {
    return DOMPurify.sanitize(marked.parse(String(text)));
  }, [text]);
  return React.createElement('div', {
    className: 'vibes-markdown',
    dangerouslySetInnerHTML: { __html: html }
  });
}
window.Markdown = Markdown;
```

**API:** `<Markdown text={someString} />`

Key properties:
- `useMemo` — avoids re-parsing on every render, only recomputes when `text` changes
- `DOMPurify.sanitize` wraps every parse — XSS protection is not optional
- `String(text)` — defensive coercion since TinyBase cells can be numbers/booleans
- `className: 'vibes-markdown'` — scoping hook for CSS
- `dangerouslySetInnerHTML` is hidden inside the template — the agent never sees or uses it

## 3. Scoped CSS Styles

Added to the base template's `<style>` block. Scoped to `.vibes-markdown` so it only affects content rendered through the component.

```css
/* Markdown content styling */
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

Theme-aware via `--comp-*` tokens — works with default, archive, industrial, and custom themes. `color-mix` for code backgrounds adapts to both light and dark contexts.

## 4. Generation Rules Updates

### `skills/vibes/references/generation-rules.md`

Add a markdown rendering rule:

> **Markdown content:** When rendering multi-line content, AI responses, descriptions, notes, or any user-authored text that may contain formatting, use the `<Markdown text={content} />` component. Do NOT render content strings directly when they might contain markdown. Plain labels, titles, and single-line display text can remain as direct React children.

With examples:

```jsx
// ✅ Correct — content that may contain markdown
<Markdown text={useCell('notes', id, 'body')} />
<Markdown text={aiResponse} />

// ✅ Correct — short labels stay as plain text
<h1>{useCell('notes', id, 'title')}</h1>
<span>{status}</span>

// ❌ Wrong — content with potential markdown rendered raw
<p>{useCell('notes', id, 'body')}</p>
<div>{aiResponse}</div>
```

**Heuristic for the agent:** "If the text could be more than one line or comes from AI, use `<Markdown>`."

### `skills/vibes/references/ai-integration.md`

Update the message rendering example:

```jsx
function MessageRow({ id }) {
  const role = useCell('messages', id, 'role');
  const content = useCell('messages', id, 'content');
  return <div><b>{role}:</b> <Markdown text={content} /></div>;
}
```

### `skills/vibes/SKILL.md`

Add `Markdown` to the list of template-provided globals/components.

## 5. Editor Chat Integration

The editor (`skills/vibes/templates/editor.html`) is a standalone HTML file — it doesn't use the base template's import map or React globals. It has its own chat UI with vanilla DOM manipulation.

### 5a. Loading Libraries

Add `<script>` tags to `editor.html` `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
```

These expose `marked` and `DOMPurify` as globals, matching how the editor loads Babel and other libraries.

### 5b. Replace Hand-Rolled Parser

Delete the four functions (`renderMarkdown`, `renderInlineMarkdown`, `inlineFormat`, `escapeHtml` — lines ~5317-5452) and replace with a thin wrapper:

```js
function renderMarkdown(text) {
  // Pre-pass: close unclosed code fences for streaming
  const fenceCount = (text.match(/^```/gm) || []).length;
  let processed = text;
  let hasUnclosed = false;
  if (fenceCount % 2 !== 0) {
    processed = text + '\n```';
    hasUnclosed = true;
  }
  let html = DOMPurify.sanitize(marked.parse(processed));
  // Style the last code block as pending if unclosed
  if (hasUnclosed) {
    html = html.replace(/<pre>(?!.*<pre>)/s,
      '<pre style="opacity:0.5;border-style:dashed;">');
  }
  return html;
}
```

This preserves the streaming UX (dimmed/dashed unclosed code blocks) while delegating all parsing to `marked`.

### 5c. Add Shared CSS

Add the `.vibes-markdown` CSS block (same as section 3) to the editor's `<style>` block. Then wrap assistant bubble content with the class:

In `getOrCreateStreamingBubble()` and `addMessage()`, ensure assistant bubbles get `vibes-markdown` added to their class list:

```js
// In streaming bubble creation:
bubble.className = 'chat-bubble assistant vibes-markdown';

// In addMessage() for assistant role:
bubble.className = 'chat-bubble assistant vibes-markdown';
```

The `.vibes-markdown` styles use `--comp-*` CSS variables. The editor defines its own color scheme via `--vibes-*` variables, so the CSS fallback values (e.g., `var(--comp-text, #111)`) ensure it works in both contexts. If needed, the editor can map its variables to `--comp-*` with a few lines of CSS.

### 5d. What Gets Removed

The following hand-rolled functions are deleted entirely (~130 lines):
- `renderMarkdown()` (lines ~5317-5367) — replaced by `marked.parse()` + `DOMPurify.sanitize()`
- `renderInlineMarkdown()` (lines ~5369-5432) — subsumed by `marked`
- `inlineFormat()` (lines ~5434-5448) — subsumed by `marked`
- `escapeHtml()` (lines ~5450-5452) — `DOMPurify` handles sanitization

## 6. Build Pipeline

After editing the base template, run:

```bash
bun scripts/merge-templates.js --force
```

This regenerates `skills/*/templates/index.html` from the updated base + each skill's delta.

**No changes needed to:**
- `scripts/assemble.js` — component is in the template, not generated code
- `scripts/server/post-process.ts` — no new post-processing
- `scripts/deploy-cloudflare.js` — deploys assembled HTML as-is
- `build-components.js` — Markdown is a simple function, not a built component

## Files Changed

| File | Change |
|------|--------|
| `source-templates/base/template.html` | Import map entries, CSS block, Markdown component definition |
| `skills/vibes/templates/editor.html` | Load `marked`/`DOMPurify` via script tags, replace hand-rolled parser (~130 lines removed), add `.vibes-markdown` CSS, apply class to assistant bubbles |
| `skills/vibes/references/generation-rules.md` | Markdown rendering guidance and examples |
| `skills/vibes/references/ai-integration.md` | Update example to use `<Markdown>` |
| `skills/vibes/SKILL.md` | List `Markdown` as available global |
| `skills/*/templates/index.html` | Regenerated by `merge-templates.js` (not edited directly) |
