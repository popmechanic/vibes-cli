/**
 * Server configuration — CLI args, .env, theme/animation catalogs.
 *
 * Exports loadConfig() which returns a mutable ctx object shared by all modules.
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { parseThemeCatalog } from '../lib/parse-theme-catalog.js';
import { parseAnimationCatalog } from '../lib/parse-animation-catalog.js';

/**
 * Build the ctx object from CLI args, .env, and catalogs.
 */
export function loadConfig() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(__dirname, '../..');
  const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3333', 10);
  const mode = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=preview').split('=')[1];
  const initialPrompt = process.argv.find((_, i, a) => a[i - 1] === '--prompt') || '';

  const themeDir = join(projectRoot, 'skills/vibes/themes');
  const animationDir = join(projectRoot, 'skills/vibes/animations');
  const appsDir = join(homedir(), '.vibes', 'apps');
  if (!existsSync(appsDir)) mkdirSync(appsDir, { recursive: true });

  // Load OpenRouter API key
  const openRouterKey = loadOpenRouterKey(projectRoot);

  // Load theme catalog
  const catalogPath = join(projectRoot, 'skills/vibes/themes/catalog.txt');
  let themes = [];
  if (existsSync(catalogPath)) {
    themes = parseThemeCatalog(readFileSync(catalogPath, 'utf-8'));
    console.log(`Loaded ${themes.length} themes from catalog`);
  }

  // Load animation catalog
  const animCatalogPath = join(projectRoot, 'skills/vibes/animations/catalog.txt');
  let animations = [];
  if (existsSync(animCatalogPath)) {
    animations = parseAnimationCatalog(readFileSync(animCatalogPath, 'utf-8'));
    console.log(`Loaded ${animations.length} animations from catalog`);
  }

  // Pre-parse theme colors
  const themeColors = {};
  for (const t of themes) {
    const colors = parseThemeColors(themeDir, t.id);
    if (colors) themeColors[t.id] = colors;
  }
  console.log(`Parsed colors for ${Object.keys(themeColors).length} themes`);

  // Extract :root CSS blocks
  const themeRootCss = {};
  for (const t of themes) {
    const txtFile = join(themeDir, `${t.id}.txt`);
    const mdFile = join(themeDir, `${t.id}.md`);
    const filePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : null;
    if (!filePath) continue;
    const content = readFileSync(filePath, 'utf-8');
    const rootMatch = content.match(/:root\s*\{[\s\S]*?\}/);
    if (rootMatch) {
      themeRootCss[t.id] = rootMatch[0];
    } else {
      const c = themeColors[t.id];
      if (c) {
        const lines = [];
        if (c.bg) lines.push(`  --comp-bg: ${c.bg};`);
        if (c.text) lines.push(`  --comp-text: ${c.text};`);
        if (c.border) lines.push(`  --comp-border: ${c.border};`);
        if (c.accent) lines.push(`  --comp-accent: ${c.accent};`);
        if (c.text) lines.push(`  --comp-accent-text: ${c.bg || 'oklch(1.00 0 0)'};`);
        if (c.muted) lines.push(`  --comp-muted: ${c.muted};`);
        if (c.bg) lines.push(`  --color-background: ${c.bg};`);
        lines.push(`  --grid-color: transparent;`);
        if (lines.length > 1) themeRootCss[t.id] = ':root {\n' + lines.join('\n') + '\n}';
      }
    }
  }
  console.log(`Extracted :root CSS for ${Object.keys(themeRootCss).length} themes`);

  return {
    projectRoot,
    port,
    mode,
    initialPrompt,
    themes,
    animations,
    themeColors,
    themeRootCss,
    openRouterKey,
    appsDir,
    themeDir,
    animationDir,
  };
}

/**
 * Reload themes and colors from disk (after theme creation).
 */
export function reloadThemes(ctx) {
  const catalogPath = join(ctx.projectRoot, 'skills/vibes/themes/catalog.txt');
  if (existsSync(catalogPath)) {
    ctx.themes = parseThemeCatalog(readFileSync(catalogPath, 'utf-8'));
    console.log(`Reloaded ${ctx.themes.length} themes from catalog`);
  }
}

// --- Internal helpers ---

