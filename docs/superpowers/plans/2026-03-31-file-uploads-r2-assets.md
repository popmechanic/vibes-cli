# File Uploads & R2 Asset Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the editor's file upload to accept text/data files with intent-based routing, and add R2 asset storage so deployed apps can serve large files without hitting the 10 MB worker script limit.

**Architecture:** Part 1 (Tasks 1-7) expands the plugin's file upload UX and server-side prompt injection — ships independently. Part 2 (Tasks 8-12) adds R2 infrastructure in `vibes-infra` and updates the deploy pipeline. Two repos: `VibesOS` (plugin) and `vibes-infra` (infrastructure).

**Tech Stack:** Editor HTML/JS, Hono (deploy API), Cloudflare Workers, R2, TinyBase, OIDC JWT auth.

**Spec:** `docs/superpowers/specs/2026-03-31-file-uploads-r2-assets-design.md`

---

## Part 1: Widen File Uploads (VibesOS plugin)

---

### Task 1: Expand accepted file types in editor HTML

**Files:**
- Modify: `skills/vibes/templates/editor.html:3265-3266` (file inputs)
- Modify: `skills/vibes/templates/editor.html:3208` (reference button tooltip)
- Modify: `skills/vibes/templates/editor.html:2967` (generate phase button tooltip)

- [ ] **Step 1: Update file input accept attributes**

In `skills/vibes/templates/editor.html`, find the two file inputs (lines 3265-3266):

```html
<input type="file" id="refFileInput" accept="image/*,.html,.htm" style="display:none" onchange="EditorReference.handleFile('edit', event)" />
<input type="file" id="genRefFileInput" accept="image/*,.html,.htm" style="display:none" onchange="EditorReference.handleFile('generate', event)" />
```

Replace both `accept` attributes with:

```
accept="image/*,.html,.htm,.txt,.md,.csv,.tsv,.json,.xml,.pdf,.doc,.docx,.rtf"
```

- [ ] **Step 2: Update tooltip on edit phase reference button**

Find the edit phase reference button (line 3208):

```html
<button class="composer-btn" id="refBtn" onclick="EditorReference.pick('edit')" data-tooltip="Add image or HTML reference">
```

Change `data-tooltip` to `"Add file reference"`.

- [ ] **Step 3: Update tooltip on generate phase reference button**

Find the generate phase reference button (line 2967):

```html
<button class="gen-toolbar-btn" onclick="EditorReference.pick('generate')" data-tooltip="Add image reference">
```

Change `data-tooltip` to `"Add file reference"`.

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: expand file upload to accept text, data, and document types"
```

---

### Task 2: Add text intent picker and size limit to editor-reference.js

**Files:**
- Modify: `skills/vibes/modules/editor-reference.js`

- [ ] **Step 1: Add size limit constant and text file detection**

At the top of the IIFE (after line 13 `let escapeHtml = ...;`), add:

```js
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  const TEXT_EXTS = /\.(txt|md|csv|tsv|json|xml|rtf)$/i;
```

- [ ] **Step 2: Rewrite attachFromFile to handle text files and size limit**

Replace the entire `attachFromFile` function (lines 67-88) with:

```js
  /** Read a File and show intent picker or badge. */
  function attachFromFile(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;

    // Size limit
    if (file.size > MAX_FILE_SIZE) {
      const row = ctx.elements.refBadgeRow;
      if (row) {
        row.innerHTML = '<span class="ref-badge" style="background:var(--vibes-red);color:white;">File too large (max 50 MB)</span>';
        row.classList.add('visible');
        setTimeout(() => clear(contextName), 3000);
      }
      return;
    }

    const isHtml = /\.html?$/i.test(file.name);
    const isText = TEXT_EXTS.test(file.name);
    const reader = new FileReader();

    reader.onload = () => {
      if (isText) {
        ctx.file = { name: file.name, type: file.type, dataUrl: null, textContent: reader.result, intent: 'content' };
        showTextIntentPicker(contextName, file);
      } else {
        ctx.file = { name: file.name, type: file.type, dataUrl: reader.result, textContent: null, intent: 'match' };
        if (isHtml) {
          _showBadge(contextName, file.name, ' (HTML Design)');
          if (ctx.callbacks.onRefAttached) {
            ctx.callbacks.onRefAttached(reader.result);
          }
        } else if (file.type.startsWith('image/')) {
          showIntentPicker(contextName, file);
        } else {
          // Binary files (PDF, DOCX, etc.) — show badge directly
          _showBadge(contextName, file.name, '');
        }
      }
    };

    if (isText) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  }
