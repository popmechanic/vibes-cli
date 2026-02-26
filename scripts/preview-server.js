#!/usr/bin/env node
/**
 * Live Preview Server
 *
 * HTTP server serves preview.html, app.jsx, and theme catalog.
 * WebSocket server bridges chat messages and theme switches to claude -p.
 *
 * Modes:
 *   --mode=preview  (default) Serves preview.html for terminal-based iteration
 *   --mode=editor   Serves editor.html with setup wizard, generation, and deploy
 *
 * Usage: node scripts/preview-server.js [--port 3333] [--mode=editor]
 */

import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { parseThemeCatalog } from './lib/parse-theme-catalog.js';
import { loadEnvFile, validateClerkKey, populateConnectConfig } from './lib/env-utils.js';
import { hasThemeMarkers, replaceThemeSection, extractNonThemeSections } from './lib/theme-sections.js';
import { createBackup, restoreFromBackup } from './lib/backup.js';
import { APP_PLACEHOLDER } from './lib/assembly-utils.js';
import { stripForTemplate } from './lib/strip-code.js';
import { TEMPLATES } from './lib/paths.js';
import { homedir } from 'os';
import { execFile } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3333', 10);
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=preview').split('=')[1];
const INITIAL_PROMPT = process.argv.find((_, i, a) => a[i - 1] === '--prompt') || '';

// --- Clean env for spawning claude subprocesses (removes nesting guard) ---
function cleanEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

// --- Load OpenRouter API key ---
function loadOpenRouterKey() {
  const candidates = [
    join(PROJECT_ROOT, '.env'),
    join(homedir(), '.vibes', '.env'),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).trim();
      if (key === 'OPENROUTER_API_KEY') {
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (val) {
          console.log(`OpenRouter API key loaded from ${envPath}`);
          return val;
        }
      }
    }
  }
  console.log('OpenRouter API key not found (image generation disabled)');
  return null;
}
const OPENROUTER_KEY = loadOpenRouterKey();

// --- Load theme catalog at startup ---
const catalogPath = join(PROJECT_ROOT, 'skills/vibes/themes/catalog.txt');
let themes = [];
if (existsSync(catalogPath)) {
  themes = parseThemeCatalog(readFileSync(catalogPath, 'utf-8'));
  console.log(`Loaded ${themes.length} themes from catalog`);
}

// --- Find plugin root for theme files ---
const THEME_DIR = join(PROJECT_ROOT, 'skills/vibes/themes');

// --- Apps directory for saved projects ---
const APPS_DIR = join(homedir(), '.vibes', 'apps');
if (!existsSync(APPS_DIR)) mkdirSync(APPS_DIR, { recursive: true });

