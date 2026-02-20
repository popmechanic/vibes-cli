# Live Preview Wrapper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a side-by-side preview wrapper with chat (bridged to Claude Code via WebSocket) and a 41-theme selector modal.

**Architecture:** A Node.js HTTP+WebSocket server (`scripts/preview-server.js`) serves a single-page preview HTML. The HTML renders the app in an iframe (left 60%) and a chat panel (right 40%). Chat messages and theme switches are sent via WebSocket to the server, which spawns `claude -p` subprocesses to edit `app.jsx`, then signals the client to reload.

**Tech Stack:** Node.js native `http` + `ws` (WebSocket), React 18 UMD, Babel standalone, `claude` CLI (`-p` flag with `--output-format json`)

---

### Task 1: Theme Catalog Parser

Parse `skills/vibes/themes/catalog.txt` into a JSON array the server can serve.

**Files:**
- Create: `scripts/lib/parse-theme-catalog.js`
- Test: `scripts/__tests__/unit/parse-theme-catalog.test.js`

**Step 1: Write the failing test**

Create `scripts/__tests__/unit/parse-theme-catalog.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseThemeCatalog } from '../../lib/parse-theme-catalog.js';

const SAMPLE_CATALOG = `
THEME CATALOG
---------------------

| Theme ID    | Name              | Mood                        | Best For                                                      |
|-------------|-------------------|-----------------------------|---------------------------------------------------------------|
| default     | Neo-Brutalist     | Bold, graphic, utilitarian  | General-purpose CRUD, dashboards, form-heavy apps             |
| archive     | Editorial Archive | Quiet, refined, documentary | Portfolios, catalogs, collections, galleries, timelines       |
| rift        | Rift Portal       | Sci-fi-neon, space-void, multi-accent, machine-framed | Fan sites, gaming hubs, media browsers, entertainment portals     |

HOW TO CHOOSE
-------------
`;

describe('parseThemeCatalog', () => {
  it('extracts theme rows from catalog text', () => {
    const themes = parseThemeCatalog(SAMPLE_CATALOG);
    expect(themes).toHaveLength(3);
    expect(themes[0]).toEqual({
      id: 'default',
      name: 'Neo-Brutalist',
      mood: 'Bold, graphic, utilitarian',
      bestFor: 'General-purpose CRUD, dashboards, form-heavy apps',
    });
    expect(themes[2].id).toBe('rift');
  });

  it('returns empty array for empty input', () => {
    expect(parseThemeCatalog('')).toEqual([]);
  });

  it('skips header and separator rows', () => {
    const themes = parseThemeCatalog(SAMPLE_CATALOG);
    const ids = themes.map(t => t.id);
    expect(ids).not.toContain('Theme ID');
    expect(ids).not.toContain('---');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli/scripts && npx vitest run __tests__/unit/parse-theme-catalog.test.js`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `scripts/lib/parse-theme-catalog.js`:

```js
/**
 * Parse the theme catalog table from catalog.txt into a JSON array.
 * Extracts rows from the markdown table between "THEME CATALOG" and "HOW TO CHOOSE".
 */
export function parseThemeCatalog(text) {
  const lines = text.split('\n');
  const themes = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table rows: must start with | and contain at least 4 pipe-separated cells
    if (!trimmed.startsWith('|')) {
      if (inTable && themes.length > 0) break; // past the table
      continue;
    }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 4) continue;

    // Skip header row and separator rows
    if (cells[0] === 'Theme ID' || cells[0].startsWith('---')) continue;

    inTable = true;
    themes.push({
      id: cells[0],
      name: cells[1],
      mood: cells[2],
      bestFor: cells[3],
    });
  }

  return themes;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli/scripts && npx vitest run __tests__/unit/parse-theme-catalog.test.js`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add scripts/lib/parse-theme-catalog.js scripts/__tests__/unit/parse-theme-catalog.test.js
