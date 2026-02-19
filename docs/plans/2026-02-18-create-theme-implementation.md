# Create Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Create Theme" button to the preview wrapper's theme modal that generates 3 UI mockup images via OpenRouter, lets the user pick one, then uses Claude to extract a theme file from the chosen image.

**Architecture:** New WebSocket message types (`create_theme`, `pick_theme_image`) handled by the preview server. Server calls OpenRouter's image generation API (DALL-E 3) for 3 parallel image generations, then bridges to `claude -p` with the chosen image for theme extraction. Theme file is written to `skills/vibes/themes/` and catalog.txt is updated.

**Tech Stack:** OpenRouter API (DALL-E 3 image generation), Claude CLI (`claude -p` with vision), Node.js `fetch`, existing WebSocket bridge

---

### Task 1: OpenRouter Image Generation Helper

Server-side function to call OpenRouter's image generation API.

**Files:**
- Modify: `scripts/preview-server.js`

**Step 1: Add imports and API key loading**

At the top of `preview-server.js`, after the existing imports and before theme catalog loading, add:

```js
import { readFileSync as readSync } from 'fs';

// --- Load OpenRouter API key ---
function loadOpenRouterKey() {
  // Check project .env first, then ~/.vibes/.env
  for (const dir of [PROJECT_ROOT, join(process.env.HOME || '', '.vibes')]) {
    const envPath = join(dir, '.env');
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('OPENROUTER_API_KEY=')) {
        return trimmed.slice('OPENROUTER_API_KEY='.length).replace(/^["']|["']$/g, '');
      }
    }
  }
  return null;
}

const OPENROUTER_KEY = loadOpenRouterKey();
if (OPENROUTER_KEY) {
  console.log('OpenRouter API key loaded');
} else {
  console.log('No OpenRouter API key found (Create Theme will be disabled)');
}
```

**Step 2: Add image generation function**

After the theme color loading block, add:

```js
// --- OpenRouter Image Generation ---
const IMAGE_VARIATIONS = [
  'Emphasize card-based layout with prominent hero section',
  'Emphasize sidebar navigation with dense data grid',
  'Emphasize split-pane layout with large media and detail panel',
];

async function generateThemeImages(prompt) {
  if (!OPENROUTER_KEY) {
    throw new Error('OpenRouter API key required. Add OPENROUTER_API_KEY to .env');
  }

  const requests = IMAGE_VARIATIONS.map((variation, i) =>
    fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vibes.diy',
        'X-Title': 'Vibes Theme Creator',
      },
      body: JSON.stringify({
        model: 'openai/dall-e-3',
        prompt: `UI design mockup for a web application. Style: ${prompt}. ${variation}. Show a full-page layout with navigation, cards, buttons, and content areas. Clean, modern interface design. Focus on color palette, typography hierarchy, and visual design language. No placeholder text.`,
        n: 1,
        size: '1024x1024',
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.text();
        console.error(`[OpenRouter] Image ${i + 1} failed:`, err);
        return null;
      }
      const data = await res.json();
      return data.data?.[0]?.url || null;
    }).catch((err) => {
      console.error(`[OpenRouter] Image ${i + 1} error:`, err.message);
      return null;
    })
  );

  return Promise.all(requests);
}
```

**Step 3: Verify server still starts**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli && timeout 3 node scripts/preview-server.js 2>&1; true`
Expected: Prints startup banner with "OpenRouter API key loaded" or "No OpenRouter API key found"

**Step 4: Commit**

```bash
git add scripts/preview-server.js
git commit -m "feat: add OpenRouter image generation helper for theme creation"
```

---

### Task 2: Theme Extraction via Claude

Server-side function to send an image to Claude and extract a theme file.

**Files:**
- Modify: `scripts/preview-server.js`

**Step 1: Add slug generator**

After the `generateThemeImages` function, add:

```js
// --- Theme ID generation ---
function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function uniqueThemeId(base) {
  let id = base;
  let n = 2;
  while (existsSync(join(THEME_DIR, `${id}.txt`))) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}