// --- Recommend themes based on app.jsx content ---
function getRecommendedThemeIds() {
  const appPath = join(PROJECT_ROOT, 'app.jsx');
  if (!existsSync(appPath)) return new Set();

  const code = readFileSync(appPath, 'utf-8').toLowerCase();

  // Extract keywords from app content
  const keywords = new Set();

  // Detect app category from common patterns
  const patterns = [
    [/anime|manga|otaku|episode|series|watchlist/g, ['anime', 'media', 'tracker', 'entertainment', 'catalog']],
    [/blog|article|post|editor|publish|writing/g, ['blog', 'editorial', 'writing', 'content', 'publishing']],
    [/task|todo|project|kanban|board|sprint/g, ['productivity', 'project', 'task', 'management', 'tool']],
    [/recipe|food|cook|ingredient|meal/g, ['food', 'recipe', 'lifestyle', 'catalog']],
    [/music|playlist|song|album|artist/g, ['music', 'media', 'entertainment', 'catalog']],
    [/photo|image|gallery|portfolio/g, ['portfolio', 'gallery', 'creative', 'photography']],
    [/shop|product|cart|price|checkout/g, ['e-commerce', 'shop', 'product', 'retail']],
    [/game|score|level|player/g, ['gaming', 'entertainment', 'interactive']],
    [/chat|message|conversation|dm/g, ['social', 'messaging', 'communication']],
    [/note|journal|diary|log/g, ['notes', 'personal', 'journal', 'writing']],
    [/dashboard|analytics|chart|metric|stat/g, ['dashboard', 'analytics', 'data', 'business']],
    [/fitness|workout|exercise|health/g, ['fitness', 'health', 'tracker', 'lifestyle']],
    [/bookmark|link|save|collection|archive/g, ['catalog', 'archive', 'collection', 'tool']],
  ];

  for (const [regex, tags] of patterns) {
    if (regex.test(code)) tags.forEach(t => keywords.add(t));
  }

  // Score each theme by how well its bestFor/mood matches the app keywords
  const scored = themes.map(t => {
    const text = `${t.bestFor} ${t.mood}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 2;
    }
    // Partial matches
    for (const kw of keywords) {
      for (const word of text.split(/[,\s]+/)) {
        if (word.includes(kw) || kw.includes(word)) score += 1;
      }
    }
    return { id: t.id, score };
  });

  // Return top themes with score > 0, max 8
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter(s => s.score > 0).slice(0, 8);
  return new Set(top.map(s => s.id));
}

// --- Parse color tokens from theme files ---
function parseThemeColors(themeId) {
  const txtFile = join(THEME_DIR, `${themeId}.txt`);
  const mdFile = join(THEME_DIR, `${themeId}.md`);
  const filePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : null;
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf-8');

  // Extract color values from COLOR TOKENS or TOKEN OVERRIDES section
  const colorSection = content.match(/(?:COLOR TOKENS|TOKEN OVERRIDES)[\s\S]*?(?=\n[A-Z]{2,}[A-Z ]*:|$)/);
  if (!colorSection) return null;

  const section = colorSection[0];
  const result = { bg: null, text: null, accent: null, muted: null, border: null };

  // Try standard --comp-* tokens first
  const stdMatch = (name) => {
    const re = new RegExp(`--comp-${name}[^:]*:\\s*([^;\\n/*]+)`);
    const m = section.match(re);
    return m ? m[1].trim() : null;
  };

  result.bg = stdMatch('bg');
  result.text = stdMatch('text');
  result.accent = stdMatch('accent');
  result.muted = stdMatch('muted');
  result.border = stdMatch('border');

  // Fallbacks: try --color-background, or any named token with "bg"/"background"
  if (!result.bg) {
    const m = section.match(/--color-background[^:]*:\s*([^;\n/*]+)/);
    if (m) result.bg = m[1].trim();
  }

  // If still missing, extract the first few distinct oklch/hex colors from the section
  if (!result.bg || !result.accent) {
    const allColors = [...section.matchAll(/oklch\([^)]+\)|#[0-9a-fA-F]{3,8}/g)].map(m => m[0]);
    const unique = [...new Set(allColors)];
    if (!result.bg && unique.length > 0) result.bg = unique[0];
    if (!result.text && unique.length > 1) result.text = unique[1];
    if (!result.accent && unique.length > 2) result.accent = unique[2];
    if (!result.muted && unique.length > 3) result.muted = unique[3];
    if (!result.border && unique.length > 4) result.border = unique[4];
  }

  // Only return if we got at least bg and one other
  const count = Object.values(result).filter(Boolean).length;
  if (count < 2) return null;

  // Extract full :root block for mechanical theme switching (Pass 1).
  // Non-greedy match closes at first `}` — works for theme files (flat variable lists)
  // but would truncate nested braces (e.g. var(--x, var(--y))). Theme files are controlled content.
  const rootMatch = content.match(/:root\s*\{[\s\S]*?\}/);
  if (rootMatch) {
    result.rootBlock = rootMatch[0];
  } else {
    // Build :root from individual variable lines
    const varLines = content.match(/^\s*--[\w-]+:\s*(?:oklch\([^)]+\)|#[0-9a-fA-F]{3,8}).*$/gm);
    if (varLines && varLines.length > 0) {
      result.rootBlock = ':root {\n' + varLines.map(l => '  ' + l.trim()).join('\n') + '\n}';
    }
  }

  // Extract font @import URLs for mechanical typography switching
  const fontImports = [...content.matchAll(/@import\s+url\([^)]+\)[^;]*;/g)].map(m => m[0]);
  if (fontImports.length > 0) {
    result.fontImports = fontImports;
  }

  return result;
}

// Load colors for all themes at startup
const themeColors = {};
for (const t of themes) {
  const colors = parseThemeColors(t.id);
  if (colors) themeColors[t.id] = colors;
}
console.log(`Parsed colors for ${Object.keys(themeColors).length} themes`);

// --- Image generation for theme creation ---
const IMAGE_VARIATIONS = [
  'card-based layout with prominent content cards arranged in a grid or masonry pattern',
  'sidebar navigation layout with a persistent side panel and main content area',
  'split-pane layout with two distinct content zones separated by a divider',
];

async function generateThemeImages(prompt) {
  if (!OPENROUTER_KEY) throw new Error('OpenRouter API key not configured');

  const requests = IMAGE_VARIATIONS.map(async (variation, i) => {
    const fullPrompt = `UI design mockup for a web application theme: ${prompt}. Layout style: ${variation}. Clean, modern interface design with visible color palette and typography. No text labels, focus on visual design language and spatial composition.`;
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vibes.diy',
          'X-Title': 'Vibes Theme Creator',
        },
        body: JSON.stringify({
          model: 'openai/dall-e-3',
          prompt: fullPrompt,
          n: 1,
          size: '1024x1024',
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[ImageGen] Variation ${i} failed (${resp.status}): ${errText.slice(0, 200)}`);
        return null;
      }
      const data = await resp.json();
      return data.data?.[0]?.url || null;
    } catch (err) {
      console.error(`[ImageGen] Variation ${i} error:`, err.message);
      return null;
    }
  });

  return Promise.all(requests);
}

// --- Theme extraction helpers ---

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function uniqueThemeId(base) {
  if (!existsSync(join(THEME_DIR, `${base}.txt`))) return base;
  let n = 2;
  while (existsSync(join(THEME_DIR, `${base}-${n}.txt`))) n++;
  return `${base}-${n}`;
}

async function extractThemeFromImage(imageUrl, prompt, themeId, themeName) {
  // Read archive.txt as format reference
  const archivePath = join(THEME_DIR, 'archive.txt');
  let formatRef = '';
  if (existsSync(archivePath)) {
    formatRef = readFileSync(archivePath, 'utf-8').slice(0, 2000);
  }

  const extractionPrompt = `You are creating a new theme file for the Vibes design system.

Analyze the attached image and create a complete theme file based on the visual design you see.

User's theme description: "${prompt}"
Theme ID: ${themeId}
Theme Name: ${themeName}

Here is an example of the format (from archive.txt — use this EXACT structure):

---
${formatRef}
---

Tasks:
1. Write the theme file to skills/vibes/themes/${themeId}.txt with ALL these sections:
   - THEME: ${themeId}
   - NAME: ${themeName}
   - MOOD: (3-4 adjectives describing the visual mood from the image)
   - DESCRIPTION: (2-4 sentences describing the layout and feel)
   - BEST FOR: (bullet list of app types this suits)
   - NOT FOR: (bullet list of app types this doesn't suit)
   - ADAPTATION NOTES: (how to adapt for tables, charts, forms, etc.)
   - COLOR TOKENS: (use oklch() values — extract colors from the image)
   - DESIGN PRINCIPLES: (typography, spacing, borders, shadows)
   - PERSONALITY: (voice and character of the theme)
   - ANIMATIONS: (transition and hover effects)
   - SVG ELEMENTS: (decorative SVG patterns if appropriate)
   - REFERENCE CSS: (complete CSS implementing the theme)

2. Append a catalog row to skills/vibes/themes/catalog.txt.
   Insert a new row BEFORE the line that says "HOW TO CHOOSE".
   Format: | ${themeId} | ${themeName} | <mood> | <best-for summary> |

Use oklch() for ALL color values. Study the image carefully for palette, typography weight, spacing rhythm, and overall composition.`;

  return new Promise((resolve, reject) => {
    const args = [
      '-p', '-',
      '--image', imageUrl,
      '--output-format', 'json',
      '--allowedTools', 'Edit,Read,Write,Glob,Grep',
      '--no-session-persistence',
    ];

    console.log(`[ThemeExtract] Spawning claude for theme "${themeId}" (with image)...`);
    const child = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(extractionPrompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[ThemeExtract] Failed (code ${code}): ${stderr.slice(0, 300)}`);
        reject(new Error(`Theme extraction failed (exit code ${code})`));
        return;
      }
      console.log(`[ThemeExtract] Theme "${themeId}" created successfully`);
      resolve(stdout);
    });

    child.on('error', (err) => {
      console.error(`[ThemeExtract] Spawn error:`, err.message);
      reject(new Error(`Failed to start claude: ${err.message}`));
    });
  });
}

// --- Editor dependency checks ---
function runCommand(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, env: { ...process.env } }, (err, stdout, stderr) => {
        const output = ((stdout || '') + (stderr || '')).trim();
        resolve({ ok: !err, output });
      });
    } catch {
      resolve({ ok: false, output: '' });
    }
  });
}

async function checkEditorDeps() {
  const env = loadEnvFile(PROJECT_ROOT);

  // Clerk keys
  const clerkKey = env.VITE_CLERK_PUBLISHABLE_KEY || '';
  const clerkOk = validateClerkKey(clerkKey);

  // Connect URLs
  const apiUrl = env.VITE_API_URL || '';
  const cloudUrl = env.VITE_CLOUD_URL || '';
  const connectOk = !!(apiUrl && cloudUrl);

  // Wrangler auth (optional) — try npx first, then bare wrangler
  let wranglerResult = await runCommand('npx', ['wrangler', 'whoami'], 15000);
  if (!wranglerResult.ok) wranglerResult = await runCommand('wrangler', ['whoami']);
  const wranglerOk = wranglerResult.ok && !wranglerResult.output.includes('not authenticated');

  // SSH to exe.dev (optional) — exe.dev uses a custom REPL, not a shell
  // Just test if SSH connection succeeds (the REPL returns an error for unknown commands but that means SSH works)
  const sshResult = await runCommand('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', 'exe.dev', 'help'], 8000);
  // Connection succeeded if we got ANY output (even error) — failure would be timeout/refused
  const sshOk = sshResult.output.length > 0;

  return {
    clerk: {
      ok: clerkOk,
      detail: clerkOk ? `${clerkKey.slice(0, 12)}...` : 'No valid Clerk key in .env',
    },
    connect: {
      ok: connectOk,
      detail: connectOk ? apiUrl : 'No VITE_API_URL / VITE_CLOUD_URL in .env',
    },
    wrangler: {
      ok: wranglerOk,
      detail: wranglerOk ? 'Authenticated' : 'Not configured or not authenticated',
    },
    ssh: {
      ok: sshOk,
      detail: sshOk ? 'Connected' : 'Cannot reach exe.dev',
    },
  };
}

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
async function handleRequest(req, res) {
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

  // GET / → preview.html or editor.html depending on mode
  if (pathname === '/' || pathname === '/index.html') {
    const htmlFile = MODE === 'editor' ? 'editor.html' : 'preview.html';
    const htmlPath = join(PROJECT_ROOT, 'skills/vibes/templates', htmlFile);
    if (!existsSync(htmlPath)) {
      res.writeHead(404);
      return res.end(`${htmlFile} not found`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(readFileSync(htmlPath, 'utf-8'));
  }

  // GET /editor/status → dependency check (editor mode)
  if (pathname === '/editor/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const status = await checkEditorDeps();
    return res.end(JSON.stringify(status));
  }

  // GET /editor/initial-prompt → return prompt passed via --prompt flag
  if (pathname === '/editor/initial-prompt') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ prompt: INITIAL_PROMPT }));
  }

  // GET /editor/app-exists → check if app.jsx exists
  if (pathname === '/editor/app-exists') {
    const exists = existsSync(join(PROJECT_ROOT, 'app.jsx'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ exists }));
  }

  // GET /editor/apps → list saved apps from ~/.vibes/apps/
  if (pathname === '/editor/apps') {
    try {
      const apps = [];
      for (const name of readdirSync(APPS_DIR)) {
        const dir = join(APPS_DIR, name);
        const appFile = join(dir, 'app.jsx');
        if (!existsSync(appFile)) continue;
        const st = statSync(appFile);
        // Read first line to extract theme info
        const firstLine = readFileSync(appFile, 'utf-8').split('\n')[0] || '';
        const themeMatch = firstLine.match(/id:\s*"([^"]+)".*?name:\s*"([^"]+)"/);
        apps.push({
          name,
          modified: st.mtime.toISOString(),
          themeId: themeMatch ? themeMatch[1] : null,
          themeName: themeMatch ? themeMatch[2] : null,
          size: st.size,
        });
      }
      // Sort by most recently modified
      apps.sort((a, b) => new Date(b.modified) - new Date(a.modified));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(apps));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // POST /editor/apps/load?name=foo → copy saved app to PROJECT_ROOT/app.jsx
  if (pathname === '/editor/apps/load' && req.method === 'POST') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const name = params.get('name');
    if (!name) { res.writeHead(400); return res.end('Missing name'); }
    const src = join(APPS_DIR, name, 'app.jsx');
    if (!existsSync(src)) { res.writeHead(404); return res.end('App not found'); }
    copyFileSync(src, join(PROJECT_ROOT, 'app.jsx'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // POST /editor/apps/save?name=foo → save current app.jsx to ~/.vibes/apps/foo/
  if (pathname === '/editor/apps/save' && req.method === 'POST') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const name = (params.get('name') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
    if (!name) { res.writeHead(400); return res.end('Missing name'); }
    const appSrc = join(PROJECT_ROOT, 'app.jsx');
    if (!existsSync(appSrc)) { res.writeHead(404); return res.end('No app.jsx to save'); }
    const dest = join(APPS_DIR, name);
    mkdirSync(dest, { recursive: true });
    copyFileSync(appSrc, join(dest, 'app.jsx'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
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

  // GET /themes → JSON array of themes with recommendations based on app content
  if (pathname === '/themes') {
    const recommended = getRecommendedThemeIds();
    const result = themes.map(t => ({ ...t, recommended: recommended.has(t.id), colors: themeColors[t.id] || null }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  // GET /themes/has-key → check if OpenRouter API key is configured
  if (pathname === '/themes/has-key') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ hasKey: !!OPENROUTER_KEY }));
  }

  // GET /app-frame → assembled vibes template with real Fireproof
  if (pathname === '/app-frame') {
    const appPath = join(PROJECT_ROOT, 'app.jsx');
    if (!existsSync(appPath)) {
      res.writeHead(404);
      return res.end('app.jsx not found');
    }
    const appCode = readFileSync(appPath, 'utf-8');
    const assembled = assembleAppFrame(appCode);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(assembled);
  }

  // Bundle files: import map references these at root paths
  if (pathname === '/fireproof-vibes-bridge.js' || pathname === '/fireproof-clerk-bundle.js') {
    const bundlePath = join(PROJECT_ROOT, 'bundles', pathname.slice(1));
    if (existsSync(bundlePath)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(readFileSync(bundlePath));
    }
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
// pendingImages stored per-connection on ws object

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

    try {
      if (msg.type === 'chat') {
        await handleChat(ws, msg.message);
      } else if (msg.type === 'theme') {
        await handleThemeSwitch(ws, msg.themeId);
      } else if (msg.type === 'cancel') {
        cancelClaude(ws);
      } else if (msg.type === 'create_theme') {
        const prompt = String(msg.prompt || '').replace(/[\x00-\x1f]/g, '').slice(0, 500);
        if (!prompt) { ws.send(JSON.stringify({ type: 'error', message: 'Prompt is required' })); return; }
        await handleCreateTheme(ws, prompt);
      } else if (msg.type === 'pick_theme_image') {
        const prompt = String(msg.prompt || '').replace(/[\x00-\x1f]/g, '').slice(0, 500);
        await handlePickThemeImage(ws, msg.index, prompt);
      } else if (msg.type === 'generate') {
        await handleGenerate(ws, msg.prompt, msg.themeId);
      } else if (msg.type === 'deploy') {
        await handleDeploy(ws, msg.target, msg.name);
      } else if (msg.type === 'save_app') {
        const name = (msg.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
        if (!name) { ws.send(JSON.stringify({ type: 'error', message: 'App name is required' })); return; }
        const appSrc = join(PROJECT_ROOT, 'app.jsx');
        if (!existsSync(appSrc)) { ws.send(JSON.stringify({ type: 'error', message: 'No app.jsx to save' })); return; }
        const dest = join(APPS_DIR, name);
        mkdirSync(dest, { recursive: true });
        copyFileSync(appSrc, join(dest, 'app.jsx'));
        ws.send(JSON.stringify({ type: 'app_saved', name }));
        console.log(`[Save] Saved app to ${dest}`);
      }
    } catch (err) {
      console.error('[WS] Handler error:', err);
      try {
        ws.send(JSON.stringify({ type: 'error', message: `Internal error: ${err.message}` }));
      } catch { /* ws may be closed */ }
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    // Kill any active Claude process when the client disconnects
    if (activeClaude) {
      console.log('[WS] Killing orphaned Claude process');
      activeClaude.kill('SIGKILL');
      activeClaude = null;
    }
  });
});