git commit -m "feat: add theme catalog parser for preview server"
```

---

### Task 2: Preview Server (HTTP + WebSocket)

The core server that serves preview.html, app.jsx, themes JSON, and bridges chat/theme WebSocket messages to `claude -p`.

**Files:**
- Create: `scripts/preview-server.js`

**Step 1: Write the HTTP server skeleton**

Create `scripts/preview-server.js`:

```js
#!/usr/bin/env node
/**
 * Live Preview Server
 *
 * HTTP server serves preview.html, app.jsx, and theme catalog.
 * WebSocket server bridges chat messages and theme switches to claude -p.
 *
 * Usage: node scripts/preview-server.js [--port 3333]
 */

import { createServer } from 'http';
import { readFileSync, existsSync, watch } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { parseThemeCatalog } from './lib/parse-theme-catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3333', 10);

// --- Load theme catalog at startup ---
const catalogPath = join(PROJECT_ROOT, 'skills/vibes/themes/catalog.txt');
let themes = [];
if (existsSync(catalogPath)) {
  themes = parseThemeCatalog(readFileSync(catalogPath, 'utf-8'));
  console.log(`Loaded ${themes.length} themes from catalog`);
}

// --- Find plugin root for theme files ---
const THEME_DIR = join(PROJECT_ROOT, 'skills/vibes/themes');

// --- MIME types ---
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// --- HTTP Server ---
function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // GET / → preview.html
  if (pathname === '/' || pathname === '/index.html') {
    const previewPath = join(PROJECT_ROOT, 'skills/vibes/templates/preview.html');
    if (!existsSync(previewPath)) {
      res.writeHead(404);
      return res.end('preview.html not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(readFileSync(previewPath, 'utf-8'));
  }

  // GET /app.jsx → current app.jsx from project root
  if (pathname === '/app.jsx') {
    const appPath = join(PROJECT_ROOT, 'app.jsx');
    if (!existsSync(appPath)) {
      res.writeHead(404);
      return res.end('app.jsx not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(readFileSync(appPath, 'utf-8'));
  }

  // GET /themes → JSON array of themes
  if (pathname === '/themes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(themes));
  }

  // GET /app-frame → the inner iframe HTML (mocked Fireproof + Babel)
  if (pathname === '/app-frame') {
    const appPath = join(PROJECT_ROOT, 'app.jsx');
    const appCode = existsSync(appPath) ? readFileSync(appPath, 'utf-8') : '// no app.jsx found';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(buildAppFrameHtml(appCode));
  }

  // Static file fallback (bundles, assets)
  const filePath = join(PROJECT_ROOT, pathname.slice(1));
  if (existsSync(filePath)) {
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(readFileSync(filePath));
  }

  res.writeHead(404);
  res.end('Not found');
}

const server = createServer(handleRequest);

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });
let activeClaude = null; // track active claude process

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (msg.type === 'chat') {
      await handleChat(ws, msg.message);
    } else if (msg.type === 'theme') {
      await handleThemeSwitch(ws, msg.themeId);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// --- Claude Code Bridge ---

async function runClaude(ws, prompt) {
  if (activeClaude) {
    ws.send(JSON.stringify({ type: 'error', message: 'Another request is in progress. Please wait.' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'status', status: 'thinking' }));

  return new Promise((resolve) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--allowedTools', 'Edit,Read,Write,Glob,Grep',
      '--no-session-persistence',
    ];

    console.log('[Claude] Spawning: claude', args.slice(0, 2).join(' '), '...');
    const child = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeClaude = child;

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      activeClaude = null;

      if (code !== 0) {
        console.error('[Claude] Error:', stderr);
        ws.send(JSON.stringify({ type: 'error', message: `Claude exited with code ${code}: ${stderr.slice(0, 200)}` }));
        resolve(null);
        return;
      }

      // Parse JSON output to extract result text
      let resultText = '';
      try {
        const result = JSON.parse(stdout);
        resultText = result.result || 'Done.';
      } catch {
        resultText = stdout.slice(0, 500) || 'Done.';
      }

      // Signal the client
      ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: resultText }));
      ws.send(JSON.stringify({ type: 'app_updated' }));
      resolve(resultText);
    });

    child.on('error', (err) => {
      activeClaude = null;
      console.error('[Claude] Spawn error:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: `Failed to start claude: ${err.message}` }));
      resolve(null);
    });
  });
}