```

- [ ] **Step 3: Add showTextIntentPicker function**

After the `showIntentPicker` function (after line 127), add:

```js
  /** Show intent picker for a text/data file. */
  function showTextIntentPicker(contextName, file) {
    const ctx = contexts[contextName];
    if (!ctx) return;
    const display = file.name.length > 20
      ? file.name.slice(0, 8) + '...' + file.name.slice(-8)
      : file.name;
    const row = ctx.elements.refBadgeRow;
    if (!row) return;

    row.innerHTML = `<div class="ref-intent-picker">
      <span class="ref-intent-label">${escapeHtml(display)}</span>
      <button class="ref-intent-btn" data-intent="seed" data-tooltip="Parse this file and populate the app's database">Seed Data</button>
      <button class="ref-intent-btn" data-intent="content" data-tooltip="The app should display or reference this text">Content</button>
      <button class="ref-intent-btn" data-intent="context" data-tooltip="Background info for the AI — won't be included in the app">Context</button>
      <button class="ref-intent-btn ref-clear-trigger" data-tooltip="Remove file" style="color:var(--vibes-red);border-color:var(--vibes-red);">&times; Remove</button>
    </div>`;
    row.classList.add('visible');

    if (ctx.elements.refBtn) {
      ctx.elements.refBtn.classList.add('active');
    }

    if (intentAbortControllers[contextName]) intentAbortControllers[contextName].abort();
    intentAbortControllers[contextName] = new AbortController();
    row.addEventListener('click', _intentPickerClickHandler.bind(null, contextName),
      { signal: intentAbortControllers[contextName].signal });
  }
```

- [ ] **Step 4: Update _pickIntent to handle text intents**

In the `_pickIntent` function (line 146-159), update the `intentLabels` map (line 150):

```js
    const intentLabels = { none: '', mood: ' (Mood)', match: ' (Match)', seed: ' (Seed Data)', content: ' (Content)', context: ' (Context)' };
```

- [ ] **Step 5: Update onRefAttached callback for text files**

In `_pickIntent`, the `onRefAttached` callback sends `ctx.file.dataUrl` (line 154). For text files, `dataUrl` is null. Update line 153-155:

```js
    if (ctx.callbacks.onRefAttached) {
      ctx.callbacks.onRefAttached(ctx.file.dataUrl || ctx.file.textContent);
    }
```

- [ ] **Step 6: Expand drag-and-drop to accept all supported file types**

In the `initDragDrop` function (line 234-241), the drop handler currently only accepts images and HTML. Update the condition (line 238):

```js
      if (file) {
        attachFromFile(contextName, file);
      }
```

Remove the `file.type.startsWith('image/') || /\.html?$/i.test(file.name)` guard entirely — `attachFromFile` already handles type detection and unsupported files fall through to the badge.

- [ ] **Step 7: Export showTextIntentPicker**

Update the `window.EditorReference` export (line 244-256) to include:

```js
  window.EditorReference = {
    init,
    setEscapeHtml,
    pick,
    handleFile,
    attachFromFile,
    clear,
    showIntentPicker,
    showTextIntentPicker,
    getFile,
    setFile,
    initPasteHandler,
    initDragDrop
  };
```

- [ ] **Step 8: Commit**

```bash
git add skills/vibes/modules/editor-reference.js
git commit -m "feat: add text file support with intent picker and 50MB size limit"
```

---

### Task 3: Update WebSocket payload for text files

**Files:**
- Modify: `skills/vibes/templates/editor.html:5238-5244` (sendMessage reference payload)
- Modify: `skills/vibes/templates/editor.html:4774-4780` (startGenerate reference payload)

- [ ] **Step 1: Update sendMessage payload**

In `sendMessage()` (line 5238-5244), the reference payload currently sends `{ name, type, dataUrl, intent }`. Update to include `textContent`:

Find:
```js
    if (referenceFile) {
      payload.reference = {
        name: referenceFile.name,
        type: referenceFile.type,
        dataUrl: referenceFile.dataUrl,
        intent: refIntent
      };
    }
