# Editor App Gallery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the editor landing page to show a two-panel layout with screenshot thumbnails for saved apps.

**Architecture:** The generate phase splits into left panel (prompt) and right panel (app gallery). Screenshots are captured from the preview iframe after deploy using html2canvas and stored as PNGs alongside each app's app.jsx. The server gains two new endpoints for serving and saving screenshots.

**Tech Stack:** html2canvas (CDN), preview-server.js (Node), editor.html (vanilla JS/CSS)

---

### Task 1: Server — Screenshot Endpoints

**Files:**
- Modify: `scripts/preview-server.js:460-514` (between existing app endpoints)

**Step 1: Add GET screenshot endpoint**

Add after the `POST /editor/apps/save` handler (line 514) in `preview-server.js`:

```javascript
  // GET /editor/apps/screenshot?name=foo → serve screenshot.png
  if (pathname === '/editor/apps/screenshot' && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const name = params.get('name');
    if (!name) { res.writeHead(400); return res.end('Missing name'); }
    const imgPath = join(APPS_DIR, name, 'screenshot.png');
    if (!existsSync(imgPath)) { res.writeHead(404); return res.end('No screenshot'); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    return res.end(readFileSync(imgPath));
  }
```

**Step 2: Add POST screenshot endpoint**

Add immediately after the GET handler:

```javascript
  // POST /editor/apps/screenshot?name=foo → save screenshot PNG (raw body)
  if (pathname === '/editor/apps/screenshot' && req.method === 'POST') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const name = params.get('name');
    if (!name) { res.writeHead(400); return res.end('Missing name'); }
    const dest = join(APPS_DIR, name);
    if (!existsSync(dest)) { mkdirSync(dest, { recursive: true }); }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      writeFileSync(join(dest, 'screenshot.png'), Buffer.concat(chunks));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
```

**Step 3: Add hasScreenshot to GET /editor/apps response**

In the existing `GET /editor/apps` handler (~line 472), add `hasScreenshot` to the pushed object:

```javascript
        apps.push({
          name,
          modified: st.mtime.toISOString(),
          themeId: themeMatch ? themeMatch[1] : null,
          themeName: themeMatch ? themeMatch[2] : null,
          size: st.size,
          hasScreenshot: existsSync(join(dir, 'screenshot.png')),
        });
```

**Step 4: Test manually**

Run the preview server and verify:
- `curl http://localhost:3000/editor/apps` returns apps with `hasScreenshot` field
- `curl http://localhost:3000/editor/apps/screenshot?name=nonexistent` returns 404

**Step 5: Commit**

```bash
git add scripts/preview-server.js
git commit -m "Add screenshot serve/save endpoints to preview server"
```

---

### Task 2: CSS — Two-Panel Generate Layout

**Files:**
- Modify: `skills/vibes/templates/editor.html` (CSS section, lines ~239-368)

**Step 1: Add two-panel layout CSS**

Replace the `.generate-phase` rule (line 240-248) with:

```css
    .generate-phase {
      display: flex;
      flex-direction: row;
      background: var(--vibes-menu-bg);
      background-image:
        linear-gradient(var(--grid-color) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
      background-size: var(--grid-size) var(--grid-size);
    }
    .generate-phase.single-panel {
      align-items: center;
      justify-content: center;
    }
    .generate-left {
      flex: 0 0 40%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .generate-phase.single-panel .generate-left {
      flex: none;
    }
    .generate-right {
      flex: 1;
      overflow-y: auto;
      padding: 2rem;
      border-left: 2px solid var(--vibes-near-black);
    }
    .gallery-title {
      font-size: 1rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
```

**Step 2: Add app card grid CSS**

Add after the gallery-title rule:

```css
    .app-gallery-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .app-card {
      background: white;
      border: 2px solid var(--vibes-near-black);
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      transition: box-shadow 0.15s, transform 0.15s;
    }
    .app-card:hover {
      box-shadow: 4px 4px 0 0 var(--vibes-near-black);
      transform: translate(-2px, -2px);
    }
    .app-card-thumb {
      width: 100%;
      aspect-ratio: 16 / 10;
      background: var(--vibes-menu-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-bottom: 2px solid var(--vibes-near-black);
    }
    .app-card-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .app-card-placeholder {
      font-size: 2rem;
      opacity: 0.3;
    }
    .app-card-info {
      padding: 0.5rem 0.75rem;
    }
    .app-card-name {
      font-weight: 700;
      font-size: 0.8125rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .app-card-meta {
      font-size: 0.6875rem;
      color: #888;
    }
    .gallery-divider {
      border: none;
      border-top: 1px dashed #bbb;
      margin: 0.5rem 0 1rem;
    }
    @media (max-width: 768px) {
      .generate-phase { flex-direction: column; }
      .generate-left { flex: none; width: 100%; }
      .generate-right { border-left: none; border-top: 2px solid var(--vibes-near-black); }
    }
```