// --- Claude Code Bridge ---

function cancelClaude(ws) {
  if (!activeClaude) {
    ws.send(JSON.stringify({ type: 'error', message: 'No request in progress.' }));
    return;
  }
  console.log('[Claude] Cancelled by user');
  activeClaude.kill('SIGKILL');
  activeClaude = null;
  ws.send(JSON.stringify({ type: 'cancelled' }));
}

async function runClaude(ws, prompt, opts = {}) {
  if (activeClaude) {
    ws.send(JSON.stringify({ type: 'error', message: 'Another request is in progress. Please wait.' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 0, stage: 'Starting Claude...', elapsed: 0 }));

  return new Promise((resolve) => {
    const tools = opts.tools || 'Edit,Read,Write,Glob,Grep';
    // Use stdin piping to avoid OS arg length limits on large prompts
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--allowedTools', tools,
      '--no-session-persistence',
      '-p', '-',
    ];
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));

    console.log(`[Claude] Spawning (prompt: ${(prompt.length / 1024).toFixed(1)}KB)...`);
    const child = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeClaude = child;

    // Pipe prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();

    let buffer = '';
    let stderr = '';
    let resultText = '';
    let toolsUsed = 0;
    let hasEdited = false;
    const startTime = Date.now();

    function getElapsed() {
      return Math.round((Date.now() - startTime) / 1000);
    }

    // Smooth progress: rises quickly at first, slows down approaching 90%
    // Tool events bump it up; edit/write jumps to 85%+
    let baseProgress = 0;

    function calcProgress() {
      const elapsed = getElapsed();

      // Time-based smooth curve: approaches 80% over ~120s
      // Formula: 80 * (1 - e^(-elapsed/40))
      const timePct = Math.round(80 * (1 - Math.exp(-elapsed / 40)));

      // Tool-based bumps
      const toolPct = hasEdited ? 85 : toolsUsed >= 3 ? 75 : toolsUsed >= 1 ? 50 : 0;

      // Use whichever is higher
      baseProgress = Math.max(baseProgress, timePct, toolPct);
      const progress = Math.min(baseProgress, 95); // never hit 100 until done

      // Stage label
      const stage = hasEdited ? 'Finishing up...' :
                    toolsUsed >= 3 ? 'Writing changes...' :
                    toolsUsed >= 1 ? 'Reading & analyzing...' :
                    elapsed > 10 ? 'Thinking about design...' :
                    elapsed > 3 ? 'Loading context...' : 'Starting Claude...';

      return { progress, stage };
    }

    function sendProgress(overrides) {
      const { progress, stage } = calcProgress();
      ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress, stage, elapsed: getElapsed(), ...overrides }));
    }

    // Parse streaming JSON lines
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'tool_use') {
                toolsUsed++;
                const toolName = block.name || '';
                if (toolName === 'Edit' || toolName === 'Write') hasEdited = true;

                // Extract a short summary of what the tool is operating on
                const input = block.input || {};
                const inputSummary =
                  (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') ? (input.file_path || '') :
                  (toolName === 'Glob') ? (input.pattern || '') :
                  (toolName === 'Grep') ? (input.pattern || '') :
                  (toolName === 'Bash') ? (input.command || '').slice(0, 80) :
                  '';

                const toolLabel = toolName === 'Read' ? 'Reading files...' :
                                  toolName === 'Glob' ? 'Searching files...' :
                                  toolName === 'Grep' ? 'Searching code...' :
                                  toolName === 'Edit' ? 'Editing app.jsx...' :
                                  toolName === 'Write' ? 'Writing app.jsx...' : null;

                const elapsed = getElapsed();
                sendProgress(toolLabel ? { stage: toolLabel } : {});
                console.log(`[Claude] Tool: ${toolName}${inputSummary ? ` → ${inputSummary}` : ''} (${elapsed}s)`);

                // Forward tool detail to client for debug panel
                ws.send(JSON.stringify({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed }));
              }
              if (block.type === 'text' && block.text) {
                resultText = block.text;
              }
            }
          } else if (event.type === 'result') {
            resultText = event.result || resultText || 'Done.';
          } else {
            // Log unrecognized event types for diagnostics
            console.log(`[Claude] Event: ${event.type} (${getElapsed()}s)`);
          }
        } catch {
          // ignore parse errors on partial lines
        }
      }
    });

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Send elapsed time updates every second
    const progressInterval = setInterval(() => {
      if (!activeClaude) return;
      sendProgress();
    }, 1000);

    child.on('close', (code) => {
      clearInterval(progressInterval);
      const wasActive = activeClaude === child;
      activeClaude = null;

      // If cancelled, the cancel handler already sent the message
      if (!wasActive) { resolve(null); return; }

      if (code !== 0) {
        console.error(`[Claude] Exit code ${code}, stderr (${stderr.length} bytes):\n${stderr}`);
        // Show a useful error message — max_turns exceeded is not a real failure
        const isMaxTurns = stderr.includes('max_turns') || stderr.includes('maxTurns');
        if (isMaxTurns && hasEdited) {
          // Claude ran out of turns but DID edit/write — treat as success
          console.log('[Claude] Hit max_turns but had edits — treating as success');
          ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: getElapsed() }));
          ws.send(JSON.stringify({ type: 'app_updated' }));
          resolve(resultText);
          return;
        }
        const errMsg = isMaxTurns ? 'Claude ran out of turns before completing. Try again.' :
          stderr.slice(0, 500) || `Claude exited with code ${code}`;
        ws.send(JSON.stringify({ type: 'error', message: errMsg }));
        resolve(null);
        return;
      }

      ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: getElapsed() }));
      if (!opts.skipChat) {
        ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: resultText || 'Done.' }));
      }
      ws.send(JSON.stringify({ type: 'app_updated' }));
      console.log(`[Claude] Completed in ${getElapsed()}s (${toolsUsed} tools used)`);
      if (stderr.trim()) {
        console.log(`[Claude] stderr (${stderr.length} bytes, truncated):\n${stderr.slice(0, 1000)}`);
      }
      resolve(resultText);
    });

    child.on('error', (err) => {
      clearInterval(progressInterval);
      activeClaude = null;
      console.error('[Claude] Spawn error:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: `Failed to start claude: ${err.message}` }));
      resolve(null);
    });
  });
}