```

Replace with:
```js
    if (referenceFile) {
      payload.reference = {
        name: referenceFile.name,
        type: referenceFile.type,
        dataUrl: referenceFile.dataUrl,
        textContent: referenceFile.textContent,
        intent: refIntent
      };
    }
```

- [ ] **Step 2: Update startGenerate payload**

In `startGenerate()` (line 4774-4780), apply the same change:

Find:
```js
      payload.reference = {
        name: genRefFile.name,
        type: genRefFile.type,
        dataUrl: genRefFile.dataUrl,
        intent: genRefFile.intent || 'match'
      };
```

Replace with:
```js
      payload.reference = {
        name: genRefFile.name,
        type: genRefFile.type,
        dataUrl: genRefFile.dataUrl,
        textContent: genRefFile.textContent,
        intent: genRefFile.intent || 'content'
      };
```

Note: default intent changes from `'match'` to `'content'` for generate phase since text files are more likely content than visual match.

- [ ] **Step 3: Update intent display labels**

In `sendMessage()` (line 5226), the `intentLabels` map only has image intents. Update:

Find:
```js
    const intentLabels = { none: '', mood: ' (Mood)', match: ' (Match)' };
```

Replace with:
```js
    const intentLabels = { none: '', mood: ' (Mood)', match: ' (Match)', seed: ' (Seed Data)', content: ' (Content)', context: ' (Context)' };
```

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: include textContent in reference payload for text files"
```

---

### Task 4: Handle text files in server-side prompt builder

**Files:**
- Modify: `scripts/server/prompt-builders.ts:682-786` (buildReferenceBlock function)

- [ ] **Step 1: Add text file handling to buildReferenceBlock**

In `scripts/server/prompt-builders.ts`, the `buildReferenceBlock` function (line 682) currently handles HTML and images. Add text file handling after the HTML block (line 708) and before the image block (line 711).

After the closing `}` of the HTML branch (line 708), insert:

```typescript
  // Text files — sent as plain text, not base64
  if (reference.textContent) {
    const textContent = reference.textContent;
    writeFileSync(refPath, textContent, 'utf-8');

    if (intent === 'seed') {
      return `FILE REFERENCE: "${reference.name}" (intent: Seed Data)

The user uploaded this file to populate the app's database. Parse the data and design an appropriate TinyBase table schema. Use useAddRowCallback or store.setRow to seed rows on first load (guard with a check so data isn't duplicated on reload).

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
    }

    if (intent === 'content') {
      return `FILE REFERENCE: "${reference.name}" (intent: Content)

The user uploaded this file as content the app should display or reference. Use the <Markdown> component if the content is text/markdown. For structured data (JSON, CSV), design an appropriate UI to present it.

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
    }

    // intent === 'context' (default for text files)
    return `FILE REFERENCE: "${reference.name}" (intent: Context)

The user uploaded this file as background context. Use it to inform your design decisions, but do NOT include this content directly in the app.

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
  }
```

The 50,000 character truncation prevents the prompt from becoming too large while noting the full file is on disk for the AI to Read if needed.

- [ ] **Step 2: Update dataUrl guard**

The existing code at line 685 does `const base64 = reference.dataUrl.split(',')[1]`. This will crash if `dataUrl` is null (text files). Add a guard. Find (line 685):

```typescript
  const base64 = reference.dataUrl.split(',')[1];
```

Replace with:

```typescript
  const base64 = reference.dataUrl ? reference.dataUrl.split(',')[1] : null;
```

Then update the image write at line 712 to guard on base64:

Find:
```typescript
  // Save image to disk so Claude can read it visually
  writeFileSync(refPath, Buffer.from(base64, 'base64'));
```

Replace with:
```typescript
  // Save image/binary to disk so Claude can read it visually
  if (!base64) {
    return `The user attached a file: ${reference.name}. No content was provided.\n\n`;
  }
  writeFileSync(refPath, Buffer.from(base64, 'base64'));