**Step 3: Remove old `.generate-existing` and `.generate-or` styles (lines 319-330)**

These are no longer needed since the "-- OR --" separator and inline app list move to the right panel.

Actually — keep them as-is for now, they just won't be rendered. We can clean up later.

**Step 4: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "Add two-panel CSS layout for generate phase"
```

---

### Task 3: HTML — Restructure Generate Phase Markup

**Files:**
- Modify: `skills/vibes/templates/editor.html:890-930` (Phase 2 HTML)

**Step 1: Wrap generate-card in left panel, add right panel**

Replace lines 890-930 with:

```html
  <!-- Phase 2: Generate -->
  <div class="phase generate-phase single-panel" id="phaseGenerate">
    <div class="generate-left">
      <div class="generate-card">
        <div class="generate-title">What do you want to build?</div>
        <div class="generate-subtitle">Describe your app idea. Be as specific or vague as you like.</div>
        <textarea class="generate-textarea" id="generatePrompt" placeholder="A task manager with categories and drag-to-reorder..."
          onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();startGenerate();}"></textarea>
        <div class="theme-select-row">
          <span class="theme-select-label">Theme:</span>
          <select class="theme-select" id="themeSelect">
            <option value="">Auto (let AI choose)</option>
          </select>
        </div>
        <div class="generate-actions" id="generateActions">
          <button class="btn btn-primary" id="generateBtn" onclick="startGenerate()">Generate</button>
        </div>
        <div class="generate-progress" id="generateProgress">
          <div class="thinking-header">
            <div class="thinking-dots">
              <div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>
            </div>
            <span class="thinking-stage" id="genStage">Starting...</span>
          </div>
          <div class="thinking-progress-bar">
            <div class="thinking-progress-fill" id="genProgressFill" style="width: 0%"></div>
          </div>
          <div class="thinking-footer">
            <span class="thinking-pct" id="genPct">0%</span>
            <span class="thinking-timer" id="genTimer">0s</span>
            <button class="thinking-cancel" onclick="cancelRequest()">Cancel</button>
          </div>
        </div>
        <div class="generate-error" id="generateError" style="display:none;background:var(--vibes-red);color:white;padding:0.75rem 1rem;border-radius:8px;font-size:0.85rem;margin-top:0.75rem;word-break:break-word;"></div>
      </div>
    </div>
    <div class="generate-right" id="generateRight" style="display:none;">
      <div class="gallery-title">Your Apps</div>
      <div class="app-gallery-grid" id="appGalleryGrid"></div>
      <hr class="gallery-divider" id="galleryDivider" style="display:none;">
      <div class="app-list" id="appListOlder"></div>
    </div>
  </div>
```

Note: the `existingAppSection` div is removed — the right panel replaces it entirely.

**Step 2: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "Restructure generate phase into two-panel layout"
```

---

### Task 4: JS — Rewrite checkExistingApps() for Gallery

**Files:**
- Modify: `skills/vibes/templates/editor.html:1235-1280` (checkExistingApps function)

**Step 1: Replace checkExistingApps() with new gallery renderer**

Replace the entire `checkExistingApps()` function:

```javascript
  async function checkExistingApps() {
    try {
      const [existsRes, appsRes] = await Promise.all([
        fetch('/editor/app-exists').then(r => r.json()).catch(() => ({ exists: false })),
        fetch('/editor/apps').then(r => r.json()).catch(() => []),
      ]);

      const hasCurrentApp = existsRes.exists;
      const savedApps = Array.isArray(appsRes) ? appsRes : [];

      if (!hasCurrentApp && savedApps.length === 0) return;

      // Show right panel, remove single-panel centering
      const phase = document.getElementById('phaseGenerate');
      const right = document.getElementById('generateRight');
      phase.classList.remove('single-panel');
      right.style.display = '';

      const grid = document.getElementById('appGalleryGrid');
      const olderList = document.getElementById('appListOlder');
      const divider = document.getElementById('galleryDivider');

      let gridHtml = '';
      let listHtml = '';

      // "Continue current app" always goes first as a card
      if (hasCurrentApp) {
        gridHtml += `<div class="app-card" onclick="useExistingApp()">
          <div class="app-card-thumb"><span class="app-card-placeholder">&#9998;</span></div>
          <div class="app-card-info">
            <div class="app-card-name">Continue current app</div>
            <div class="app-card-meta">app.jsx in working directory</div>
          </div>
        </div>`;
      }

      // Top 8 recent apps get cards with screenshots
      const recentApps = savedApps.slice(0, 8);
      const olderApps = savedApps.slice(8);

      for (const app of recentApps) {
        const ago = timeAgo(new Date(app.modified));
        const themeLabel = app.themeName ? ' \u00b7 ' + escapeHtml(app.themeName) : '';
        const thumbContent = app.hasScreenshot
          ? `<img src="/editor/apps/screenshot?name=${encodeURIComponent(app.name)}" alt="${escapeHtml(app.name)}" loading="lazy">`
          : `<span class="app-card-placeholder">&#9670;</span>`;
        gridHtml += `<div class="app-card" onclick="loadSavedApp('${escapeHtml(app.name)}')">
          <div class="app-card-thumb">${thumbContent}</div>
          <div class="app-card-info">
            <div class="app-card-name">${escapeHtml(app.name)}</div>
            <div class="app-card-meta">${ago}${themeLabel}</div>
          </div>
        </div>`;
      }

      // Older apps get compact list items
      for (const app of olderApps) {
        const ago = timeAgo(new Date(app.modified));
        const themeLabel = app.themeName ? ' \u00b7 ' + escapeHtml(app.themeName) : '';
        listHtml += `<button class="app-item" onclick="loadSavedApp('${escapeHtml(app.name)}')">
          <div>
            <div class="app-item-name">${escapeHtml(app.name)}</div>
            <div class="app-item-meta">${ago}${themeLabel}</div>
          </div>
          <span style="font-size:1.2rem">&#8594;</span>
        </button>`;
      }

      grid.innerHTML = gridHtml;
      if (listHtml) {
        divider.style.display = '';
        olderList.innerHTML = listHtml;
      }
    } catch (err) {
      console.error('Failed to check apps:', err);
    }
  }
```

**Step 2: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "Rewrite app list as gallery grid with screenshot cards"
```

---

### Task 5: JS — Screenshot Capture After Deploy

**Files:**
- Modify: `skills/vibes/templates/editor.html` (deploy_complete handler ~line 1127, and new captureScreenshot function)

**Step 1: Add html2canvas CDN script tag**

In the `<head>` section (around line 6), add:

```html
  <script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js" defer></script>
```

**Step 2: Add captureScreenshot function**

Add after the `autoSaveApp()` function (~line 1330):

```javascript
  async function captureScreenshot() {
    if (!currentAppName) return;
    try {
      const frame = document.getElementById('previewFrame');
      const doc = frame.contentDocument || frame.contentWindow.document;
      if (!doc || !doc.body) return;
      if (typeof html2canvas === 'undefined') return;
      const canvas = await html2canvas(doc.body, {
        width: 1280,
        height: 800,
        windowWidth: 1280,
        windowHeight: 800,
        scale: 0.5,
        useCORS: true,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await fetch('/editor/apps/screenshot?name=' + encodeURIComponent(currentAppName), {
            method: 'POST',
            body: blob,
          });
          console.log('[Screenshot] Saved for', currentAppName);
        } catch (err) {
          console.warn('[Screenshot] Failed to save:', err);
        }
      }, 'image/png');
    } catch (err) {
      console.warn('[Screenshot] Capture failed:', err);
    }
  }
```

**Step 3: Call captureScreenshot after deploy_complete**

In the WebSocket message handler, modify the `deploy_complete` branch (~line 1127):

```javascript
      } else if (msg.type === 'deploy_complete') {
        setThinking(false);
        addMessage('deploy-success', 'Deployed! ' + (msg.url || ''));
        captureScreenshot();
      }
```

**Step 4: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "Capture screenshot on deploy via html2canvas"
```

---

### Task 6: Test End-to-End

**Step 1: Start preview server**

```bash
cd scripts && node preview-server.js
```

**Step 2: Verify gallery layout**

Open the editor in browser. If saved apps exist, confirm:
- Two panels side by side
- Left panel has prompt/theme/generate
- Right panel shows app cards in 2-column grid
- Cards with screenshots show the image
- Cards without screenshots show placeholder icon
- If more than 8 apps, older ones appear as compact list below

**Step 3: Verify screenshot capture**

Generate or load an app, deploy it, then:
- Check console for `[Screenshot] Saved for <name>`
- Navigate back to the landing page and verify the thumbnail appears
- Check `~/.vibes/apps/<name>/screenshot.png` exists on disk

**Step 4: Verify responsive**

Narrow the browser window below 768px and confirm panels stack vertically.

**Step 5: Verify empty state**

Delete `~/.vibes/apps/` temporarily and confirm the landing page shows only the centered prompt card (single-panel mode).

**Step 6: Final commit**

```bash
git add -A
git commit -m "Editor app gallery with screenshot previews"
```
