/**
 * Generate handler — create a new app from scratch via Claude.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runOneShot } from '../claude-bridge.js';
import { sanitizeAppJsx } from '../post-process.js';
import { autoSelectTheme, parseThemeColors, extractPass2ThemeContext } from '../config.js';
import { stripForTemplate } from '../../lib/strip-code.js';
import { APP_PLACEHOLDER } from '../../lib/assembly-utils.js';
import { loadEnvFile, populateConnectConfig } from '../../lib/env-utils.js';
import { TEMPLATES } from '../../lib/paths.js';
import { currentAppDir, slugifyPrompt, resolveAppName } from '../app-context.js';

/**
 * Generate a new app from a user prompt.
 */
export async function handleGenerate(ctx, onEvent, userPrompt, themeId, model, reference = null) {
  if (!userPrompt) {
    onEvent({ type: 'error', message: 'Please describe what you want to build.' });
    return;
  }

  console.log(`[Generate] ▸ START prompt="${userPrompt.slice(0, 60)}" themeId=${themeId || '(auto)'}`);

  // Auto-save previous app before switching
  if (ctx.currentApp) {
    try {
      const prevDir = currentAppDir(ctx);
      const prevIndexPath = join(prevDir, 'index.html');
      const assembled = assembleAppFrame(ctx);
      writeFileSync(prevIndexPath, assembled);
      console.log(`[Generate] Auto-saved index.html for "${ctx.currentApp}"`);
    } catch (e) {
      console.warn(`[Generate] Auto-save failed for "${ctx.currentApp}": ${e.message}`);
    }
  }

  // Create app directory from prompt
  const slug = slugifyPrompt(userPrompt);
  const appName = resolveAppName(ctx.appsDir, slug);
  const appDir = join(ctx.appsDir, appName);
  mkdirSync(appDir, { recursive: true });
  ctx.currentApp = appName;
  onEvent({ type: 'app_created', name: appName });
  console.log(`[Generate] Created app directory: ${appName}`);

  const appJsxPath = join(appDir, 'app.jsx');

  const stylePath = join(ctx.projectRoot, 'skills/vibes/defaults/style-prompt.txt');

  let styleGuide = '';
  try {
    styleGuide = readFileSync(stylePath, 'utf-8');
    console.log(`[Generate]   ✓ styleGuide: ${(styleGuide.length / 1024).toFixed(1)}KB (inlined)`);
  } catch (e) {
    console.log(`[Generate]   ✗ Could not read style-prompt.txt: ${e.message}`);
  }

  const isAuto = !themeId;

  if (isAuto) {
    themeId = autoSelectTheme(ctx, userPrompt);
    console.log(`[Generate]   ✓ autoSelectTheme => "${themeId}"`);
  } else {
    console.log(`[Generate]   ✓ user selected theme: "${themeId}"`);
  }

  const themeName = (ctx.themes.find(t => t.id === themeId) || {}).name || themeId;
  const txtFile = join(ctx.themeDir, `${themeId}.txt`);
  const mdFile = join(ctx.themeDir, `${themeId}.md`);
  const themeFilePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : '';

  let themeContent = '';
  if (themeFilePath) {
    themeContent = readFileSync(themeFilePath, 'utf-8');
    console.log(`[Generate]   ✓ themeFile: ${(themeContent.length / 1024).toFixed(1)}KB — "${themeName}"`);
  } else {
    console.log(`[Generate]   ✗ NO THEME FILE for "${themeId}"`);
  }

  const genColors = parseThemeColors(ctx.themeDir, themeId);
  let rootCss = genColors?.rootBlock || '';
  if (!rootCss) {
    const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
    if (rootMatch) rootCss = rootMatch[0];
  }
  console.log(`[Generate]   rootCss: ${rootCss ? rootCss.split('\n').length + ' lines' : 'MISSING'}`);

  let themeEssentials = themeContent
    .replace(/REFERENCE STYLES[\s\S]*?(?=\n[A-Z]{2,}[A-Z ]*[:|\n]|$)/, '')
    .replace(/```css[\s\S]*?```/g, '')
    .trim();
  if (themeEssentials.length > 4000) themeEssentials = themeEssentials.slice(0, 4000) + '\n...';

  // Handle reference image
  let referenceBlock = '';
  if (reference && reference.name && reference.dataUrl) {
    const intent = reference.intent || 'match';
    const base64 = reference.dataUrl.split(',')[1];
    const tmpDir = join(ctx.projectRoot, '.vibes-tmp');
    mkdirSync(tmpDir, { recursive: true });
    const refPath = join(tmpDir, reference.name);
    writeFileSync(refPath, Buffer.from(base64, 'base64'));
    console.log(`[Generate]   ✓ reference image saved: ${refPath} (intent: ${intent})`);

    if (intent === 'mood') {
      referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

ANALYZE the image like a theme designer — before writing any code, identify:
- MOOD: 3-4 adjectives describing the visual feeling
- COLOR PALETTE: extract every distinct color as oklch() — background, text, accent, borders, muted tones
- DESIGN PRINCIPLES: border styles, shadow depth, spacing rhythm
- TYPOGRAPHY FEEL: weight, style, sizing hierarchy
- SURFACE TREATMENT: glass/frosted effects, gradients, textures, card styles
- MOTION ENERGY: calm/lively/dramatic — what kind of transitions and hover effects fit
- DECORATIVE ELEMENTS: any SVG patterns, background shapes, dividers, icons style

Apply the MOOD and COLOR PALETTE from this image to the app you generate.
Use the extracted oklch() colors for the --comp-* tokens and :root block INSTEAD of the theme file colors.
Keep the theme's layout patterns and structural ideas but OVERRIDE all colors and visual mood with what you see in the image.
--color-background MUST match the image's background. Never leave it transparent or unset.

`;
    } else {
      // intent === 'match'
      referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

ANALYZE the image like a theme designer — before writing any code, identify:
- MOOD: 3-4 adjectives describing the visual feeling
- COLOR PALETTE: extract every distinct color as oklch() — background, text, accent, borders, muted tones
- DESIGN PRINCIPLES: border styles, shadow depth, spacing rhythm
- TYPOGRAPHY FEEL: weight, style, sizing hierarchy
- SURFACE TREATMENT: glass/frosted effects, gradients, textures, card styles
- LAYOUT STRUCTURE: how is the space divided? sidebar? header? grid? cards? split-pane?
- MOTION ENERGY: calm/lively/dramatic
- DECORATIVE ELEMENTS: any SVG patterns, background shapes, dividers, icons style

Apply BOTH the visual style AND layout structure from this image to the app you generate.
Use the extracted oklch() colors for the --comp-* tokens and :root block INSTEAD of the theme file colors.
Match the layout structure, spatial organization, component arrangement, and visual hierarchy of the image.
--color-background MUST match the image's background. Never leave it transparent or unset.
The goal: the generated app should look like the image was its design spec.

`;
    }
  }

  const prompt = `${referenceBlock}You are an expert React app designer. Generate a beautiful, creative app.

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
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.
- Responsive (mobile-first with Tailwind). className="btn" for buttons, "grid-background" on root

=== THEME SECTION MARKERS ===

Organize ALL visual CSS into marked sections. This enables fast theme switching.

In your <style> tag, wrap CSS in comment markers:

\`\`\`css
/* @theme:tokens */
:root { --comp-bg: ...; --comp-text: ...; /* all color variables */ }
/* @theme:tokens:end */

/* @theme:typography */
@import url('...');  /* Google Fonts or other font imports */
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: ...; }
.nav-button { display: flex; gap: 0.5rem; background: var(--comp-accent); border: 2px solid var(--comp-border); }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { ... } /* all @keyframes and animation definitions */
/* @theme:motion:end */

/* Pure-layout ONLY — no visual properties */
.grid-wrapper { display: grid; gap: 1rem; max-width: 800px; margin: 0 auto; }
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
- ANY class with visual properties (color, background, border, box-shadow, font-family, font-size, font-weight, text-shadow, fill, stroke, opacity, gradients) MUST go inside @theme:surfaces — even if it also has layout properties
- ONLY pure-layout classes go outside markers: display, grid-template, gap, padding, margin, position, z-index, width, max-width, height, flex-*, align-items, justify-content, overflow, box-sizing

DATABASE: useDocument({text:"",type:"item"}), useLiveQuery("type",{key:"item"}), database.put/del`;

  onEvent({ type: 'theme_selected', themeId, themeName });

  const maxTurns = reference ? 8 : 5;
  console.log(`[Generate] Starting — theme: ${themeId} (${themeName}), prompt: ${(prompt.length / 1024).toFixed(1)}KB${reference ? `, ref: ${reference.name} (${reference.intent})` : ''}`);
  await runOneShot(prompt, { skipChat: true, maxTurns, model, cwd: currentAppDir(ctx), tools: 'Write' }, onEvent, ctx.projectRoot);

  sanitizeAppJsx(currentAppDir(ctx));
}