```

- [ ] **Step 3: Commit**

```bash
git add scripts/server/prompt-builders.ts
git commit -m "feat: handle text file intents (seed/content/context) in prompt builder"
```

---

### Task 5: Update generation rules with file reference guidance

**Files:**
- Modify: `skills/vibes/references/generation-rules.md:224-225` (after Markdown Content section)

- [ ] **Step 1: Add file reference guidance**

In `skills/vibes/references/generation-rules.md`, after the Markdown Content heuristic line (line 224) and before the `**TinyBase Hook Pattern**` heading (line 226), insert:

```markdown

**File References**

Users can upload files as context. The `intent` field tells you how to use them:

| Intent | Meaning | What to do |
|--------|---------|------------|
| `seed` | Populate the database | Parse the data, design a TinyBase table schema, seed rows on first load |
| `content` | Display in the app | Use `<Markdown>` for text, design appropriate UI for structured data |
| `context` | Background info only | Inform design decisions, do NOT include content in the app |
| `mood` | Visual mood (image) | Extract colors/typography/surfaces, preserve layout |
| `match` | Match layout (image) | Extract complete visual theme + layout structure |

For `seed` intent, guard seeding with a check (e.g., `if (useRowIds('tableName').length === 0)`) so data isn't duplicated on reload.

```

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/references/generation-rules.md
git commit -m "docs: add file reference intent guidance to generation rules"
```

---

### Task 6: Add tooltip positioning fix for intent picker buttons

**Files:**
- Modify: `skills/vibes/templates/editor.html:1579-1587` (intent picker CSS)

- [ ] **Step 1: Add position:relative to intent buttons for tooltip positioning**

The existing `[data-tooltip]` CSS (line 2773) sets `position: relative`. However, the `.ref-intent-btn` buttons are inside a flex container and may need explicit positioning. The `[data-tooltip]` selector already handles this generically, so tooltip support is automatic for any element with `data-tooltip`.

Verify: the intent picker buttons from Task 2 already have `data-tooltip` attributes. The `[data-tooltip]::after` rule (line 2776) positions tooltips above with `bottom: calc(100% + 6px)`. Since the picker is at the bottom of the viewport, tooltips will appear above the buttons — correct.

No CSS changes needed. The existing tooltip system handles this automatically.

- [ ] **Step 2: Mark complete (no changes needed)**

This task is a verification — no code changes required. The tooltip system already works for any element with `data-tooltip`.

---

### Task 7: Test Part 1 end-to-end

- [ ] **Step 1: Restart editor server**

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
bun "$VIBES_ROOT/scripts/server.ts" --mode=editor
```

- [ ] **Step 2: Test text file upload**

Open `http://localhost:3333`. Click the reference button (+ icon) in the chat input. Verify:
- File picker shows text file types (.txt, .md, .csv, .json, etc.)
- Selecting a .csv file shows the text intent picker: **Seed Data | Content | Context | × Remove**
- Each button has a tooltip on hover explaining what it does
- Selecting "Seed Data" shows a badge with "(Seed Data)" label
- Clicking × Remove clears the reference

- [ ] **Step 3: Test size limit**

Try uploading a file > 50 MB. Verify:
- Red badge appears: "File too large (max 50 MB)"
- Badge auto-clears after 3 seconds

- [ ] **Step 4: Test text file in chat**

Upload a small .csv file, select "Seed Data", type "build an app for this data", and send. Verify:
- The payload includes `textContent` (check console log for payload size)
- The AI receives the file content and attempts to seed TinyBase tables

---

## Part 2: R2 Asset Storage (vibes-infra + plugin)

All Part 2 tasks work in the `vibes-infra` repo unless otherwise noted.

---

### Task 8: Create R2 bucket and add wrangler bindings

**Files:**
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/deploy-api/wrangler.toml`
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/dispatch-worker/wrangler.toml`

- [ ] **Step 1: Create R2 bucket**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
npx wrangler r2 bucket create vibes-assets
```

Expected: Bucket created, output shows bucket name.

- [ ] **Step 2: Add R2 binding to deploy-api wrangler.toml**

In `deploy-api/wrangler.toml`, after the `[[kv_namespaces]]` block (line 22), add:

```toml