async function handleChat(ws, message) {
  const prompt = `The user is iterating on a React app in app.jsx (in the current directory).

User says: "${message}"

Edit app.jsx to implement the requested changes. Rules:
- Keep all globals: useTenant(), useFireproofClerk(), useVibesTheme(), useState, useEffect, etc.
- Do NOT add import statements — the app runs in a Babel script block with globals
- Do NOT use TypeScript
- Keep export default App at the bottom
- Preserve the window.__VIBES_THEMES__ array at the top of the file`;

  await runClaude(ws, prompt);
}

async function handleThemeSwitch(ws, themeId) {
  // Read the theme file for design principles
  const themeFile = join(THEME_DIR, `${themeId}.md`);
  let themeContent = '';
  if (existsSync(themeFile)) {
    themeContent = readFileSync(themeFile, 'utf-8');
  } else {
    // Try .txt extension
    const txtFile = join(THEME_DIR, `${themeId}.txt`);
    if (existsSync(txtFile)) {
      themeContent = readFileSync(txtFile, 'utf-8');
    }
  }

  const themeMeta = themes.find(t => t.id === themeId);
  const themeName = themeMeta ? themeMeta.name : themeId;

  const prompt = `Restyle the React app in app.jsx using the "${themeName}" (${themeId}) theme.

${themeContent ? `Theme design principles and tokens:\n\n${themeContent}\n\n` : ''}Rules:
- Preserve ALL functionality — only change visual styling and layout
- Keep useVibesTheme() and the theme switching mechanism (window.__VIBES_THEMES__, vibes-design-request listener)
- Update the window.__VIBES_THEMES__ array to include { id: "${themeId}", name: "${themeName}" } alongside any existing themes
- Do NOT add import statements — the app runs in a Babel script block with globals
- Do NOT use TypeScript
- Create a completely new layout for the ${themeName} theme — not just color swaps
- Keep all globals: useTenant(), useFireproofClerk(), useState, useEffect, etc.
- Keep export default App at the bottom`;

  await runClaude(ws, prompt);
}

// --- App Frame HTML Builder ---
// Builds the inner iframe HTML with mocked Fireproof + Babel

function buildAppFrameHtml(appCode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App Preview</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <script>
    // Expose React hooks as globals
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useCallback = React.useCallback;
    var useMemo = React.useMemo;
    var createContext = React.createContext;
    var useContext = React.useContext;

    // Mock useTenant
    function useTenant() {
      return { dbName: "preview-db", subdomain: "preview" };
    }

    // In-memory Fireproof mock
    var _storeData = [];
    var _storeListeners = new Set();
    function _notify() { _storeListeners.forEach(function(cb) { cb(); }); }

    function useFireproofClerk(dbName) {
      var _s = React.useState(0);
      var revision = _s[0];
      var setRevision = _s[1];

      React.useEffect(function() {
        var cb = function() { setRevision(function(r) { return r + 1; }); };
        _storeListeners.add(cb);
        return function() { _storeListeners.delete(cb); };
      }, []);

      var database = React.useMemo(function() {
        return {
          put: function(doc) {
            var id = doc._id || 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            var idx = _storeData.findIndex(function(d) { return d._id === id; });
            var saved = Object.assign({}, doc, { _id: id });
            if (idx >= 0) _storeData[idx] = saved;
            else _storeData.push(saved);
            _notify();
            return Promise.resolve({ id: id });
          },
          del: function(id) {
            _storeData = _storeData.filter(function(d) { return d._id !== id; });
            _notify();
            return Promise.resolve();
          }
        };
      }, []);

      function useLiveQuery(field, opts) {
        void revision;
        var docs = _storeData.filter(function(d) {
          return opts && opts.key ? d[field] === opts.key : true;
        });
        return { docs: docs };
      }

      function useDocument(initial) {
        var _d = React.useState(Object.assign({}, initial));
        var doc = _d[0];
        var setDoc = _d[1];
        return {
          doc: doc,
          merge: function(updates) {
            setDoc(function(prev) { return Object.assign({}, prev, updates); });
          },
          submit: function() {
            var newDoc = Object.assign({}, doc, {
              _id: 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2)
            });
            _storeData.push(newDoc);
            _notify();
            setDoc(Object.assign({}, initial));
          }
        };
      }

      return { database: database, useLiveQuery: useLiveQuery, useDocument: useDocument };
    }
  <\/script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