export function loadOpenRouterKey(projectRoot) {
  const candidates = [
    join(projectRoot, '.env'),
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

/**
 * Get animation instructions text for a given animation ID.
 */
export function getAnimationInstructions(ctx, animationId) {
  const filePath = join(ctx.animationDir, `${animationId}.txt`);
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8');
  return null;
}

/**
 * Recommend themes based on app.jsx content keywords.
 */
export function getRecommendedThemeIds(ctx) {
  const appPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appPath)) return new Set();

  const code = readFileSync(appPath, 'utf-8').toLowerCase();
  const keywords = new Set();

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

  const scored = ctx.themes.map(t => {
    const text = `${t.bestFor} ${t.mood}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 2;
    }
    for (const kw of keywords) {
      for (const word of text.split(/[,\s]+/)) {
        if (word.includes(kw) || kw.includes(word)) score += 1;
      }
    }
    return { id: t.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter(s => s.score > 0).slice(0, 8);
  return new Set(top.map(s => s.id));
}

/**
 * Bridge theme-specific variable names to --comp-* namespace.
 */
export function buildCompTokenMapping(varLines) {
  const vars = {};
  for (const line of varLines) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*(?:\/\*.*)?;?\s*$/);
    if (m) vars[m[1]] = m[2].replace(/;$/, '').trim();
  }

  const names = Object.keys(vars);
  const find = (patterns) => {
    for (const p of patterns) {
      if (typeof p === 'string') {
        const exact = names.find(n => n === p);
        if (exact) return `var(${exact})`;
      } else {
        const match = names.find(n => p.test(n));
        if (match) return `var(${match})`;
      }
    }
    return null;
  };

  const compBg = find(['--bg', '--background', '--surface', '--void', '--concrete', '--editor-bg', /^--bg-start$/, /^--bg-gradient-start$/, /^--bg-gradient-from$/]);
  const compText = find(['--fg', '--text', '--foreground', '--ink', '--code-text', '--white', '--text-light', /^--bone-text$/, /^--neon-core$/]);
  const compAccent = find([/^--accent$/, '--primary', '--brand', /^--neon-/, '--gold-base', '--copper', /^--accent-/, '--acid', '--green', /^--syn-keyword$/, '--border-fg', '--dot', /^--aether-/, '--fg']);
  const compMuted = find(['--fg-muted', '--fg-dim', '--muted', '--dim', '--secondary', '--text-dim', '--gutter', /^--muted$/]);
  const compBorder = find(['--border', '--separator', '--stroke', '--rule', /^--border$/, '--green-border']);

  let compAccentText = 'oklch(1.00 0 0)';
  if (compBg) {
    const bgVal = vars[compBg.replace(/^var\(/, '').replace(/\)$/, '')] || '';
    const lMatch = bgVal.match(/oklch\(\s*([\d.]+)/);
    if (lMatch && parseFloat(lMatch[1]) >= 0.5) {
      compAccentText = 'oklch(0.15 0 0)';
    }
  }

  const lines = [];
  if (compBg) lines.push(`  --comp-bg: ${compBg};`);
  if (compText) lines.push(`  --comp-text: ${compText};`);
  if (compAccent) lines.push(`  --comp-accent: ${compAccent};`);
  lines.push(`  --comp-accent-text: ${compAccentText};`);
  if (compMuted) lines.push(`  --comp-muted: ${compMuted};`);
  if (compBorder) lines.push(`  --comp-border: ${compBorder};`);
  if (compBg) lines.push(`  --color-background: ${compBg};`);
  lines.push(`  --grid-color: transparent;`);

  return lines;
}

/**
 * Parse color tokens from a theme file.
 */
export function parseThemeColors(themeDir, themeId) {
  const txtFile = join(themeDir, `${themeId}.txt`);
  const mdFile = join(themeDir, `${themeId}.md`);
  const filePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : null;
  if (!filePath) return null;

  const content = readFileSync(filePath, 'utf-8');

  const colorSection = content.match(/(?:COLOR TOKENS|TOKEN OVERRIDES)[\s\S]*?(?=\n[A-Z]{2,}[A-Z ]*:|$)/);
  if (!colorSection) return null;

  const section = colorSection[0];
  const result = { bg: null, text: null, accent: null, muted: null, border: null };

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

  if (!result.bg) {
    const m = section.match(/--color-background[^:]*:\s*([^;\n/*]+)/);
    if (m) result.bg = m[1].trim();
  }

  if (!result.bg || !result.accent) {
    const allColors = [...section.matchAll(/oklch\([^)]+\)|#[0-9a-fA-F]{3,8}/g)].map(m => m[0]);
    const unique = [...new Set(allColors)];
    if (!result.bg && unique.length > 0) result.bg = unique[0];
    if (!result.text && unique.length > 1) result.text = unique[1];
    if (!result.accent && unique.length > 2) result.accent = unique[2];
    if (!result.muted && unique.length > 3) result.muted = unique[3];
    if (!result.border && unique.length > 4) result.border = unique[4];
  }

  const count = Object.values(result).filter(Boolean).length;
  if (count < 2) return null;

  const rootMatch = content.match(/:root\s*\{[\s\S]*?\}/);
  const allVarLines = content.match(/^\s*--[\w-]+:\s*(?:oklch\([^)]+\)|#[0-9a-fA-F]{3,8}).*$/gm);
  if (rootMatch) {
    if (!rootMatch[0].includes('--comp-bg') && allVarLines?.length > 0) {
      const compLines = buildCompTokenMapping(allVarLines);
      if (compLines.length > 0) {
        result.rootBlock = rootMatch[0].replace(/\}$/, '\n\n  /* comp-* token bridge */\n' + compLines.join('\n') + '\n}');
      } else {
        result.rootBlock = rootMatch[0];
      }
    } else {
      result.rootBlock = rootMatch[0];
    }
  } else {
    if (allVarLines && allVarLines.length > 0) {
      const themeVarLines = allVarLines.map(l => '  ' + l.trim().replace(/;?\s*$/, ';')).join('\n');
      const compLines = buildCompTokenMapping(allVarLines);
      if (compLines.length > 0) {
        result.rootBlock = `:root {\n${themeVarLines}\n\n  /* comp-* token bridge */\n${compLines.join('\n')}\n}`;
      } else {
        result.rootBlock = ':root {\n' + themeVarLines + '\n}';
      }
    }
  }

  const fontImports = [...content.matchAll(/@import\s+url\([^)]+\)[^;]*;/g)].map(m => m[0]);
  if (fontImports.length > 0) {
    result.fontImports = fontImports;
  }

  return result;
}

/**
 * Extract targeted theme context for Pass 2 creative prompts.
 */
export function extractPass2ThemeContext(themeContent, maxBytes = 12000) {
  const sections = [];
  let total = 0;

  const extractSection = (name) => {
    const re = new RegExp(`${name}[:\\s]*\\n([\\s\\S]*?)(?=\\n[A-Z]{2,}[A-Z ]*[:\\n]|$)`);
    const m = themeContent.match(re);
    return m ? m[1].trim() : '';
  };

  const desc = extractSection('DESCRIPTION');
  const mood = themeContent.match(/^MOOD:\s*(.+)$/m);
  if (mood) {
    const moodLine = `MOOD: ${mood[1]}`;
    sections.push(moodLine);
    total += moodLine.length;
  }
  if (desc && total + desc.length < maxBytes) {
    sections.push(`DESCRIPTION:\n${desc}`);
    total += desc.length;
  }

  const adapt = extractSection('ADAPTATION NOTES');
  if (adapt && total + adapt.length < maxBytes) {
    sections.push(`ADAPTATION NOTES:\n${adapt}`);
    total += adapt.length;
  }

  const colors = extractSection('COLOR TOKENS');
  if (colors && total + colors.length < maxBytes) {
    sections.push(`COLOR TOKENS:\n${colors}`);
    total += colors.length;
  }

  const refStyles = extractSection('REFERENCE STYLES');
  if (refStyles) {
    const creativePatterns = /@keyframes|box-shadow|backdrop-filter|linear-gradient|radial-gradient|conic-gradient|::before|::after|animation:|filter:|clip-path:|mask:|text-shadow:/;
    const cssBlocks = refStyles.split(/\n\s*\/\* ----/);
    const creativeBlocks = [];
    for (const block of cssBlocks) {
      if (creativePatterns.test(block)) {
        const fullBlock = block.startsWith(' ') ? '  /* ----' + block : block;
        if (total + fullBlock.length < maxBytes) {
          creativeBlocks.push(fullBlock);
          total += fullBlock.length;
        }
      }
    }
    if (creativeBlocks.length > 0) {
      sections.push(`REFERENCE STYLES (creative excerpts):\n${creativeBlocks.join('\n')}`);
    }
  }

  for (const extra of ['ANIMATIONS', 'SVG ELEMENTS', 'PERSONALITY', 'DESIGN PRINCIPLES']) {
    const text = extractSection(extra);
    if (text && total + text.length < maxBytes) {
      sections.push(`${extra}:\n${text}`);
      total += text.length;
    }
  }

  return sections.join('\n\n');
}

/**
 * Auto-select theme based on user prompt keywords.
 */
export function autoSelectTheme(ctx, userPrompt) {
  const catalogPath = join(ctx.projectRoot, 'skills/vibes/themes/catalog.txt');
  if (!existsSync(catalogPath)) return 'default';

  const catalog = readFileSync(catalogPath, 'utf-8');
  const promptLower = userPrompt.toLowerCase();

  const signalRegex = /^(\w+)\s+signals:\s*([\s\S]*?)(?=\n\n|\n\w+\s+signals:)/gm;
  const scores = {};
  let match;
  while ((match = signalRegex.exec(catalog)) !== null) {
    const themeId = match[1];
    const keywords = match[2].match(/"([^"]+)"/g)?.map(k => k.replace(/"/g, '').toLowerCase()) || [];
    let score = 0;
    for (const kw of keywords) {
      if (promptLower.includes(kw)) score += kw.split(' ').length;
    }
    if (score > 0) scores[themeId] = score;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : 'default';
}