[[r2_buckets]]
binding = "ASSETS_R2"
bucket_name = "vibes-assets"
```

- [ ] **Step 3: Add R2 binding to dispatch-worker wrangler.toml**

In `dispatch-worker/wrangler.toml`, after the `[[dispatch_namespaces]]` block (line 25), add:

```toml

[[r2_buckets]]
binding = "ASSETS_R2"
bucket_name = "vibes-assets"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git add deploy-api/wrangler.toml dispatch-worker/wrangler.toml
git commit -m "feat: add R2 vibes-assets bucket bindings to deploy API and dispatch worker"
```

---

### Task 9: Add asset upload endpoint to Deploy API

**Files:**
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/deploy-api/src/index.ts`

- [ ] **Step 1: Add ASSETS_R2 to Env type**

In the Deploy API `index.ts`, find the `Env` type (or `Bindings` type used by Hono). Add `ASSETS_R2`:

```typescript
ASSETS_R2: R2Bucket;
```

- [ ] **Step 2: Add POST /apps/:name/assets endpoint**

Add a new route after the existing `/deploy` route. This endpoint accepts a JSON body with a `files` map (same format as deploy: path → content, with `base64:` prefix for binary):

```typescript
app.post('/apps/:name/assets', verifyAuth, async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  // Verify ownership
  const existing = await getSubdomain(c.env.REGISTRY_KV, name);
  if (!existing || existing.owner !== userId) {
    return c.json({ ok: false, error: 'Not authorized' }, 403);
  }

  const body = await c.req.json<{ files: Record<string, string> }>();
  if (!body.files || typeof body.files !== 'object') {
    return c.json({ ok: false, error: "Missing 'files' field" }, 400);
  }

  const urls: string[] = [];
  for (const [path, content] of Object.entries(body.files)) {
    const key = `apps/${name}/${path}`;
    let data: ArrayBuffer | string;
    let contentType = 'application/octet-stream';

    if (typeof content === 'string' && content.startsWith('base64:')) {
      const b64 = content.slice(7);
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      data = buf.buffer;
      // Guess content type from extension
      const ext = path.substring(path.lastIndexOf('.'));
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
        '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4',
        '.avif': 'image/avif',
      };
      contentType = mimeMap[ext] || 'application/octet-stream';
    } else {
      data = content;
      const ext = path.substring(path.lastIndexOf('.'));
      const textMimeMap: Record<string, string> = {
        '.html': 'text/html', '.js': 'application/javascript',
        '.css': 'text/css', '.json': 'application/json',
        '.svg': 'image/svg+xml', '.xml': 'application/xml',
        '.txt': 'text/plain', '.md': 'text/markdown',
        '.webmanifest': 'application/manifest+json',
      };
      contentType = textMimeMap[ext] || 'text/plain';
    }

    await c.env.ASSETS_R2.put(key, data, {
      httpMetadata: { contentType },
    });
    urls.push(`/${path}`);
  }

  return c.json({ ok: true, urls });
});
```

- [ ] **Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git add deploy-api/src/index.ts
git commit -m "feat: add POST /apps/:name/assets endpoint for R2 uploads"
```

---

### Task 10: Serve assets from R2 in dispatch worker

**Files:**
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/dispatch-worker/src/index.ts:106-138`

- [ ] **Step 1: Add ASSETS_R2 to Env interface**

In `dispatch-worker/src/index.ts`, update the `Env` interface (line 4-11) to add:

```typescript
ASSETS_R2: R2Bucket;
```

The full interface becomes:

```typescript
interface Env {
  APP_SYNC: DurableObjectNamespace;
  APP_META: KVNamespace;
  DISPATCH: { get(name: string): { fetch(request: Request): Promise<Response> } };
  OIDC_JWKS_URL: string;
  OIDC_ISSUER: string;
  ASSETS_R2: R2Bucket;
}
```

- [ ] **Step 2: Add R2 asset serving for non-WebSocket requests**

Replace the non-WebSocket response block (lines 131-136):