${appCode}

    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(<App />);
  <\/script>
</body>
</html>`;
}

// --- Start ---
server.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────────────┐
│  Vibes Live Preview Server                      │
├─────────────────────────────────────────────────┤
│                                                 │
│  Preview:  http://localhost:${PORT}                │
│  Themes:   ${themes.length} loaded                         │
│                                                 │
│  Chat and theme changes bridge to Claude Code   │
│  via WebSocket → claude -p subprocess           │
│                                                 │
│  Press Ctrl+C to stop                           │
└─────────────────────────────────────────────────┘
  `);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use. Try: node scripts/preview-server.js --port 3334`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
```

**Step 2: Install `ws` dependency**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli/scripts && npm install ws`

**Step 3: Verify server starts without errors**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli && timeout 3 node scripts/preview-server.js 2>&1 || true`
Expected: Prints startup banner with "Vibes Live Preview Server" then exits on timeout

**Step 4: Commit**

```bash
git add scripts/preview-server.js scripts/package.json scripts/package-lock.json
git commit -m "feat: add live preview server with WebSocket bridge to Claude Code"
```

---

### Task 3: Preview HTML (Side-by-Side UI)

The main single-page app with app preview iframe (left), chat panel (right), and theme modal.

**Files:**
- Create: `skills/vibes/templates/preview.html`

**Step 1: Write the preview HTML**