```

**Step 2: Add theme extraction function**

```js
async function extractThemeFromImage(imageUrl, prompt, themeId, themeName) {
  // Read a reference theme for format
  const refPath = join(THEME_DIR, 'archive.txt');
  const refContent = existsSync(refPath) ? readFileSync(refPath, 'utf-8') : '';

  const extractPrompt = `You are creating a new Vibes theme by analyzing a UI mockup image.

The user's prompt was: "${prompt}"
Theme ID: ${themeId}
Theme Name: ${themeName}

Analyze the image carefully. Extract:
- The dominant color palette (convert to oklch values)
- The layout style and design principles
- The mood and personality
- What types of apps it would be best for

Write a theme file in EXACTLY this format (use the reference as a structural guide):

---BEGIN REFERENCE FORMAT---
${refContent.slice(0, 2000)}
---END REFERENCE FORMAT---

RULES:
- Start with THEME: ${themeId}
- NAME: ${themeName}
- MOOD: (extracted from the image)
- All color tokens MUST be oklch() values
- Include sections: DESCRIPTION, BEST FOR, NOT FOR, ADAPTATION NOTES, COLOR TOKENS, DESIGN PRINCIPLES, PERSONALITY, ANIMATIONS, SVG ELEMENTS
- The COLOR TOKENS section must have a \`:root\` CSS block with --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background, --grid-color
- Include REFERENCE CSS section with example component styles matching the image's aesthetic
- Write the complete file to: skills/vibes/themes/${themeId}.txt

After writing the theme file, append this row to skills/vibes/themes/catalog.txt — add it as the LAST row before the "HOW TO CHOOSE" line:
| ${themeId.padEnd(11)} | ${themeName.padEnd(17)} | {mood from image, comma-separated} | {best-for summary} |

Image URL to analyze: ${imageUrl}`;

  return new Promise((resolve, reject) => {
    const args = [
      '--output-format', 'json',
      '--allowedTools', 'Edit,Read,Write,Glob,Grep',
      '--no-session-persistence',
      '-p', '-',
    ];

    const child = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(extractPrompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Claude exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start claude: ${err.message}`));
    });
  });
}
```

**Step 3: Commit**

```bash
git add scripts/preview-server.js
git commit -m "feat: add Claude vision theme extraction for Create Theme"
```

---

### Task 3: WebSocket Handlers for Create Theme

Wire up the new message types in the WebSocket handler.

**Files:**
- Modify: `scripts/preview-server.js`

**Step 1: Add state for pending image generation**

After `let activeClaude = null;`, add:

```js
let pendingImages = []; // stores URLs from last image generation
```

**Step 2: Add message handlers in the ws.on('message') block**

In the existing `ws.on('message')` handler, after the `theme` and `cancel` cases, add:

```js
    } else if (msg.type === 'create_theme') {
      await handleCreateTheme(ws, msg.prompt);
    } else if (msg.type === 'pick_theme_image') {
      await handlePickThemeImage(ws, msg.index, msg.prompt);
    }
```

**Step 3: Write the handler functions**

After `handleThemeSwitch`, add:

```js
async function handleCreateTheme(ws, prompt) {
  if (!OPENROUTER_KEY) {
    ws.send(JSON.stringify({ type: 'error', message: 'OpenRouter API key required. Add OPENROUTER_API_KEY to .env' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'status', status: 'generating_images' }));

  try {
    const images = await generateThemeImages(prompt);
    pendingImages = images;

    const validImages = images.filter(Boolean);
    if (validImages.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'All image generations failed. Check your OpenRouter API key and balance.' }));
      return;
    }

    ws.send(JSON.stringify({ type: 'theme_images', images }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}

async function handlePickThemeImage(ws, index, prompt) {
  const imageUrl = pendingImages[index];
  if (!imageUrl) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid image selection' }));
    return;
  }

  const themeId = uniqueThemeId(slugify(prompt));
  // Title-case the prompt for display name
  const themeName = prompt.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  ws.send(JSON.stringify({ type: 'status', status: 'extracting_theme', themeId, themeName }));

  try {
    await extractThemeFromImage(imageUrl, prompt, themeId, themeName);

    // Reload themes from disk
    const catalogContent = readFileSync(catalogPath, 'utf-8');
    themes = parseThemeCatalog(catalogContent);

    // Reload colors for the new theme
    const newColors = parseThemeColors(themeId);
    if (newColors) themeColors[themeId] = newColors;

    console.log(`[Theme] Created: ${themeId} (${themeName})`);
    ws.send(JSON.stringify({ type: 'theme_created', themeId, themeName }));
  } catch (err) {
    console.error('[Theme] Extraction failed:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: `Theme extraction failed: ${err.message}` }));
  }
}
```

**Step 4: Add `/themes/has-key` endpoint**

In `handleRequest`, after the `/themes` endpoint, add:

```js
  // GET /themes/has-key → whether OpenRouter key is available
  if (pathname === '/themes/has-key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ hasKey: !!OPENROUTER_KEY }));
  }
```

**Step 5: Verify server starts**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli && timeout 3 node scripts/preview-server.js 2>&1; true`
Expected: PASS — server starts without errors

**Step 6: Commit**

```bash
git add scripts/preview-server.js
git commit -m "feat: add WebSocket handlers for Create Theme flow"
```

---

### Task 4: Preview HTML — Create Theme UI

Add the Create Theme button, prompt input, image cards, and extraction state to the theme modal.

**Files:**
- Modify: `skills/vibes/templates/preview.html`

**Step 1: Add CSS for Create Theme UI**

In the `<style>` block, before the closing `</style>`, add:

```css
    /* === CREATE THEME === */
    .create-theme-bar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .create-theme-input {
      flex: 1;
      background: #1a1a2e;
      border: 1px solid #0f3460;
      color: #e0e0e0;
      padding: 0.6rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      outline: none;
      font-family: inherit;
    }
    .create-theme-input:focus { border-color: #e94560; }
    .create-theme-input::placeholder { color: #64748b; }
    .create-theme-btn {
      background: #e94560;
      border: none;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .create-theme-btn:hover { background: #c53050; }
    .create-theme-btn:disabled { background: #4a4a4a; cursor: not-allowed; }
    .image-picker {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .image-card {
      aspect-ratio: 1;
      border-radius: 8px;
      border: 2px solid #0f3460;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .image-card:hover { border-color: #e94560; transform: translateY(-2px); }
    .image-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .image-card.loading {
      cursor: default;
    }
    .image-card.failed {
      border-color: #7f1d1d;
      cursor: default;
    }
    .image-card .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #0f3460;
      border-top-color: #e94560;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .create-status {
      text-align: center;
      padding: 0.75rem;
      font-size: 0.8125rem;
      color: #64748b;
    }
    .create-status.success { color: #22c55e; }
    .create-status.error { color: #fca5a5; }
    .create-back-btn {
      background: #0f3460;
      border: 1px solid #533483;
      color: #e0e0e0;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      margin-top: 0.5rem;
    }
    .create-back-btn:hover { background: #533483; }
```

**Step 2: Add Create Theme button to modal header**

Replace the modal header HTML:

```html
      <div class="modal-header">
        <h2>Choose a Theme</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <button class="header-btn" id="createThemeToggle" onclick="toggleCreateMode()">+ Create</button>
          <button class="modal-close" onclick="closeThemeModal()">&times;</button>
        </div>
      </div>
```

**Step 3: Add Create Theme section in modal body**

At the start of the modal body div (before the search input), add:

```html
        <div id="createThemeSection" style="display:none;">
          <div class="create-theme-bar">
            <input type="text" class="create-theme-input" id="createThemePrompt"
              placeholder="Describe your theme (e.g. cyberpunk neon Tokyo)"
              onkeydown="if(event.key==='Enter'){generateThemeImages();}" />
            <button class="create-theme-btn" id="createThemeBtn" onclick="generateThemeImages()">Generate</button>
          </div>
          <div id="imagePickerArea"></div>
        </div>
```

**Step 4: Add JavaScript for Create Theme**

In the `<script>` block, before `// === Init ===`, add:

```js
    // === Create Theme ===
    let createMode = false;
    let hasOpenRouterKey = false;

    async function checkOpenRouterKey() {
      try {
        const res = await fetch('/themes/has-key');
        const data = await res.json();
        hasOpenRouterKey = data.hasKey;
        document.getElementById('createThemeToggle').style.display = hasOpenRouterKey ? '' : 'none';
      } catch { /* ignore */ }
    }

    function toggleCreateMode() {
      createMode = !createMode;
      document.getElementById('createThemeSection').style.display = createMode ? '' : 'none';
      document.getElementById('themeSearch').style.display = createMode ? 'none' : '';
      document.getElementById('themeGrid').style.display = createMode ? 'none' : '';
      document.getElementById('createThemeToggle').textContent = createMode ? 'Browse' : '+ Create';
      if (createMode) {
        document.getElementById('createThemePrompt').focus();
        document.getElementById('imagePickerArea').innerHTML = '';
      } else {
        renderThemeGrid();
      }
    }

    function generateThemeImages() {
      const input = document.getElementById('createThemePrompt');
      const prompt = input.value.trim();
      if (!prompt || !ws || ws.readyState !== WebSocket.OPEN) return;

      document.getElementById('createThemeBtn').disabled = true;
      document.getElementById('imagePickerArea').innerHTML =
        '<div class="image-picker">' +
        '<div class="image-card loading"><div class="spinner"></div></div>'.repeat(3) +
        '</div>' +
        '<div class="create-status">Generating 3 design variations...</div>';

      ws.send(JSON.stringify({ type: 'create_theme', prompt }));
    }

    function showThemeImages(images) {
      const prompt = document.getElementById('createThemePrompt').value.trim();
      const area = document.getElementById('imagePickerArea');
      const cards = images.map((url, i) => {
        if (!url) return '<div class="image-card failed"><span style="color:#fca5a5;font-size:0.75rem;">Failed</span></div>';
        return `<div class="image-card" onclick="pickThemeImage(${i})"><img src="${url}" alt="Variation ${i + 1}" /></div>`;
      }).join('');

      area.innerHTML =
        '<div class="image-picker">' + cards + '</div>' +
        '<div class="create-status">Click the design you like best</div>';
      document.getElementById('createThemeBtn').disabled = false;
    }

    function pickThemeImage(index) {
      const prompt = document.getElementById('createThemePrompt').value.trim();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // Highlight selected card
      const cards = document.querySelectorAll('.image-card');
      cards.forEach((c, i) => {
        c.style.opacity = i === index ? '1' : '0.3';
        c.style.pointerEvents = 'none';
      });

      document.getElementById('imagePickerArea').querySelector('.create-status').innerHTML =
        '<div class="spinner" style="display:inline-block;width:16px;height:16px;vertical-align:middle;margin-right:0.5rem;"></div>Claude is analyzing the design and writing your theme...';

      ws.send(JSON.stringify({ type: 'pick_theme_image', index, prompt }));
    }

    function onThemeCreated(themeId, themeName) {
      const area = document.getElementById('imagePickerArea');
      area.innerHTML =
        `<div class="create-status success">Theme "${themeName}" created!</div>` +
        `<div style="text-align:center;"><button class="create-theme-btn" onclick="selectTheme('${themeId}')">Apply ${themeName}</button> ` +
        `<button class="create-back-btn" onclick="toggleCreateMode()">Browse themes</button></div>`;
      document.getElementById('createThemeBtn').disabled = false;

      // Reload themes
      loadThemes();
    }
```

**Step 5: Update the WebSocket `onmessage` handler**

In the existing `ws.onmessage` handler, add cases for the new message types:

```js
        } else if (msg.type === 'theme_images') {
          showThemeImages(msg.images);
        } else if (msg.type === 'theme_created') {
          onThemeCreated(msg.themeId, msg.themeName);
        } else if (msg.type === 'status' && msg.status === 'generating_images') {
          // already handled by the UI showing spinners
        } else if (msg.type === 'status' && msg.status === 'extracting_theme') {
          // already handled by pickThemeImage UI
```

**Step 6: Add `checkOpenRouterKey()` to init**

In the `// === Init ===` section, add after `loadThemes()`:

```js
    checkOpenRouterKey();
```

**Step 7: Verify preview.html loads**

Run the preview server and open `http://localhost:3333`. Verify:
- If OpenRouter key exists: "+ Create" button visible in theme modal header
- Clicking it toggles to prompt input + Generate button
- "Browse" toggles back to theme grid

**Step 8: Commit**

```bash
git add skills/vibes/templates/preview.html
git commit -m "feat: add Create Theme UI to preview wrapper theme modal"
```

---

### Task 5: End-to-End Test

Manual verification of the full Create Theme flow.

**Step 1: Ensure OpenRouter key is available**

Run: `grep OPENROUTER_API_KEY .env ~/.vibes/.env 2>/dev/null`
If not found, add it to `.env`.

**Step 2: Start preview server**

Run: `node scripts/preview-server.js`
Expected: "OpenRouter API key loaded" in output

**Step 3: Open preview and test**

Open `http://localhost:3333`, click Themes → "+ Create":

- [ ] Prompt input and Generate button appear
- [ ] Type a prompt (e.g. "minimalist zen garden") and click Generate
- [ ] 3 spinner cards show, then images load (30-60s)
- [ ] Click an image → selected highlights, others dim
- [ ] Status shows "Claude is analyzing..."
- [ ] After extraction: "Theme created!" with Apply button
- [ ] Click Apply → sends theme switch to Claude
- [ ] Click "Browse themes" → theme grid shows new theme in catalog
- [ ] New theme has color swatches

**Step 4: Verify theme file**

Run: `ls skills/vibes/themes/minimalist-zen-garden.txt`
Run: `grep "minimalist-zen" skills/vibes/themes/catalog.txt`
Both should exist.

**Step 5: Commit any fixes**

```bash
git add scripts/preview-server.js skills/vibes/templates/preview.html
git commit -m "fix: Create Theme integration fixes"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | OpenRouter image generation helper | `scripts/preview-server.js` |
| 2 | Claude vision theme extraction | `scripts/preview-server.js` |
| 3 | WebSocket handlers + `/themes/has-key` endpoint | `scripts/preview-server.js` |
| 4 | Create Theme UI (HTML/CSS/JS) | `skills/vibes/templates/preview.html` |
| 5 | End-to-end integration test | Manual verification |

Total: 5 tasks, 2 files modified.