// Extract Fireproof data schema from app.jsx (document types, query filters)
function extractDataSchema(appCode) {
  if (!appCode) return '';
  const schemas = [];

  // Find useLiveQuery calls with type filters
  const queryMatches = appCode.matchAll(/useLiveQuery\s*\(\s*(['"`])([^'"`]*)\1[^)]*(?:,\s*\{[^}]*type:\s*(['"`])([^'"`]*)\3)?/g);
  for (const m of queryMatches) {
    if (m[4]) schemas.push(`  - useLiveQuery("${m[2]}") filters by type: "${m[4]}"`);
    else schemas.push(`  - useLiveQuery("${m[2]}")`);
  }

  // Find database.put calls with type fields
  const putMatches = appCode.matchAll(/(?:database|db)\.put\s*\(\s*\{[^}]*type:\s*(['"`])([^'"`]*)\1/g);
  for (const m of putMatches) {
    schemas.push(`  - database.put() creates documents with type: "${m[2]}"`);
  }

  // Find doc.type comparisons and string literals used as types
  const typeMatches = appCode.matchAll(/(?:doc|item|row|entry|record)\.type\s*===?\s*(['"`])([^'"`]*)\1/g);
  for (const m of typeMatches) {
    schemas.push(`  - Documents filtered by type: "${m[2]}"`);
  }

  // Deduplicate
  const unique = [...new Set(schemas)];
  if (unique.length === 0) return '';
  return `\nDATA SCHEMA (these document types have user data in IndexedDB — do NOT rename or change them):\n${unique.join('\n')}\n`;
}

async function handleChat(ws, message) {
  const prompt = `The user is iterating on a React app in app.jsx. Read app.jsx first, then Edit it.

User says: "${message}"

RULES:
- Read app.jsx, then Edit ONLY what the user asked for
- ADD to the existing app — never rewrite from scratch
- Preserve all components, hooks, state, data models, __VIBES_THEMES__, useVibesTheme()
- Do NOT add imports, do NOT use TypeScript, keep export default App
- Never change Fireproof document types or query filters`;

  await runClaude(ws, prompt, { tools: 'Edit,Read', maxTurns: 8 });
}

async function handleThemeSwitch(ws, themeId) {
  const txtFile = join(THEME_DIR, `${themeId}.txt`);
  const mdFile = join(THEME_DIR, `${themeId}.md`);
  let themeContent = '';
  if (existsSync(txtFile)) themeContent = readFileSync(txtFile, 'utf-8');
  else if (existsSync(mdFile)) themeContent = readFileSync(mdFile, 'utf-8');

  const themeMeta = themes.find(t => t.id === themeId);
  const themeName = themeMeta ? themeMeta.name : themeId;

  const appJsxPath = join(PROJECT_ROOT, 'app.jsx');
  if (!existsSync(appJsxPath)) {
    ws.send(JSON.stringify({ type: 'error', message: 'No app.jsx found.' }));
    return;
  }

  const appCode = readFileSync(appJsxPath, 'utf-8');
  const colors = parseThemeColors(themeId);

  // Check for theme section markers — determines multi-pass vs legacy
  if (hasThemeMarkers(appCode)) {
    await handleThemeSwitchMultiPass(ws, themeId, themeName, themeContent, appCode, appJsxPath, colors);
  } else {
    await handleThemeSwitchLegacy(ws, themeId, themeName, themeContent, colors);
  }
}

// Replace __VIBES_THEMES__ array and useVibesTheme default in app code.
// Uses function replacements to avoid $ backreference issues in theme names.
// Matches across newlines ([\s\S]) in case the array is formatted multi-line.
function updateThemeMeta(code, themeId, themeName) {
  let result = code.replace(
    /window\.__VIBES_THEMES__\s*=\s*\[[\s\S]*?\]/,
    () => `window.__VIBES_THEMES__ = [{ id: "${themeId}", name: "${themeName}" }]`
  );
  result = result.replace(
    /localStorage\.getItem\("vibes-theme"\)\s*\|\|\s*"[^"]*"/,
    () => `localStorage.getItem("vibes-theme") || "${themeId}"`
  );
  return result;
}

// Multi-pass theme switch: instant tokens/typography (Pass 1) + Claude creative (Pass 2)
async function handleThemeSwitchMultiPass(ws, themeId, themeName, themeContent, appCode, appJsxPath, colors) {
  console.log(`[ThemeSwitch] Multi-pass for "${themeName}" (${themeId})`);

  // === Pass 1: Mechanical token + typography replacement (instant) ===
  let updatedCode = appCode;

  // Replace tokens section with theme's :root block
  if (colors?.rootBlock) {
    updatedCode = replaceThemeSection(updatedCode, 'tokens', colors.rootBlock);
    console.log(`[ThemeSwitch] Pass 1: replaced tokens (${colors.rootBlock.split('\n').length} lines)`);
  }

  // Replace typography section with theme's font imports
  if (colors?.fontImports?.length > 0) {
    updatedCode = replaceThemeSection(updatedCode, 'typography', colors.fontImports.join('\n'));
    console.log(`[ThemeSwitch] Pass 1: replaced typography (${colors.fontImports.length} fonts)`);
  }

  // Update __VIBES_THEMES__ and useVibesTheme default
  updatedCode = updateThemeMeta(updatedCode, themeId, themeName);

  // Write Pass 1 result
  createBackup(appJsxPath);
  writeFileSync(appJsxPath, updatedCode, 'utf-8');

  // Notify client: colors/fonts are live, send rootBlock for instant iframe injection
  ws.send(JSON.stringify({
    type: 'theme_pass1_complete',
    themeId,
    themeName,
    rootCss: colors?.rootBlock || null,
    fontImports: colors?.fontImports || []
  }));
  console.log(`[ThemeSwitch] Pass 1 complete — tokens + typography applied`);

  // === Pass 2: Claude creative restyle of surfaces, motion, decoration ===
  ws.send(JSON.stringify({
    type: 'status',
    status: 'thinking',
    progress: 40,
    stage: `Enhancing ${themeName} surfaces, motion, decoration...`,
    elapsed: 0
  }));

  // Snapshot non-theme content before Claude edits (for validation)
  const pass1Code = readFileSync(appJsxPath, 'utf-8');
  const beforeNonTheme = extractNonThemeSections(pass1Code);
  // Pass 2 sends 6KB of theme content (vs 4KB in handleGenerate) — Claude needs more
  // personality detail for creative sections (surfaces, motion, decoration).
  // App code is inlined to eliminate a Read tool round-trip (~30s saved).

  const prompt = `Restyle ONLY the marked theme sections in app.jsx for the "${themeName}" theme.

=== CURRENT app.jsx ===

\`\`\`jsx
${pass1Code}
\`\`\`

=== WHAT TO EDIT ===

You MUST only edit content between these marker pairs in app.jsx:
- \`/* @theme:surfaces */\` ... \`/* @theme:surfaces:end */\` — CSS classes for shadows, borders, backgrounds, glass effects
- \`/* @theme:motion */\` ... \`/* @theme:motion:end */\` — @keyframes and animation definitions
- \`{/* @theme:decoration */}\` ... \`{/* @theme:decoration:end */}\` — SVG elements and atmospheric backgrounds

=== THEME PERSONALITY ===

${themeContent.slice(0, 6000)}

=== RULES ===

- Replace the content BETWEEN each marker pair. Keep the markers themselves.
- Match the theme's personality: shadows, glass effects, gradients, animations, SVG decorations.
- Do NOT modify anything outside the markers — no layout, no logic, no tokens, no typography.
- If you need to change anything outside a marker, STOP and explain why instead of editing.
- No import statements, no TypeScript, keep export default App.
${extractDataSchema(pass1Code)}`;

  console.log(`[ThemeSwitch] Pass 2: Claude creative restyle, prompt: ${(prompt.length / 1024).toFixed(1)}KB`);
  await runClaude(ws, prompt, { skipChat: true, tools: 'Edit', maxTurns: 5 });

  // === Post-edit validation (Layer 2 guardrail) ===
  const afterCode = readFileSync(appJsxPath, 'utf-8');
  const afterNonTheme = extractNonThemeSections(afterCode);

  if (beforeNonTheme !== afterNonTheme) {
    const charDiff = afterNonTheme.length - beforeNonTheme.length;
    console.log(`[ThemeSwitch] GUARDRAIL: Claude modified non-theme content (${charDiff >= 0 ? '+' : ''}${charDiff} chars) — restoring backup`);
    const restored = restoreFromBackup(appJsxPath);
    if (restored.success) {
      // Re-apply Pass 1 changes on top of restored file
      let restoredCode = readFileSync(appJsxPath, 'utf-8');
      if (colors?.rootBlock) restoredCode = replaceThemeSection(restoredCode, 'tokens', colors.rootBlock);
      if (colors?.fontImports?.length > 0) restoredCode = replaceThemeSection(restoredCode, 'typography', colors.fontImports.join('\n'));
      restoredCode = updateThemeMeta(restoredCode, themeId, themeName);
      writeFileSync(appJsxPath, restoredCode, 'utf-8');
    }
    ws.send(JSON.stringify({
      type: 'theme_validation_failed',
      message: `Theme "${themeName}" creative pass modified app logic — reverted to safe version with new colors/fonts only.`
    }));
  } else {
    console.log(`[ThemeSwitch] Pass 2 validated — non-theme content unchanged`);
  }
}

// Legacy theme switch: full-file Claude restyle (no markers)
async function handleThemeSwitchLegacy(ws, themeId, themeName, themeContent, colors) {
  let rootCss = colors?.rootBlock || '';
  if (!rootCss) {
    const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
    if (rootMatch) rootCss = rootMatch[0];
  }

  // Inline app.jsx to eliminate a Read tool round-trip (~30s saved)
  const appJsxPath = join(PROJECT_ROOT, 'app.jsx');
  const appCode = readFileSync(appJsxPath, 'utf-8');

  const prompt = `Restyle app.jsx to the "${themeName}" (${themeId}) theme.

=== CURRENT app.jsx ===

\`\`\`jsx
${appCode}
\`\`\`

=== MANDATORY CSS CHANGES ===

Replace the ENTIRE :root block in the <style> tag with this EXACT CSS:

\`\`\`css
${rootCss || `/* Build :root with oklch colors matching "${themeName}" */`}
\`\`\`

Replace __VIBES_THEMES__ with: [{ id: "${themeId}", name: "${themeName}" }]
Replace useVibesTheme default with: "${themeId}"

=== THEME PERSONALITY ===

Study this theme to update backgrounds, shadows, borders, fonts, animations, SVGs:

${themeContent.slice(0, 8000)}

=== RULES ===

CHANGE (visual only):
- :root CSS variables → use the EXACT block above
- Backgrounds, shadows, borders, fonts → match theme's design principles
- Animations, SVG elements → match theme's mood
- __VIBES_THEMES__ and useVibesTheme default → "${themeId}"

KEEP UNCHANGED:
- All components, hooks, functions, state, data models, layout structure
- All Fireproof database calls, document types, query filters
- No import statements, no TypeScript, keep export default App`;

  console.log(`[ThemeSwitch] Legacy mode for "${themeName}" (${themeId}), prompt: ${(prompt.length / 1024).toFixed(1)}KB`);
  await runClaude(ws, prompt, { skipChat: true, tools: 'Edit', maxTurns: 8 });
}

// --- Create Theme Handlers ---

// --- Editor: Auto-select theme based on user prompt keywords ---
function autoSelectTheme(userPrompt) {
  const catalogPath = join(PROJECT_ROOT, 'skills/vibes/themes/catalog.txt');
  if (!existsSync(catalogPath)) return 'default';

  const catalog = readFileSync(catalogPath, 'utf-8');
  const promptLower = userPrompt.toLowerCase();

  // Parse signal sections from catalog
  const signalRegex = /^(\w+)\s+signals:\s*([\s\S]*?)(?=\n\n|\n\w+\s+signals:)/gm;
  const scores = {};
  let match;
  while ((match = signalRegex.exec(catalog)) !== null) {
    const themeId = match[1];
    const keywords = match[2].match(/"([^"]+)"/g)?.map(k => k.replace(/"/g, '').toLowerCase()) || [];
    let score = 0;
    for (const kw of keywords) {
      if (promptLower.includes(kw)) score += kw.split(' ').length; // multi-word matches score higher
    }
    if (score > 0) scores[themeId] = score;
  }

  // Return highest-scoring theme, or 'default'
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : 'default';
}

// --- Editor: Generate app from scratch ---
async function handleGenerate(ws, userPrompt, themeId) {
  if (!userPrompt) {
    ws.send(JSON.stringify({ type: 'error', message: 'Please describe what you want to build.' }));
    return;
  }

  console.log(`[Generate] ▸ START prompt="${userPrompt.slice(0, 60)}" themeId=${themeId || '(auto)'}`);

  // Resolve common file paths
  const catalogPath = join(PROJECT_ROOT, 'skills/vibes/themes/catalog.txt');
  const stylePath = join(PROJECT_ROOT, 'skills/vibes/defaults/style-prompt.txt');

  // Inline style-prompt.txt to avoid a Read tool round-trip (~30s saved)
  let styleGuide = '';
  try {
    styleGuide = readFileSync(stylePath, 'utf-8');
    console.log(`[Generate]   ✓ styleGuide: ${(styleGuide.length / 1024).toFixed(1)}KB (inlined)`);
  } catch (e) {
    console.log(`[Generate]   ✗ Could not read style-prompt.txt: ${e.message}`);
  }

  // Two modes: Auto (Claude picks theme from catalog) vs Manual (theme pre-selected)
  const isAuto = !themeId;

  if (isAuto) {
    // Server pre-selects for the theme_selected message, but Claude will read the file
    themeId = autoSelectTheme(userPrompt);
    console.log(`[Generate]   ✓ autoSelectTheme => "${themeId}"`);
  } else {
    console.log(`[Generate]   ✓ user selected theme: "${themeId}"`);
  }

  const themeName = (themes.find(t => t.id === themeId) || {}).name || themeId;
  const txtFile = join(THEME_DIR, `${themeId}.txt`);
  const mdFile = join(THEME_DIR, `${themeId}.md`);
  const themeFilePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : '';

  // Read theme content — inject directly so Claude can't ignore it
  let themeContent = '';
  if (themeFilePath) {
    themeContent = readFileSync(themeFilePath, 'utf-8');
    console.log(`[Generate]   ✓ themeFile: ${(themeContent.length / 1024).toFixed(1)}KB — "${themeName}"`);
  } else {
    console.log(`[Generate]   ✗ NO THEME FILE for "${themeId}"`);
  }

  // Extract the :root CSS block — this is the EXACT code Claude must use
  // Extract the :root CSS block — the exact code Claude must use in <style>
  let rootCss = '';
  const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
  if (rootMatch) {
    rootCss = rootMatch[0];
  } else {
    // Some themes list variables without a :root block — build one from --var: oklch(...) lines
    const varLines = themeContent.match(/^\s*--[\w-]+:\s*oklch\([^)]+\).*$/gm);
    if (varLines && varLines.length > 0) {
      rootCss = ':root {\n' + varLines.map(l => '  ' + l.trim()).join('\n') + '\n}';
    }
  }
  console.log(`[Generate]   rootCss: ${rootCss ? rootCss.split('\n').length + ' lines' : 'MISSING'}`);

  // Trim theme content: keep personality sections, drop the huge REFERENCE STYLES CSS (~12KB)
  // The :root CSS is already extracted above, so Claude doesn't need the full CSS examples
  let themeEssentials = themeContent
    .replace(/REFERENCE STYLES[\s\S]*?(?=\n[A-Z]{2,}[A-Z ]*[:|\n]|$)/, '')
    .replace(/```css[\s\S]*?```/g, '') // Remove remaining CSS code blocks
    .trim();
  // Cap at 4KB to keep prompt manageable
  if (themeEssentials.length > 4000) themeEssentials = themeEssentials.slice(0, 4000) + '\n...';

  const prompt = `You are an expert React app designer. Generate a beautiful, creative app.

USER REQUEST: "${userPrompt}"

=== MANDATORY THEME: "${themeName}" (id: "${themeId}") ===

Your app.jsx MUST start with these EXACT lines (copy-paste, do not modify):

\`\`\`jsx
window.__VIBES_THEMES__ = [{ id: "${themeId}", name: "${themeName}" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "${themeId}");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}
\`\`\`

Your <style> tag MUST include these EXACT CSS custom properties from the "${themeName}" theme:

\`\`\`css
${rootCss || `/* No :root block found — create one with warm oklch colors matching "${themeName}" */`}
\`\`\`

=== THEME PERSONALITY ===

${themeEssentials || 'Bold neo-brutalist: strong typography, hard shadows, playful hover effects.'}

=== DESIGN GUIDANCE ===

${styleGuide}

=== DESIGN REASONING ===

Think in a <design> block:
- How does "${themeName}" personality shape the visual choices?
- What custom SVG illustrations fit this app?
- What animations and effects match the theme mood? (Canvas particles, animated SVG, scroll reveals, card tilt, cursor glow)

=== WRITE app.jsx ===

Write the complete app to app.jsx. Rules:
- FIRST: the exact __VIBES_THEMES__ + useVibesTheme code shown above
- THEN: <style> tag with theme-sensitive CSS organized into marked sections (see below), plus component styles
- Add rich visual effects: Canvas 2D backgrounds, animated SVG illustrations, CSS @property animations, hover effects
- JSX with React hooks (useState, useEffect, useRef, useCallback, useMemo)
- useFireproofClerk("db-name") for database — returns { database, useLiveQuery, useDocument }
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Responsive (mobile-first with Tailwind). className="btn" for buttons, "grid-background" on root

=== THEME SECTION MARKERS ===

Organize ALL theme-sensitive CSS and JSX into marked sections. This enables fast theme switching.

In your <style> tag, wrap theme-sensitive CSS in comment markers:

\`\`\`css
/* @theme:tokens */
:root { --comp-bg: ...; --comp-text: ...; /* all color variables */ }
/* @theme:tokens:end */

/* @theme:typography */
@import url('...');  /* Google Fonts or other font imports */
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: ...; } /* shadows, borders, gradients, glass effects */
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { ... } /* all @keyframes and animation definitions */
/* @theme:motion:end */

/* Non-theme layout styles go OUTSIDE markers */
.audio-controls { display: grid; }
\`\`\`

In your JSX, wrap decorative elements:

\`\`\`jsx
{/* @theme:decoration */}
<svg className="atmospheric-bg">...</svg>
<div className="scan-line" />
{/* @theme:decoration:end */}
\`\`\`

Rules:
- EVERY :root block must be inside @theme:tokens markers
- EVERY @import font URL must be inside @theme:typography markers
- EVERY @keyframes must be inside @theme:motion markers
- Decorative SVGs and atmospheric elements go in @theme:decoration
- App layout, structure, and logic stay OUTSIDE all markers

DATABASE: useDocument({text:"",type:"item"}), useLiveQuery("type",{key:"item"}), database.put/del`;

  // Tell the client which theme was selected
  ws.send(JSON.stringify({ type: 'theme_selected', themeId, themeName }));

  console.log(`[Generate] Starting — theme: ${themeId} (${themeName}), prompt: ${(prompt.length / 1024).toFixed(1)}KB`);
  await runClaude(ws, prompt, { skipChat: true, tools: 'Write', maxTurns: 5 });
}

// --- Editor: Deploy assembled app ---
async function handleDeploy(ws, target, name) {
  if (!target || (target !== 'cloudflare' && target !== 'exe')) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid deploy target. Use "cloudflare" or "exe".' }));
    return;
  }

  // Sanitize name: lowercase, alphanumeric + hyphens only
  const appName = (name || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
  if (!appName) {
    ws.send(JSON.stringify({ type: 'error', message: 'App name is required for deployment.' }));
    return;
  }

  const startTime = Date.now();
  function getElapsed() { return Math.round((Date.now() - startTime) / 1000); }

  // First assemble
  ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 5, stage: 'Assembling app...', elapsed: 0 }));

  const appJsxPath = join(PROJECT_ROOT, 'app.jsx');
  const indexHtmlPath = join(PROJECT_ROOT, 'index.html');

  const assembleResult = await new Promise((resolve) => {
    const child = spawn('node', [
      join(PROJECT_ROOT, 'scripts/assemble.js'),
      appJsxPath,
      indexHtmlPath,
    ], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ ok: false, stdout: '', stderr: err.message });
    });
  });

  if (!assembleResult.ok) {
    ws.send(JSON.stringify({ type: 'error', message: `Assembly failed: ${assembleResult.stderr.slice(0, 300)}` }));
    return;
  }

  // Patch assembled HTML so the app's background shows through the template frame
  try {
    const appCode = readFileSync(appJsxPath, 'utf8');
    let html = readFileSync(indexHtmlPath, 'utf8');

    // Extract the app's --color-background value (literal color, not a var reference)
    const rootMatch = appCode.match(/:root\s*\{([^}]+)\}/);
    let bgColor = '';
    if (rootMatch) {
      const bgMatch = rootMatch[1].match(/--color-background\s*:\s*([^;]+)/);
      if (bgMatch) bgColor = bgMatch[1].trim();
    }
    // Fallback: check for body { background: <value> } if no --color-background
    if (!bgColor) {
      const bodyBgMatch = appCode.match(/body\s*\{[^}]*background\s*:\s*([^;]+)/);
      if (bodyBgMatch) bgColor = bodyBgMatch[1].trim();
    }

    const bg = bgColor || 'inherit';

    // Two patches:
    // 1. In <head>: body::before gets the app's background color for the frame
    // 2. Before </body>: a <style> that overrides HiddenMenuWrapper's white bg
    //    and makes the app root div show the correct background.
    //    Placed last so it wins over all dynamically injected styles.
    const headPatch = `<style>
      #container { padding: 10px !important; }
      body::before { background-color: ${bg} !important; }
    </style>`;
    html = html.replace('</head>', headPatch + '\n</head>');

    const bodyPatch = `<style>
      div[style*="z-index: 10"][style*="position: fixed"] { background: ${bg} !important; }
    </style>`;
    html = html.replace('</body>', bodyPatch + '\n</body>');

    writeFileSync(indexHtmlPath, html);
    console.log('[Deploy] Patched body::before background' + (bgColor ? `: ${bgColor}` : ''));
  } catch (e) {
    console.error('[Deploy] Patch failed:', e.message);
  }

  ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 30, stage: 'Deploying...', elapsed: getElapsed() }));

  // Deploy with correct flags per script
  const deployScript = target === 'cloudflare'
    ? join(PROJECT_ROOT, 'scripts/deploy-cloudflare.js')
    : join(PROJECT_ROOT, 'scripts/deploy-exe.js');

  const deployArgs = target === 'cloudflare'
    ? ['--name', appName, '--file', indexHtmlPath]
    : ['--name', appName, '--file', indexHtmlPath, '--skip-registry'];

  const deployResult = await new Promise((resolve) => {
    const child = spawn('node', [deployScript, ...deployArgs], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const progressInterval = setInterval(() => {
      const elapsed = getElapsed();
      const progress = Math.min(30 + Math.round(60 * (1 - Math.exp(-elapsed / 30))), 90);
      ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress, stage: 'Deploying...', elapsed }));
    }, 1000);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearInterval(progressInterval);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      clearInterval(progressInterval);
      resolve({ ok: false, stdout: '', stderr: err.message });
    });
  });

  if (!deployResult.ok) {
    ws.send(JSON.stringify({ type: 'error', message: `Deploy failed: ${deployResult.stderr.slice(0, 300)}` }));
    return;
  }

  // Extract URL from deploy output
  let deployUrl = '';
  const urlMatch = deployResult.stdout.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) deployUrl = urlMatch[1];

  ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: getElapsed() }));
  ws.send(JSON.stringify({ type: 'deploy_complete', url: deployUrl }));
  ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: deployUrl ? `Deployed to ${deployUrl}` : 'Deployment complete!' }));

  console.log(`[Deploy] ${target} deploy "${appName}" complete${deployUrl ? `: ${deployUrl}` : ''}`);
}