Create `skills/vibes/templates/preview.html` — a self-contained HTML file with embedded CSS and JS:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vibes Live Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* === HEADER === */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      background: #16213e;
      border-bottom: 1px solid #0f3460;
      min-height: 48px;
      flex-shrink: 0;
    }
    .header-left { display: flex; align-items: center; gap: 0.75rem; }
    .header-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #e94560;
      letter-spacing: 0.05em;
    }
    .header-btn {
      background: #0f3460;
      border: 1px solid #533483;
      color: #e0e0e0;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .header-btn:hover { background: #533483; border-color: #e94560; }

    /* === MAIN SPLIT === */
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* === PREVIEW PANEL === */
    .preview-panel {
      flex: 0 0 60%;
      position: relative;
      background: #fff;
      overflow: hidden;
    }
    .preview-panel.thinking { opacity: 0.5; transition: opacity 0.3s; }
    .preview-panel.updated {
      animation: flash-border 0.6s ease-out;
    }
    @keyframes flash-border {
      0% { box-shadow: inset 0 0 0 3px #22c55e; }
      100% { box-shadow: inset 0 0 0 0px transparent; }
    }
    .preview-iframe {
      width: 100%;
      height: 100%;
      border: none;
    }

    /* === SPLITTER === */
    .splitter {
      width: 6px;
      background: #0f3460;
      cursor: col-resize;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    .splitter:hover, .splitter.dragging { background: #e94560; }

    /* === CHAT PANEL === */
    .chat-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #16213e;
      min-width: 280px;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .chat-bubble {
      max-width: 85%;
      padding: 0.6rem 0.85rem;
      border-radius: 12px;
      font-size: 0.8125rem;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .chat-bubble.user {
      align-self: flex-end;
      background: #533483;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .chat-bubble.assistant {
      align-self: flex-start;
      background: #0f3460;
      color: #e0e0e0;
      border-bottom-left-radius: 4px;
    }
    .chat-bubble.error {
      align-self: center;
      background: #7f1d1d;
      color: #fca5a5;
      font-size: 0.75rem;
    }
    .chat-bubble.system {
      align-self: center;
      background: transparent;
      color: #64748b;
      font-size: 0.75rem;
      font-style: italic;
    }
    .thinking-indicator {
      align-self: flex-start;
      display: flex;
      gap: 4px;
      padding: 0.6rem 0.85rem;
    }
    .thinking-dot {
      width: 8px;
      height: 8px;
      background: #533483;
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out;
    }
    .thinking-dot:nth-child(2) { animation-delay: 0.16s; }
    .thinking-dot:nth-child(3) { animation-delay: 0.32s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-8px); }
    }

    /* === CHAT INPUT === */
    .chat-input-bar {
      display: flex;
      padding: 0.75rem;
      gap: 0.5rem;
      border-top: 1px solid #0f3460;
      background: #1a1a2e;
    }
    .chat-input {
      flex: 1;
      background: #0f3460;
      border: 1px solid #533483;
      color: #e0e0e0;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      font-size: 0.8125rem;
      outline: none;
      resize: none;
      font-family: inherit;
      min-height: 38px;
      max-height: 120px;
    }
    .chat-input:focus { border-color: #e94560; }
    .chat-input::placeholder { color: #64748b; }
    .chat-send {
      background: #e94560;
      border: none;
      color: white;
      padding: 0 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 600;
      transition: background 0.2s;
      flex-shrink: 0;
    }
    .chat-send:hover { background: #c53050; }
    .chat-send:disabled { background: #4a4a4a; cursor: not-allowed; }

    /* === THEME MODAL === */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #16213e;
      border: 1px solid #0f3460;
      border-radius: 12px;
      width: 90vw;
      max-width: 800px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid #0f3460;
    }
    .modal-header h2 {
      font-size: 1rem;
      font-weight: 600;
      color: #e94560;
    }
    .modal-close {
      background: none;
      border: none;
      color: #64748b;
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
    }
    .modal-close:hover { color: #e94560; }
    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
    }
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }
    .theme-card {
      background: #1a1a2e;
      border: 1px solid #0f3460;
      border-radius: 8px;
      padding: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .theme-card:hover {
      border-color: #e94560;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(233, 69, 96, 0.2);
    }
    .theme-card-name {
      font-size: 0.8125rem;
      font-weight: 600;
      color: #e0e0e0;
      margin-bottom: 0.25rem;
    }
    .theme-card-mood {
      font-size: 0.6875rem;
      color: #64748b;
      margin-bottom: 0.35rem;
    }
    .theme-card-for {
      font-size: 0.625rem;
      color: #533483;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <span class="header-title">VIBES LIVE PREVIEW</span>
      <button class="header-btn" id="themeBtn" onclick="openThemeModal()">
        <span>&#127912;</span> Themes
      </button>
    </div>
    <div>
      <button class="header-btn" onclick="reloadPreview()">
        <span>&#8635;</span> Reload
      </button>
    </div>
  </div>

  <!-- Main Split -->
  <div class="main">
    <!-- Preview -->
    <div class="preview-panel" id="previewPanel">
      <iframe class="preview-iframe" id="previewFrame" src="/app-frame"></iframe>
    </div>

    <!-- Splitter -->
    <div class="splitter" id="splitter"></div>

    <!-- Chat -->
    <div class="chat-panel" id="chatPanel">
      <div class="chat-messages" id="chatMessages">
        <div class="chat-bubble system">Connected to Vibes Live Preview. Send a message to iterate on your app, or click Themes to switch designs.</div>
      </div>
      <div class="chat-input-bar">
        <textarea class="chat-input" id="chatInput" placeholder="Describe changes to your app..." rows="1"
          onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendMessage();}"></textarea>
        <button class="chat-send" id="sendBtn" onclick="sendMessage()">Send</button>
      </div>
    </div>
  </div>

  <!-- Theme Modal -->
  <div class="modal-overlay" id="themeModal">
    <div class="modal">
      <div class="modal-header">
        <h2>Choose a Theme</h2>
        <button class="modal-close" onclick="closeThemeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="theme-grid" id="themeGrid">
          <!-- Populated by JS -->
        </div>
      </div>
    </div>
  </div>

  <script>
    // === State ===
    let ws = null;
    let isThinking = false;
    let themes = [];

    // === WebSocket ===
    function connectWs() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}`);

      ws.onopen = () => {
        console.log('[WS] Connected');
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'status') {
          if (msg.status === 'thinking') {
            setThinking(true);
          }
        } else if (msg.type === 'chat') {
          setThinking(false);
          addMessage(msg.role, msg.content);
        } else if (msg.type === 'app_updated') {
          setThinking(false);
          reloadPreview();
        } else if (msg.type === 'error') {
          setThinking(false);
          addMessage('error', msg.message);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 2s...');
        setTimeout(connectWs, 2000);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    }

    // === Chat ===
    function sendMessage() {
      const input = document.getElementById('chatInput');
      const text = input.value.trim();
      if (!text || isThinking || !ws || ws.readyState !== WebSocket.OPEN) return;

      addMessage('user', text);
      ws.send(JSON.stringify({ type: 'chat', message: text }));
      input.value = '';
      input.style.height = 'auto';
    }

    function addMessage(role, content) {
      const container = document.getElementById('chatMessages');

      // Remove thinking indicator if present
      const indicator = container.querySelector('.thinking-indicator');
      if (indicator) indicator.remove();

      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${role}`;
      bubble.textContent = content;
      container.appendChild(bubble);
      container.scrollTop = container.scrollHeight;
    }

    function setThinking(thinking) {
      isThinking = thinking;
      const panel = document.getElementById('previewPanel');
      const sendBtn = document.getElementById('sendBtn');
      const container = document.getElementById('chatMessages');

      if (thinking) {
        panel.classList.add('thinking');
        sendBtn.disabled = true;

        const indicator = document.createElement('div');
        indicator.className = 'thinking-indicator';
        indicator.innerHTML = '<div class="thinking-dot"></div><div class="thinking-dot"></div><div class="thinking-dot"></div>';
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
      } else {
        panel.classList.remove('thinking');
        panel.classList.add('updated');
        setTimeout(() => panel.classList.remove('updated'), 600);
        sendBtn.disabled = false;
      }
    }

    // === Preview ===
    function reloadPreview() {
      const frame = document.getElementById('previewFrame');
      frame.src = '/app-frame?t=' + Date.now();
    }

    // === Themes ===
    async function loadThemes() {
      try {
        const res = await fetch('/themes');
        themes = await res.json();
        renderThemeGrid();
      } catch (err) {
        console.error('Failed to load themes:', err);
      }
    }

    function renderThemeGrid() {
      const grid = document.getElementById('themeGrid');
      grid.innerHTML = themes.map(t => `
        <div class="theme-card" onclick="selectTheme('${t.id}')">
          <div class="theme-card-name">${t.name}</div>
          <div class="theme-card-mood">${t.mood}</div>
          <div class="theme-card-for">${t.bestFor}</div>
        </div>
      `).join('');
    }

    function selectTheme(themeId) {
      if (isThinking || !ws || ws.readyState !== WebSocket.OPEN) return;

      const theme = themes.find(t => t.id === themeId);
      addMessage('user', `Switch to theme: ${theme ? theme.name : themeId}`);
      ws.send(JSON.stringify({ type: 'theme', themeId }));
      closeThemeModal();
    }

    function openThemeModal() {
      document.getElementById('themeModal').classList.add('open');
    }

    function closeThemeModal() {
      document.getElementById('themeModal').classList.remove('open');
    }

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeThemeModal();
    });

    // Close modal on overlay click
    document.getElementById('themeModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeThemeModal();
    });

    // === Resizable Splitter ===
    (function() {
      const splitter = document.getElementById('splitter');
      const preview = document.getElementById('previewPanel');
      let isDragging = false;

      splitter.addEventListener('mousedown', (e) => {
        isDragging = true;
        splitter.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const mainRect = document.querySelector('.main').getBoundingClientRect();
        const pct = ((e.clientX - mainRect.left) / mainRect.width) * 100;
        const clamped = Math.max(30, Math.min(80, pct));
        preview.style.flex = `0 0 ${clamped}%`;
      });

      document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        splitter.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      });
    })();

    // === Auto-resize textarea ===
    document.getElementById('chatInput').addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // === Init ===
    connectWs();
    loadThemes();
  </script>
