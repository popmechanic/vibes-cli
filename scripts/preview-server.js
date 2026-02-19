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
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { parseThemeCatalog } from './lib/parse-theme-catalog.js';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3333', 10);

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
  return count >= 2 ? result : null;
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
      env: { ...process.env },
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

  // GET /app-frame → the inner iframe HTML (mocked Fireproof + Babel)
  if (pathname === '/app-frame') {
    const appPath = join(PROJECT_ROOT, 'app.jsx');
    let appCode = existsSync(appPath) ? readFileSync(appPath, 'utf-8') : '// no app.jsx found';
    // Strip import/export statements — Babel standalone can't handle ES modules
    appCode = appCode
      .replace(/^export\s+default\s+/gm, '')
      .replace(/^export\s+/gm, '')
      .replace(/^import\s+.*$/gm, '// [import stripped for preview]');
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
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
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
    // Use stdin piping to avoid OS arg length limits on large prompts
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--allowedTools', 'Edit,Read,Write,Glob,Grep',
      '--no-session-persistence',
      '-p', '-',
    ];

    console.log(`[Claude] Spawning (prompt: ${(prompt.length / 1024).toFixed(1)}KB)...`);
    const child = spawn('claude', args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
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

                const toolLabel = toolName === 'Read' ? 'Reading files...' :
                                  toolName === 'Glob' ? 'Searching files...' :
                                  toolName === 'Grep' ? 'Searching code...' :
                                  toolName === 'Edit' ? 'Editing app.jsx...' :
                                  toolName === 'Write' ? 'Writing app.jsx...' : null;

                sendProgress(toolLabel ? { stage: toolLabel } : {});
                console.log(`[Claude] Tool: ${toolName} (${getElapsed()}s)`);
              }
              if (block.type === 'text' && block.text) {
                resultText = block.text;
              }
            }
          }

          if (event.type === 'result') {
            resultText = event.result || resultText || 'Done.';
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
        console.error('[Claude] Error:', stderr.slice(0, 300));
        ws.send(JSON.stringify({ type: 'error', message: `Claude exited with code ${code}: ${stderr.slice(0, 200)}` }));
        resolve(null);
        return;
      }

      ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: getElapsed() }));
      if (!opts.skipChat) {
        ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: resultText || 'Done.' }));
      }
      ws.send(JSON.stringify({ type: 'app_updated' }));
      console.log(`[Claude] Completed in ${getElapsed()}s (${toolsUsed} tools used)`);
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
  // Read current app.jsx so Claude has full context of what exists
  let currentApp = '';
  const appPath = join(PROJECT_ROOT, 'app.jsx');
  if (existsSync(appPath)) {
    currentApp = readFileSync(appPath, 'utf-8');
  }

  const dataSchema = extractDataSchema(currentApp);

  const prompt = `The user is iterating on a React app in app.jsx (in the current directory).

${currentApp ? `Current app.jsx:\n\n\`\`\`jsx\n${currentApp}\n\`\`\`\n\n` : ''}${dataSchema}User says: "${message}"

Edit app.jsx to implement ONLY the requested changes. CRITICAL RULES:
- READ the current app.jsx above carefully before making ANY changes
- ADD to the existing app — do NOT rewrite it from scratch
- Preserve ALL existing components, features, state, and data models
- Keep all globals: useTenant(), useFireproofClerk(), useVibesTheme(), useState, useEffect, etc.
- Do NOT add import statements — the app runs in a Babel script block with globals
- Do NOT use TypeScript
- Keep export default App at the bottom
- Preserve the window.__VIBES_THEMES__ array at the top of the file
- If adding a new feature, integrate it alongside existing features (e.g. add a tab, not replace the whole app)
- NEVER change existing Fireproof document types or query filters — existing data must keep working
- Use the EXACT same document type strings shown in DATA SCHEMA above — user data depends on them`;

  await runClaude(ws, prompt);
}

async function handleThemeSwitch(ws, themeId) {
  const themeFile = join(THEME_DIR, `${themeId}.md`);
  let themeContent = '';
  if (existsSync(themeFile)) {
    themeContent = readFileSync(themeFile, 'utf-8');
  } else {
    const txtFile = join(THEME_DIR, `${themeId}.txt`);
    if (existsSync(txtFile)) {
      themeContent = readFileSync(txtFile, 'utf-8');
    }
  }

  const themeMeta = themes.find(t => t.id === themeId);
  const themeName = themeMeta ? themeMeta.name : themeId;

  // Read current app.jsx so Claude knows exactly what to preserve
  let currentApp = '';
  const appPath = join(PROJECT_ROOT, 'app.jsx');
  if (existsSync(appPath)) {
    currentApp = readFileSync(appPath, 'utf-8');
  }

  const dataSchema = extractDataSchema(currentApp);

  const prompt = `Restyle the React app in app.jsx using the "${themeName}" (${themeId}) theme.

${themeContent ? `Theme design principles and tokens:\n\n${themeContent}\n\n` : ''}${currentApp ? `Current app.jsx (PRESERVE THIS STRUCTURE):\n\n\`\`\`jsx\n${currentApp}\n\`\`\`\n\n` : ''}${dataSchema}CRITICAL RULES — read carefully:
- PRESERVE EVERY COMPONENT, FUNCTION, AND HOOK — do NOT remove, rename, or restructure anything
- Keep the exact same component tree: same components, same props, same state, same event handlers
- ONLY change: style objects, CSS class values, color values, border-radius, shadows, spacing, font sizes, backgrounds
- If the app has a table, keep the table. If it has a form, keep the form. If it has a list, keep the list. Do NOT reorganize.
- Keep useVibesTheme() and the theme switching mechanism (window.__VIBES_THEMES__, vibes-design-request listener)
- Update the window.__VIBES_THEMES__ array to include { id: "${themeId}", name: "${themeName}" } alongside any existing themes
- IMPORTANT: Set the default theme to "${themeId}" in useVibesTheme() — change the localStorage fallback from the current default to "${themeId}"
- Do NOT add import statements — the app runs in a Babel script block with globals
- Do NOT use TypeScript
- Restyle with the theme's visual personality (colors, shadows, typography, spacing) but keep the SAME layout structure
- Keep all globals: useTenant(), useFireproofClerk(), useState, useEffect, etc.
- Keep export default App at the bottom
- NEVER change Fireproof document types or query filters — user data in IndexedDB depends on them`;

  await runClaude(ws, prompt, { skipChat: true });
}

// --- Create Theme Handlers ---

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

    // localStorage-backed Fireproof mock — data survives iframe reloads
    var _STORE_KEY = 'vibes-preview-data';
    var _storeData = (function() {
      try { return JSON.parse(localStorage.getItem(_STORE_KEY)) || []; }
      catch(e) { return []; }
    })();
    var _storeListeners = new Set();
    function _persist() {
      try { localStorage.setItem(_STORE_KEY, JSON.stringify(_storeData)); } catch(e) {}
    }
    function _notify() { _persist(); _storeListeners.forEach(function(cb) { cb(); }); }

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