```typescript
    // This worker only handles WebSocket upgrades for TinyBase sync.
    // Non-WebSocket requests (health checks, crawlers, etc.) get a simple response.
    return new Response('TinyBase sync endpoint. WebSocket connections only.', {
      status: 426,
      headers: { 'Upgrade': 'websocket' },
    });
```

With:

```typescript
    // Serve assets from R2 for non-WebSocket requests
    const hostname = url.hostname;
    const appName = getSubdomain(hostname);

    if (appName && url.pathname.startsWith('/assets/')) {
      const key = `apps/${appName}${url.pathname}`;
      const object = await env.ASSETS_R2.get(key);
      if (object) {
        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      return new Response('Not Found', { status: 404 });
    }

    // Non-asset, non-WebSocket requests
    return new Response('TinyBase sync endpoint. WebSocket connections only.', {
      status: 426,
      headers: { 'Upgrade': 'websocket' },
    });
```

Note: The dispatch worker runs on `sync.vibesos.com`, not on app subdomains. The app subdomains (`{name}.vibesos.com`) route to the Workers for Platforms dispatch namespace, which serves the embedded worker script. For R2 assets to work on app subdomains, the app worker script needs to proxy `/assets/*` requests OR the dispatch namespace routing needs updating.

**Alternative approach if dispatch worker can't serve app-subdomain assets:** Modify the worker script template in the Deploy API to proxy `/assets/*` to R2 via a fetch to `sync.vibesos.com/assets/{path}` or directly to the R2 public URL. The simplest path is to add R2 fallback to the app worker template itself — see Task 11.