</body>
</html>
```

**Step 2: Verify the preview.html loads via the server**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli && node scripts/preview-server.js &`
Then in browser: open `http://localhost:3333`
Expected: Side-by-side layout with app preview on left, chat on right, Themes button in header
Kill: `kill %1`

**Step 3: Commit**

```bash
git add skills/vibes/templates/preview.html
git commit -m "feat: add side-by-side preview HTML with chat panel and theme modal"
```

---

### Task 4: Add npm script and update CLAUDE.md

Wire up the convenience script and document the new files.

**Files:**
- Modify: `scripts/package.json`
- Modify: `CLAUDE.md`

**Step 1: Add npm script**

In `scripts/package.json`, add to the `"scripts"` object:

```json
"preview": "node ../scripts/preview-server.js"
```

Wait — the scripts run from the `scripts/` directory but `preview-server.js` IS in `scripts/`. Use:

```json
"preview": "node preview-server.js"
```

**Step 2: Add to CLAUDE.md File Reference table**

Add this row to the File Reference table in CLAUDE.md:

```
| `scripts/preview-server.js` | Live preview server - HTTP + WebSocket bridge to Claude Code |
| `skills/vibes/templates/preview.html` | Side-by-side preview wrapper (chat + theme modal) |
| `scripts/lib/parse-theme-catalog.js` | Parser for theme catalog.txt → JSON array |
```

