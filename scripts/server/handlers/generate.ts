/**
 * Generate handler — create a new app from scratch via Claude.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runOneShot } from '../claude-bridge.ts';
import type { EventCallback } from '../claude-bridge.ts';
import { sanitizeAppJsx } from '../post-process.ts';
import { autoSelectTheme, parseThemeColors, extractPass2ThemeContext } from '../config.ts';
import type { ServerContext } from '../config.ts';
import { stripForTemplate } from '../../lib/strip-code.js';
import { APP_PLACEHOLDER } from '../../lib/assembly-utils.js';
import { populateConnectConfig } from '../../lib/env-utils.js';
import { TEMPLATES } from '../../lib/paths.js';
import { currentAppDir, slugifyPrompt, resolveAppName } from '../app-context.js';

/**
 * Generate a new app from a user prompt.
 */
const AI_INSTRUCTIONS = `
=== AI FEATURES ===

This app needs AI capabilities. Use the global \`useAI\` hook (available as window.useAI — NO import needed).

\`\`\`jsx
// Non-streaming (simple request/response):
const { callAI, loading, error } = useAI();

const response = await callAI({
  model: "anthropic/claude-sonnet-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: userMessage }
  ],
  temperature: 0.7,
  max_tokens: 1000
});
const aiText = response.choices[0].message.content;

// Streaming (for chat UIs — shows tokens as they arrive):
const { ask, answer, loading, error } = useAI();

// ask() starts streaming; answer updates reactively
ask({
  model: "anthropic/claude-sonnet-4",
  messages: [{ role: "user", content: userMessage }]
});
// Render: <div>{answer}</div>  — updates live as tokens stream in

// Error handling:
if (error?.code === 'LIMIT_EXCEEDED') { /* show upgrade message */ }
if (error?.code === 'API_ERROR') { /* show retry button */ }
\`\`\`

RULES for AI features:
- useAI() is a React hook — call it at the top of your component (not inside callbacks)
- callAI() is async — await it. ask() is fire-and-forget (answer updates reactively)
- Prefer streaming (ask/answer) for chat interfaces, callAI for one-shot operations
- Use Fireproof to persist AI conversations: save user messages and AI responses to the database
- Show a loading indicator while \`loading\` is true
- Handle errors gracefully — show user-friendly messages, not raw error objects
- Do NOT use fetch() to call AI APIs directly — always use useAI()
- Do NOT simulate or hardcode AI responses — use the real API via useAI()
`;