async function handleCreateTheme(ws, prompt) {
  if (!OPENROUTER_KEY) {
    ws.send(JSON.stringify({ type: 'error', message: 'OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env to enable theme creation.' }));
    return;
  }

  try {
    ws.send(JSON.stringify({ type: 'status', status: 'generating_images', stage: 'Generating theme images...', progress: 0, elapsed: 0 }));
    const images = await generateThemeImages(prompt);
    ws.pendingImages = images;

    const validCount = images.filter(Boolean).length;
    if (validCount === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'All image generations failed. Check your OpenRouter API key and balance.' }));
      return;
    }

    ws.send(JSON.stringify({ type: 'theme_images', images }));
    console.log(`[CreateTheme] Generated ${validCount}/3 images for "${prompt}"`);
  } catch (err) {
    console.error('[CreateTheme] Error:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: `Image generation failed: ${err.message}` }));
  }
}

async function handlePickThemeImage(ws, index, prompt) {
  if (!prompt) {
    ws.send(JSON.stringify({ type: 'error', message: 'Prompt is required' }));
    return;
  }

  const imageUrl = (ws.pendingImages || [])[index];
  if (!imageUrl) {
    ws.send(JSON.stringify({ type: 'error', message: `No image at index ${index}` }));
    return;
  }

  const themeId = uniqueThemeId(slugify(prompt));
  // Title-case the prompt for themeName
  const themeName = prompt
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  try {
    ws.send(JSON.stringify({ type: 'status', status: 'extracting_theme', stage: 'Extracting theme from image...', themeId, themeName, progress: 0, elapsed: 0 }));
    console.log(`[CreateTheme] Extracting theme "${themeId}" from image ${index}...`);

    await extractThemeFromImage(imageUrl, prompt, themeId, themeName);

    // Verify the theme file was actually created
    const themeFilePath = join(THEME_DIR, `${themeId}.txt`);
    if (!existsSync(themeFilePath)) {
      throw new Error('Theme file was not created — Claude may have encountered an issue');
    }

    // Reload themes from catalog
    if (existsSync(catalogPath)) {
      themes = parseThemeCatalog(readFileSync(catalogPath, 'utf-8'));
      console.log(`[CreateTheme] Reloaded ${themes.length} themes from catalog`);
    }

    // Reload colors for new theme
    const newColors = parseThemeColors(themeId);
    if (newColors) themeColors[themeId] = newColors;

    ws.send(JSON.stringify({ type: 'theme_created', themeId, themeName }));
    console.log(`[CreateTheme] Theme "${themeId}" (${themeName}) created and loaded`);
  } catch (err) {
    console.error('[CreateTheme] Extraction error:', err.message);
    ws.send(JSON.stringify({ type: 'error', message: `Theme extraction failed: ${err.message}` }));
  }
}