**Step 3: Commit**

```bash
git add scripts/package.json CLAUDE.md
git commit -m "docs: add preview server to npm scripts and file reference"
```

---

### Task 5: Integration Test — Verify Full Loop

Manual verification that the full system works end-to-end.

**Step 1: Start the preview server**

Run: `cd /Users/ambermacias/Documents/Vibes/vibes-cli && node scripts/preview-server.js`

**Step 2: Open in browser**

Navigate to `http://localhost:3333`

**Step 3: Verify checklist**

- [ ] App preview loads in left panel (shows the anime app)
- [ ] Chat panel visible on right
- [ ] Themes button opens modal with all themes listed
- [ ] Splitter is draggable
- [ ] Type a message and press Enter — sends to Claude, shows thinking dots
- [ ] After Claude responds — preview reloads with changes, response appears in chat
- [ ] Click a theme in modal — sends retheme request, preview updates
- [ ] Error messages display correctly if Claude fails

**Step 4: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix: preview server integration fixes"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Theme catalog parser + tests | `scripts/lib/parse-theme-catalog.js`, `scripts/__tests__/unit/parse-theme-catalog.test.js` |
| 2 | Preview server (HTTP + WebSocket) | `scripts/preview-server.js` |
| 3 | Preview HTML (side-by-side UI) | `skills/vibes/templates/preview.html` |
| 4 | npm script + docs | `scripts/package.json`, `CLAUDE.md` |
| 5 | Integration test | Manual verification |

Total: 5 tasks, 3 new files, 2 modified files.