/**
 * Assemble app.jsx into the vibes template with Fireproof bundle + OIDC auth.
 * Used by the /app-frame route.
 */
export function assembleAppFrame(ctx) {
  const templatePath = TEMPLATES.vibesBasic;
  if (!existsSync(templatePath)) {
    return `<html><body><h1>Template not found</h1><p>${templatePath}</p></body></html>`;
  }

  let template = readFileSync(templatePath, 'utf-8');

  const appDir = currentAppDir(ctx);
  if (!appDir) {
    return `<html><body><h1>No app active</h1></body></html>`;
  }

  const appPath = join(appDir, 'app.jsx');
  if (!existsSync(appPath)) {
    return `<html><body><h1>app.jsx not found</h1></body></html>`;
  }

  const appCode = readFileSync(appPath, 'utf-8');
  const strippedCode = stripForTemplate(appCode, { stripReactHooks: false });

  if (!template.includes(APP_PLACEHOLDER)) {
    return `<html><body><h1>Template missing placeholder</h1><p>${APP_PLACEHOLDER}</p></body></html>`;
  }
  template = template.replace(APP_PLACEHOLDER, strippedCode);

  // Preview mode: don't populate Connect URLs — run local-only (no auth, no sync).
  // Sync + auth are added on deploy via assemble scripts.
  template = populateConnectConfig(template, {});

  return template;
}