// --- App Frame Assembler ---
// Assembles app.jsx into the real vibes template with Fireproof bundle + Clerk auth

function assembleAppFrame(appCode) {
  const templatePath = TEMPLATES.vibesBasic;
  if (!existsSync(templatePath)) {
    return `<html><body><h1>Template not found</h1><p>${templatePath}</p></body></html>`;
  }

  let template = readFileSync(templatePath, 'utf-8');

  // Strip imports/exports from app code for template injection
  const strippedCode = stripForTemplate(appCode);

  // Replace app code placeholder
  if (!template.includes(APP_PLACEHOLDER)) {
    return `<html><body><h1>Template missing placeholder</h1><p>${APP_PLACEHOLDER}</p></body></html>`;
  }
  template = template.replace(APP_PLACEHOLDER, strippedCode);

  // Populate Connect config from .env
  const envVars = loadEnvFile(PROJECT_ROOT);
  template = populateConnectConfig(template, envVars);

  // Warn if Connect URLs are missing — sync will silently fail without them
  if (!envVars.VITE_API_URL) {
    console.warn('[preview] \u26a0 VITE_API_URL missing from .env \u2014 sync will not work');
  }
  if (!envVars.VITE_CLOUD_URL) {
    console.warn('[preview] \u26a0 VITE_CLOUD_URL missing from .env \u2014 sync will not work');
  }

  return template;
}

// --- Start ---
server.listen(PORT, () => {
  const modeLabel = MODE === 'editor' ? 'Editor' : 'Preview';
  console.log(`
┌─────────────────────────────────────────────────┐
│  Vibes ${modeLabel.padEnd(7)} Server                       │
├─────────────────────────────────────────────────┤
│                                                 │
│  Open:     http://localhost:${PORT}                │
│  Mode:     ${modeLabel.padEnd(37)}│
│  Themes:   ${String(themes.length).padEnd(3)} loaded                       │
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
