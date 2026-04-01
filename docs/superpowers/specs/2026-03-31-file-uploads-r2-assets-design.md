# File Uploads & R2 Asset Storage

**Issue:** [popmechanic/VibesOS#30](https://github.com/popmechanic/VibesOS/issues/30)
**Date:** 2026-03-31

## Problem

1. **Limited file uploads** — the editor only accepts `image/*,.html,.htm`. Users want to upload text files (CSV, JSON, markdown, PDFs) as context for app generation. The agent is smart enough to decide whether to treat the content as design reference, seed data, or background context.

2. **Asset size ceiling** — all app assets are base64-encoded into the worker script, which has a 10 MB Cloudflare limit. Large assets (images, audio, PDFs) can't be served by deployed apps.

## Solution

Two coordinated changes:

1. **Widen file uploads** (VibesOS plugin) — accept text, data, and document files with text-specific intents (Seed Data / Content / Context). 50 MB cap. Text files read as plain text instead of DataURL so the AI sees actual content.

2. **R2 asset storage** (vibes-infra) — add a shared R2 bucket for per-app assets. The Deploy API gets an upload endpoint; the dispatch worker serves `/assets/*` from R2. Apps reference assets via `/assets/filename.ext` — same DX as today, no size ceiling.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File size limit | 50 MB | Large enough for book-length PDFs, small enough to prevent abuse |
| Text file reading | `readAsText` (not DataURL) | AI needs to see actual content, not base64 blobs |
| Text intents | Seed Data / Content / Context | Guides the agent on how to use the file without being prescriptive |
| Image intents | Mood / Match Layout (unchanged) | Working well, no reason to change |
| R2 bucket | Shared, per-app key prefix | `apps/{app-name}/assets/...` — simple, no per-app bucket management |
| R2 upload auth | Reuse existing OIDC | Deploy API already validates JWT, add upload endpoint alongside `/deploy` |
| Asset serving | Dispatch worker `/assets/*` | Already routes per-app traffic; add R2 fallback before returning 426 |
| Embedded asset cutoff | Files > 100 KB go to R2 | Small favicons/SVGs stay embedded for zero-latency; large files go to R2 |

---

## Part 1: Widen File Uploads

### 1.1 Expand Accepted File Types

In `editor.html`, update the two file inputs (lines 3265-3266):

```html
<!-- Before -->
<input type="file" accept="image/*,.html,.htm" />

<!-- After -->
<input type="file" accept="image/*,.html,.htm,.txt,.md,.csv,.tsv,.json,.xml,.pdf,.doc,.docx,.rtf" />
```

Also update the reference picker button tooltip from "Add image or HTML reference" to "Add file reference".

### 1.2 Read Text Files as Plain Text

In `editor-reference.js`, the `attachFromFile` function currently reads everything as DataURL (`reader.readAsDataURL`). For text-based files, read as text instead:

```js
function attachFromFile(contextName, file) {
  const isHtml = /\.html?$/i.test(file.name);
  const isText = /\.(txt|md|csv|tsv|json|xml|rtf)$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = () => {
    ctx.file = {
      name: file.name,
      type: file.type,
      dataUrl: isText ? null : reader.result,
      textContent: isText ? reader.result : null,
      intent: 'match'
    };
    if (isHtml) {
      _showBadge(contextName, file.name, ' (HTML Design)');
    } else if (isText) {
      showTextIntentPicker(contextName, file);
    } else if (file.type.startsWith('image/')) {
      showIntentPicker(contextName, file);
    } else {
      // Binary files (PDF, DOCX) — read as DataURL, show text intent picker
      // (server will decode and extract text if possible)
      _showBadge(contextName, file.name, '');
    }
  };
  if (isText) {
    reader.readAsText(file);
  } else {
    reader.readAsDataURL(file);
  }
}
```

PDFs and DOCX are binary — they still use DataURL. The server-side prompt builder can extract text from these formats if needed (or pass them to Claude which can read PDFs natively via the Read tool).

### 1.3 Text Intent Picker

New function `showTextIntentPicker(contextName, file)` renders three intent buttons with tooltips:

| Button | `data-intent` | `data-tooltip` |
|--------|---------------|----------------|
| Seed Data | `seed` | "Parse this file and populate the app's database" |
| Content | `content` | "The app should display or reference this text" |
| Context | `context` | "Background info for the AI — won't be included in the app" |

Implementation reuses the existing `ref-intent-picker` CSS class and `ref-intent-btn` styling. Each button gets a `data-tooltip` attribute using the existing `[data-tooltip]` CSS system (defined at editor.html lines 2772-2797).

The picker also includes a Remove button (matching the fix from issue #31):

```html
<div class="ref-intent-picker">
  <span class="ref-intent-label">{filename}</span>
  <button class="ref-intent-btn" data-intent="seed" data-tooltip="Parse this file and populate the app's database">Seed Data</button>
  <button class="ref-intent-btn" data-intent="content" data-tooltip="The app should display or reference this text">Content</button>
  <button class="ref-intent-btn" data-intent="context" data-tooltip="Background info for the AI — won't be included in the app">Context</button>
  <button class="ref-intent-btn ref-clear-trigger" data-tooltip="Remove file" style="color:var(--vibes-red);border-color:var(--vibes-red);">&times; Remove</button>
</div>
```

Tooltip positioning note: the intent picker is at the bottom of the screen inside the chat composer. The existing tooltip CSS positions `::after` above the element (`bottom: calc(100% + 6px)`), which is correct — tooltips will appear above the buttons.

### 1.4 Size Limit Enforcement

In `attachFromFile`, check file size before reading:

```js
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
if (file.size > MAX_FILE_SIZE) {
  // Show error in badge row
  row.innerHTML = '<span class="ref-badge" style="background:var(--vibes-red);color:white;">File too large (max 50 MB)</span>';
  row.classList.add('visible');
  setTimeout(() => clear(contextName), 3000);
  return;
}
```

### 1.5 WebSocket Payload Update

In `sendMessage()` and `startGenerate()`, the reference payload already sends `{ name, type, dataUrl, intent }`. Add `textContent` for text files:

```js
reference: {
  name: referenceFile.name,
  type: referenceFile.type,
  dataUrl: referenceFile.dataUrl,       // null for text files
  textContent: referenceFile.textContent, // null for binary/image files
  intent: refIntent
}
```

### 1.6 Server-Side Prompt Builder Update

In `scripts/server/prompt-builders.ts`, update `buildReferenceBlock()` to handle text files:

**For text files with `textContent`:**
- Write to `.vibes-tmp/{filename}` as UTF-8
- Inject content inline in the prompt (same pattern as HTML files)
- Vary instructions based on intent:
  - `seed`: "Parse this data and populate TinyBase tables. Design an appropriate schema."
  - `content`: "The app should display this content. Use the `<Markdown>` component for rendering if appropriate."
  - `context`: "Use this as background context to inform your design decisions. Do not include this content directly in the app."

**For binary files without `textContent` (PDF, DOCX):**
- Write to `.vibes-tmp/{filename}` as binary
- Instruct Claude to use the Read tool to access the file (Claude can read PDFs natively)
- Apply same intent-based instructions

### 1.7 Generation Rules Update

In `skills/vibes/references/generation-rules.md`, add guidance:

> **File references:** Users can upload files as context. The `intent` field tells you how to use them:
> - `seed` — Parse the data and populate TinyBase tables with it
> - `content` — The app should display or reference this content (use `<Markdown>` for text)
> - `context` — Background info only; do not include in the app
> - `mood` / `match` — Visual reference (image); extract colors/layout as appropriate

---

## Part 2: R2 Asset Storage

### 2.1 Create R2 Bucket

Create a shared R2 bucket `vibes-assets` in the Cloudflare account. Add binding to both workers:

**deploy-api/wrangler.toml:**
```toml
[[r2_buckets]]
binding = "ASSETS_R2"
bucket_name = "vibes-assets"
```

**dispatch-worker/wrangler.toml:**
```toml
[[r2_buckets]]
binding = "ASSETS_R2"
bucket_name = "vibes-assets"
```

### 2.2 Deploy API: Asset Upload Endpoint

New endpoint `POST /apps/:name/assets` on the Deploy API:

```
POST /apps/:name/assets
Authorization: Bearer {oidc-token}
Content-Type: multipart/form-data

files[]: (binary file data)
```

Flow:
1. Validate JWT, extract userId
2. Verify ownership of app via `REGISTRY_KV` `subdomain:{name}`
3. For each file in the multipart upload:
   - Key: `apps/{name}/assets/{filename}`
   - PUT to R2 with appropriate content-type
4. Return `{ ok: true, urls: ["/assets/filename.ext", ...] }`

Auth reuses the existing OIDC JWT verification middleware already in the Deploy API.

### 2.3 Deploy API: Auto-Upload Large Assets on Deploy

Modify the existing `POST /deploy` handler. Currently, all files in the `files` map are embedded in the worker script. Change:

1. Separate files into **embedded** (< 100 KB) and **external** (>= 100 KB)
2. Upload external files to R2 at `apps/{name}/assets/{path}`
3. Embed only the small files in the worker script
4. The worker script doesn't change — requests for `/assets/*` are intercepted by the dispatch worker before reaching the app worker

### 2.4 Dispatch Worker: Serve Assets from R2

Currently, the dispatch worker only handles WebSocket upgrades and returns 426 for non-WebSocket requests. Add R2 asset serving for non-WebSocket HTTP requests:

```typescript
// In dispatch worker fetch handler:
if (!isWebSocket) {
  // Check for asset request
  const assetPath = url.pathname; // e.g., /assets/logo.png
  if (assetPath.startsWith('/assets/')) {
    const key = `apps/${appName}${assetPath}`;
    const object = await env.ASSETS_R2.get(key);
    if (object) {
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
    return new Response('Not Found', { status: 404 });
  }
  return new Response('Upgrade Required', { status: 426 });
}
```

Assets are served with aggressive caching (`max-age=31536000, immutable`) since they're content-addressed per deploy.

Note: The dispatch worker currently routes traffic based on the `Host` header subdomain. Non-WebSocket requests for deployed apps are handled by the Workers for Platforms dispatch namespace. The `/assets/*` interception needs to happen at the app worker level OR the dispatch worker needs to also handle HTTP routing for deployed apps. The exact integration point depends on how the dispatch namespace routes traffic — this needs verification during implementation.

### 2.5 Deploy Script Update

In `scripts/deploy-cloudflare.js` and `scripts/lib/deploy-files.js`:

1. After building the files map, separate large files
2. Upload large files to R2 via the new `/apps/:name/assets` endpoint
3. Remove large files from the embedded files map
4. Proceed with normal deploy (now with a smaller worker script)

```js
// In deploy-cloudflare.js
const EMBED_THRESHOLD = 100 * 1024; // 100 KB
const largeFiles = {};
const embedFiles = {};

for (const [path, content] of Object.entries(files)) {
  const size = typeof content === 'string' && content.startsWith('base64:')
    ? Buffer.from(content.slice(7), 'base64').length
    : Buffer.byteLength(content);
  if (size >= EMBED_THRESHOLD) {
    largeFiles[path] = content;
  } else {
    embedFiles[path] = content;
  }
}

// Upload large files to R2 via Deploy API
if (Object.keys(largeFiles).length > 0) {
  await uploadAssetsToR2(deployApiUrl, appName, largeFiles, accessToken);
}

// Deploy with only embedded files
await deploy(deployApiUrl, appName, embedFiles, accessToken);
```

### 2.6 Generation Rules: R2 Assets

Add to `skills/vibes/references/generation-rules.md`:

> **Large assets (R2):** When an app needs assets larger than ~100 KB (photos, audio, large SVGs), the deploy system automatically uploads them to cloud storage and serves them at `/assets/filename.ext`. Reference them with absolute paths in JSX: `<img src="/assets/photo.jpg" />`. This works identically in preview and production.

---

## Files Changed

### VibesOS Plugin (Part 1)

| File | Change |
|------|--------|
| `skills/vibes/templates/editor.html` | Expand `accept` filter on file inputs, update tooltip, add text intent picker CSS |
| `skills/vibes/modules/editor-reference.js` | `readAsText` for text files, `showTextIntentPicker()`, size limit, `textContent` field |
| `scripts/server/prompt-builders.ts` | Handle text file intents (seed/content/context) in `buildReferenceBlock()` |
| `skills/vibes/references/generation-rules.md` | File reference intent docs, R2 asset docs |

### vibes-infra (Part 2)

| File | Change |
|------|--------|
| `deploy-api/wrangler.toml` | Add `ASSETS_R2` binding |
| `deploy-api/src/index.ts` | `POST /apps/:name/assets` endpoint, large file separation in `/deploy` |
| `dispatch-worker/wrangler.toml` | Add `ASSETS_R2` binding |
| `dispatch-worker/src/index.ts` | Serve `/assets/*` from R2 for non-WebSocket requests |

### VibesOS Plugin (Part 2 integration)

| File | Change |
|------|--------|
| `scripts/deploy-cloudflare.js` | Separate large files, upload to R2 before deploy |
| `scripts/lib/deploy-files.js` | Export size threshold constant |