export async function handleGenerate(ctx: ServerContext, onEvent: EventCallback, userPrompt: string, themeId: string | undefined, model: string | undefined, reference: any = null, useAI: boolean = false) {
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

  // Design reference path — skip theme resolution, let the reference guide design
  const hasRef = reference && reference.name && reference.dataUrl;
  if (hasRef) {
    const isHtmlRef = /\.html?$/i.test(reference.name);
    const intent = reference.intent || 'match';
    const base64 = reference.dataUrl.split(',')[1];
    const tmpDir = join(ctx.projectRoot, '.vibes-tmp');
    mkdirSync(tmpDir, { recursive: true });
    const refPath = join(tmpDir, reference.name);

    let referenceBlock = '';

    if (isHtmlRef) {
      const htmlContent = Buffer.from(base64, 'base64').toString('utf-8');
      writeFileSync(refPath, htmlContent, 'utf-8');
      const inlined = htmlContent.length <= 30000 ? htmlContent : htmlContent.slice(0, 30000) + '\n<!-- truncated -->';
      console.log(`[Generate]   ✓ HTML reference saved: ${refPath} (${(htmlContent.length / 1024).toFixed(1)}KB, inlined)`);

      referenceBlock = `=== DESIGN REFERENCE (HTML: "${reference.name}") ===

Study this HTML file's design — colors, typography, spacing, layout, surfaces, effects — and use it as your design spec.

\`\`\`html
${inlined}
\`\`\`

Extract the visual design from this HTML:
- COLOR PALETTE: map every color to oklch() values for the --comp-* tokens
- TYPOGRAPHY: font families, weights, sizing hierarchy
- SURFACES: border styles, shadows, gradients, glass effects
- LAYOUT PATTERNS: spatial organization, card styles, grid/flex structure
- MOTION/EFFECTS: animations, transitions, hover states
- --color-background MUST match the HTML's background. Never transparent.

`;
    } else {
      // Image reference
      writeFileSync(refPath, Buffer.from(base64, 'base64'));
      console.log(`[Generate]   ✓ reference image saved: ${refPath} (intent: ${intent})`);

      if (intent === 'mood') {
        referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

You are extracting a COMPLETE visual theme from this image — as detailed as a professional design system.

In your <design> block, write out ALL of the following before ANY code:

1. MOOD: 3-4 adjectives (e.g. "warm, editorial, refined, tactile")
2. COLOR PALETTE — extract EVERY distinct color you see, converted to oklch():
   - Background color(s): main page bg, card bg, surface bg
   - Text colors: primary, secondary/muted, headings
   - Accent color(s): buttons, links, highlights
   - Border/divider colors
   - Any gradient stops
   Write them as a complete :root block with --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background
3. TYPOGRAPHY: exact font families (find matching Google Fonts), weights, letter-spacing, text-transform patterns
4. SURFACES: border-radius values, box-shadow patterns, backdrop-filter, gradients, card styles — with exact CSS
5. SPACING RHYTHM: padding/margin/gap patterns you observe
6. DECORATIVE ELEMENTS: background patterns, SVG shapes, dividers, icons style
7. MOTION ENERGY: calm/lively/dramatic — what animations fit this mood

Apply the MOOD and COLOR PALETTE from this image to the app you generate.
Use the extracted oklch() colors EXACTLY in your :root block — do not approximate or simplify.
--color-background MUST match the image's background. Never leave it transparent or unset.

`;
      } else {
        // intent === 'match'
        referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

You are extracting a COMPLETE visual theme AND layout from this image — as detailed as a professional design system.

In your <design> block, write out ALL of the following before ANY code:

1. MOOD: 3-4 adjectives (e.g. "warm, editorial, refined, tactile")
2. COLOR PALETTE — extract EVERY distinct color you see, converted to oklch():
   - Background color(s): main page bg, card bg, surface bg
   - Text colors: primary, secondary/muted, headings
   - Accent color(s): buttons, links, highlights
   - Border/divider colors
   - Any gradient stops
   Write them as a complete :root block with --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background
3. TYPOGRAPHY: exact font families (find matching Google Fonts), weights, letter-spacing, text-transform patterns
4. SURFACES: border-radius values, box-shadow patterns, backdrop-filter, gradients, card styles — with exact CSS
5. SPACING RHYTHM: padding/margin/gap patterns you observe
6. LAYOUT STRUCTURE: how is the space divided? sidebar? header? grid? cards? split-pane? List each section with its approximate proportions
7. COMPONENT ARRANGEMENT: nav position, content hierarchy, card grid, footer placement
8. DECORATIVE ELEMENTS: background patterns, SVG shapes, dividers, icons style
9. MOTION ENERGY: calm/lively/dramatic — what animations fit this mood

Apply BOTH the visual style AND layout structure from this image to the app you generate.
Use the extracted oklch() colors EXACTLY in your :root block — do not approximate or simplify.
Match the layout structure, spatial organization, component arrangement, and visual hierarchy of the image.
--color-background MUST match the image's background. Never leave it transparent or unset.
The goal: the generated app should look like the image was its design spec.

`;
      }
    }

    const refPrompt = `${referenceBlock}You are an expert React app designer. Generate a beautiful, creative app.

USER REQUEST: "${userPrompt}"

Your app.jsx MUST start with these EXACT lines (copy-paste, do not modify):

\`\`\`jsx
window.__VIBES_THEMES__ = [{ id: "custom-ref", name: "Custom Reference" }];

function useVibesTheme() {
  const [theme, setTheme] = React.useState(() => localStorage.getItem("vibes-theme") || "custom-ref");
  React.useEffect(() => {
    const handler = (e) => { const t = e.detail?.theme; if (t) { setTheme(t); localStorage.setItem("vibes-theme", t); } };
    document.addEventListener("vibes-design-request", handler);
    return () => document.removeEventListener("vibes-design-request", handler);
  }, []);
  return theme;
}
\`\`\`

Derive ALL :root CSS tokens from the design reference above — do NOT use any predefined theme.

=== DESIGN GUIDANCE ===

${styleGuide}

=== DESIGN REASONING ===

Think in a <design> block:
- What colors, typography, and surfaces did you extract from the reference?
- How will you map them to --comp-* tokens?
- What custom SVG illustrations fit this app?
- What animations and effects match the reference mood? (Canvas particles, animated SVG, scroll reveals, card tilt, cursor glow)

=== WRITE app.jsx ===

Write the complete app to app.jsx. Rules:
- FIRST: the exact __VIBES_THEMES__ + useVibesTheme code shown above
- THEN: <style> tag with reference-derived CSS organized into marked sections (see below), plus component styles
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

DATABASE:
- useDocument({text:"",type:"item"}) returns { doc, merge, submit, reset, save }
  merge({text:"new"}) to update fields, submit() to save as new doc, save() to upsert by _id
  For forms: merge() on each keystroke, submit() when done. NEVER use setDoc — it doesn't exist.
- useLiveQuery("type",{key:"item"}) returns { docs, isLoading }
- database.put({...doc, field:"val"}) for direct writes, database.del(doc) to delete${useAI ? AI_INSTRUCTIONS : ''}`;

    onEvent({ type: 'theme_selected', themeId: 'custom-ref', themeName: 'Custom Reference' });

    const maxTurns = isHtmlRef ? 5 : 8;
    console.log(`[Generate] Starting (reference path) — ref: ${reference.name} (${intent}), prompt: ${(refPrompt.length / 1024).toFixed(1)}KB`);
    await runOneShot(refPrompt, { skipChat: true, maxTurns, model, cwd: currentAppDir(ctx), tools: isHtmlRef ? 'Write' : 'Write,Read' }, onEvent, ctx.projectRoot);

    sanitizeAppJsx(currentAppDir(ctx));
    return;
  }

  // Normal theme path — no design reference
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

DATABASE:
- useDocument({text:"",type:"item"}) returns { doc, merge, submit, reset, save }
  merge({text:"new"}) to update fields, submit() to save as new doc, save() to upsert by _id
  For forms: merge() on each keystroke, submit() when done. NEVER use setDoc — it doesn't exist.
- useLiveQuery("type",{key:"item"}) returns { docs, isLoading }
- database.put({...doc, field:"val"}) for direct writes, database.del(doc) to delete${useAI ? AI_INSTRUCTIONS : ''}`;

  onEvent({ type: 'theme_selected', themeId, themeName });

  console.log(`[Generate] Starting — theme: ${themeId} (${themeName}), prompt: ${(prompt.length / 1024).toFixed(1)}KB`);
  await runOneShot(prompt, { skipChat: true, maxTurns: 5, model, cwd: currentAppDir(ctx), tools: 'Write' }, onEvent, ctx.projectRoot);

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
  const strippedCode = stripForTemplate(appCode, { stripReactHooks: true });

  if (!template.includes(APP_PLACEHOLDER)) {
    return `<html><body><h1>Template missing placeholder</h1><p>${APP_PLACEHOLDER}</p></body></html>`;
  }
  template = template.replace(APP_PLACEHOLDER, strippedCode);

  // Preview mode: don't populate Connect URLs — run local-only (no auth, no sync).
  // Sync + auth are added on deploy via assemble scripts.
  template = populateConnectConfig(template, {});

  return template;
}