- [ ] **Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git add dispatch-worker/src/index.ts
git commit -m "feat: serve R2 assets for non-WebSocket requests in dispatch worker"
```

---

### Task 11: Update app worker template to fetch R2 assets

**Files:**
- Modify: `/Users/marcusestes/Websites/VibesCLI/vibes-infra/deploy-api/src/index.ts:276-305` (worker script template)

- [ ] **Step 1: Add R2 asset fallback to worker script template**

The worker script template (in the `deployCFWorker` function, lines 249-306) serves files from the embedded `FILES` map. Add a fallback that fetches from R2 when a file isn't in the embedded map.

In the worker script template, after the SPA fallback block (line 297-303) and before the final `return new Response('Not Found', { status: 404 });` (line 303), add an R2 fallback:

Replace lines 296-303:

```javascript
    // SPA fallback
    if ('index.html' in FILES) {
      return new Response(FILES['index.html'], {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not Found', { status: 404 });
```

With:

```javascript
    // R2 asset fallback for large files not embedded in worker
    if (key.startsWith('assets/')) {
      const r2Url = 'https://sync.vibesos.com/assets/' + key.slice(7);
      try {
        const r2Resp = await fetch(r2Url);
        if (r2Resp.ok) return r2Resp;
      } catch (e) {}
    }
    // SPA fallback
    if ('index.html' in FILES) {
      return new Response(FILES['index.html'], {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('Not Found', { status: 404 });
```

This approach proxies `/assets/*` requests to the dispatch worker (which serves from R2 per Task 10). The app-subdomain dispatch namespace handles the proxy transparently.

Note: This means the dispatch worker's R2 serving (Task 10) needs the app name from the request path, not the hostname. Update the dispatch worker's asset serving to accept a path-based app name format: `GET /assets/{appName}/{path}`. The dispatch worker runs on `sync.vibesos.com` so the app worker would fetch `https://sync.vibesos.com/assets/{appName}/{path}`.

Alternatively, inject the app name into the worker template so it can construct the correct URL:

```javascript
    if (key.startsWith('assets/')) {
      const r2Url = 'https://sync.vibesos.com/r2/${appName}/' + key;
      try {
        const r2Resp = await fetch(r2Url);
        if (r2Resp.ok) return r2Resp;
      } catch (e) {}
    }
```

The exact URL pattern depends on how the dispatch worker's R2 route is structured. The implementer should coordinate Task 10 and Task 11 to agree on the URL format.

- [ ] **Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra
git add deploy-api/src/index.ts
git commit -m "feat: add R2 asset fallback to app worker template"
```

---

### Task 12: Update deploy script to upload large assets to R2

**Files (VibesOS repo):**
- Modify: `/Users/marcusestes/Websites/VibesCLI/VibesOS/scripts/lib/deploy-files.js`
- Modify: `/Users/marcusestes/Websites/VibesCLI/VibesOS/scripts/deploy-cloudflare.js`

- [ ] **Step 1: Add size threshold constant to deploy-files.js**

In `scripts/lib/deploy-files.js`, after the `BINARY_EXTS` constant (line 12), add:

```js
export const R2_THRESHOLD = 100 * 1024; // 100 KB — files larger than this go to R2
```

- [ ] **Step 2: Add separateBySize helper to deploy-files.js**

After the `addAppAssets` function (line 89), add:

```js
/**
 * Separate files into embedded (small) and R2 (large) based on size threshold.
 * @param {Record<string, string>} files - Files map
 * @param {number} threshold - Size threshold in bytes
 * @returns {{ embed: Record<string, string>, r2: Record<string, string> }}
 */
export function separateBySize(files, threshold = R2_THRESHOLD) {
  const embed = {};
  const r2 = {};
  for (const [path, content] of Object.entries(files)) {
    // index.html is always embedded
    if (path === 'index.html') {
      embed[path] = content;
      continue;
    }
    const size = typeof content === 'string' && content.startsWith('base64:')
      ? Buffer.from(content.slice(7), 'base64').length
      : Buffer.byteLength(content, 'utf8');
    if (size >= threshold) {
      r2[path] = content;
    } else {
      embed[path] = content;
    }
  }
  return { embed, r2 };
}
```

- [ ] **Step 3: Update deploy-cloudflare.js to upload large files to R2**

In `scripts/deploy-cloudflare.js`, after the files map is built but before the deploy API call, add R2 upload logic.

Find the section where files are sent to the deploy API. Before that call, add:

```js
import { separateBySize } from './lib/deploy-files.js';

// Separate large files for R2 upload
const { embed, r2: r2Files } = separateBySize(files);

if (Object.keys(r2Files).length > 0) {
  console.log(`Uploading ${Object.keys(r2Files).length} large asset(s) to R2...`);
  const r2Resp = await fetch(`${DEPLOY_API_URL}/apps/${appName}/assets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files: r2Files }),
  });
  if (!r2Resp.ok) {
    const errText = await r2Resp.text();
    console.warn(`R2 upload warning: ${errText}`);
  } else {
    console.log('R2 assets uploaded successfully');
  }
}

// Deploy with only embedded files
files = embed;
```

The implementer should find the exact line where the deploy API is called and insert this block before it. The `files` variable is then reassigned to only contain small files for embedding.

- [ ] **Step 4: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/VibesOS
git add scripts/lib/deploy-files.js scripts/deploy-cloudflare.js
git commit -m "feat: upload large assets to R2, embed only small files in worker"
```

---

### Task 13: Add R2 asset guidance to generation rules

**Files:**
- Modify: `skills/vibes/references/generation-rules.md` (after the file reference table from Task 5)

- [ ] **Step 1: Add R2 asset guidance**

In `skills/vibes/references/generation-rules.md`, after the file reference guidance added in Task 5, append:

```markdown

**Large assets (R2):** When an app needs assets larger than ~100 KB (photos, audio, large SVGs), the deploy system automatically uploads them to cloud storage and serves them at `/assets/filename.ext`. Reference them with absolute paths in JSX: `<img src="/assets/photo.jpg" />`. This works identically in preview and production.
```

- [ ] **Step 2: Commit**

```bash
git add skills/vibes/references/generation-rules.md
git commit -m "docs: add R2 asset guidance to generation rules"
```

---

### Task 14: Deploy infrastructure changes

- [ ] **Step 1: Deploy dispatch worker**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra/dispatch-worker
npx wrangler deploy
```

Expected: Worker deployed successfully with R2 binding.

- [ ] **Step 2: Deploy deploy API**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-infra/deploy-api
npx wrangler deploy
```

Expected: Worker deployed successfully with R2 binding.

- [ ] **Step 3: Test asset upload**

Deploy a test app with a large asset and verify `/assets/*` serves from R2:

```bash
curl -s https://sync.vibesos.com/r2/test-app/assets/test.txt
```

Expected: Returns the uploaded content with correct content-type.
