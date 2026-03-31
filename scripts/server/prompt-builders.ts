/**
 * Prompt builders — pure-ish functions that construct prompt strings.
 *
 * Extracted from chat.ts, generate.ts, and theme.ts handlers.
 * These do file I/O (read app.jsx, write reference images, load skill content)
 * because gathering context is part of prompt construction.
 *
 * The handlers call these builders, then pass the prompt to runOneShot()
 * (or in future, to the persistent stream-json bridge).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getAnimationInstructions, autoSelectTheme, parseThemeColors, extractPass2ThemeContext } from './config.ts';
import type { ServerContext } from './config.ts';
import { currentAppDir } from './app-context.js';
import { AI_INSTRUCTIONS_CHAT, AI_INSTRUCTIONS_GENERATE, THEME_SECTION_MARKERS } from './ai-instructions.ts';

const RECENCY_REMINDER = `
CRITICAL REMINDERS (see system prompt for full reference):
- NO imports. NO createStore. Hooks are pre-existing globals.
- useApp() is mandatory in root App. Cells are scalars only (string/number/boolean).
- No sync/connection status UI, not even decorative ("Online", "LIVE", "Connected") — SyncStatusDot is built-in.
- Table names must be string literals: useRowIds('todos'), never useRowIds(tableName).`;

// --- Chat prompt builder ---

const EFFECT_INSTRUCTIONS = {
  '3d': `MANDATORY: Use WebGL or CSS 3D transforms (perspective, rotateX/Y/Z, preserve-3d) for this feature. Create actual 3D depth — not flat elements with shadows. Consider: rotating 3D cards, perspective grids, WebGL scenes with Three.js-style raw GL, isometric layouts, parallax depth layers. Use useRef + useEffect for any canvas/WebGL setup with proper cleanup.`,
  'animated': `MANDATORY: Add rich CSS & JS animations. Use @keyframes, CSS transitions, requestAnimationFrame loops, staggered animation-delay on lists, scroll-triggered reveals with IntersectionObserver, @property for animated gradients, clip-path morphing, and entrance/exit animations. Everything should feel alive and in motion.`,
  'interactive': `MANDATORY: Make elements respond to user interaction. Add mouse-follow effects (cursor glow, tilt cards on hover with perspective), drag & drop, hover state morphs, click-triggered path drawing, SMIL animate on mouseover/mouseout, parallax on scroll, and mouse-reactive particle displacement. Use onMouseMove with getBoundingClientRect for position tracking.`,
  'particles': `MANDATORY: Add a Canvas 2D particle system background. Use useRef + useEffect with requestAnimationFrame. Create floating particles that drift, connect particles with lines when close, add mouse-reactive displacement. Use devicePixelRatio for retina, keep count under 100 for mobile. The particles should be behind content with position:fixed, zIndex:0, pointerEvents:none.`,
  'shader': `MANDATORY: Add a WebGL fragment shader background. Create a fullscreen quad with vertex shader, pass u_time/u_resolution/u_mouse uniforms. Use effects like: aurora (sine wave color mixing), plasma (layered sine interference), noise gradient mesh (hash-based noise with mouse reactivity), or animated color fields. Use precision mediump float. Graceful fallback if WebGL unavailable.`,
};

// --- Auto-detect reference files from user message keywords ---

const REFERENCE_TRIGGERS: Array<{ keywords: RegExp; file: string; label: string }> = [
  {
    keywords: /\b(multiplayer|collaborat|shared\b.*\b(app|board|doc|list|timer|edit)|multi[- ]?user|real[- ]?time.*edit|team|players?\b.*\bgame|auction|poll|voting|lobby|trading|inventory)/i,
    file: 'multiplayer-guide.md',
    label: 'Multiplayer Guide',
  },
  {
    keywords: /\b(game|timer|countdown|turn[- ]?based|score|leaderboard|round|level|reaction)\b/i,
    file: 'game-patterns.md',
    label: 'Game Patterns',
  },
  {
    keywords: /\b(forms?|filter(?:ing)?|sort(?:ing)?|pagination|paginate|master[- ]?detail|kanban|crud|dashboard)\b/i,
    file: 'tinybase-patterns.md',
    label: 'TinyBase Patterns',
  },
  {
    keywords: /\b(debug(?:ging)?|troubleshoot|fix(?:ing)?\s+(?:bug|error|crash)|broken|not working)\b/i,
    file: 'bug-prevention.md',
    label: 'Bug Prevention',
  },
];

/**
 * Detect which reference files to inject based on keyword matching.
 * For generate prompts, bug-prevention.md is injected unconditionally
 * (new apps have the highest bug density).
 */
function detectReferences(
  ctx: ServerContext,
  message: string,
  opts: { alwaysIncludeBugPrevention?: boolean } = {},
): string {
  const refsDir = join(ctx.projectRoot, 'skills/vibes/references');
  const matched: string[] = [];
  const loadedFiles = new Set<string>();

  for (const trigger of REFERENCE_TRIGGERS) {
    if (trigger.keywords.test(message)) {
      if (loadedFiles.has(trigger.file)) continue;
      loadedFiles.add(trigger.file);
      const filePath = join(refsDir, trigger.file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8')
          .replace(/^---[\s\S]*?---\n*/, ''); // strip YAML frontmatter
        matched.push(`=== ${trigger.label} ===\n\n${content}`);
      }
    }
  }

  if (opts.alwaysIncludeBugPrevention && !loadedFiles.has('bug-prevention.md')) {
    const filePath = join(refsDir, 'bug-prevention.md');
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8')
        .replace(/^---[\s\S]*?---\n*/, '');
      matched.push(`=== Bug Prevention ===\n\n${content}`);
    }
  }

  if (matched.length === 0) return '';
  return `\n${matched.join('\n\n---\n\n')}\n`;
}

/**
 * Build the prompt for iterative chat edits to app.jsx.
 *
 * Reads app.jsx from disk, builds effect/reference/skill blocks,
 * and returns the complete prompt string.
 */
export function buildChatPrompt(
  ctx: ServerContext,
  message: string,
  opts: {
    effects?: string[];
    animationId?: string | null;
    reference?: any;
    skillId?: string | null;
    skillBlock?: string;
    appName?: string;
  } = {},
): string {
  const { effects = [], animationId = null, reference = null, skillId = null, appName } = opts;

  // Auto-detect useAI from existing app code
  const appDir = currentAppDir(ctx, appName) || ctx.projectRoot;
  const appJsxPath = join(appDir, 'app.jsx');
  const useAI = existsSync(appJsxPath) && readFileSync(appJsxPath, 'utf-8').includes('useAI(');

  let effectBlock = '';
  let referenceBlock = '';
  let skillBlock = '';

  // New animation catalog system — single animation selection
  if (animationId) {
    const instructions = getAnimationInstructions(ctx, animationId);
    if (instructions) {
      const animMeta = ctx.animations.find(a => a.id === animationId);
      const animName = animMeta ? animMeta.name : animationId;
      effectBlock = `\n\nANIMATION MODIFIER: "${animName}" (${animationId})
The user selected this animation effect — you MUST implement it in the app.

${instructions}

ANIMATION RULES:
- Use ONLY native browser APIs (Canvas 2D, WebGL, CSS @property, IntersectionObserver, SVG SMIL) — no external libraries
- All Canvas/WebGL must use useRef + useEffect with proper cleanup (cancelAnimationFrame + removeEventListener)
- Background effects: position fixed, zIndex 0, pointerEvents none
- Performance: devicePixelRatio for retina, rAF for animations, passive scroll listeners`;
    }
  }

  // Legacy effect chips support (backward compat with preview.html)
  if (!animationId && effects.length > 0) {
    const instructions = effects
      .filter(e => EFFECT_INSTRUCTIONS[e])
      .map(e => EFFECT_INSTRUCTIONS[e]);
    if (instructions.length > 0) {
      effectBlock = `\n\nEFFECT MODIFIERS (the user toggled these — you MUST implement them):\n${instructions.join('\n\n')}

EFFECT RULES:
- Use ONLY native browser APIs (Canvas 2D, WebGL, CSS @property, IntersectionObserver, SVG SMIL) — no external libraries
- All Canvas/WebGL must use useRef + useEffect with proper cleanup (cancelAnimationFrame + removeEventListener)
- Background effects: position fixed, zIndex 0, pointerEvents none
- Performance: devicePixelRatio for retina, rAF for animations, passive scroll listeners`;
    }
  }

  // Reference file — image or HTML the user wants the app styled after
  if (reference && reference.name && reference.dataUrl) {
    referenceBlock = buildReferenceBlock(ctx, reference);
  }

  // Skill context — use pre-built block or build from skillId
  if (opts.skillBlock) {
    skillBlock = opts.skillBlock;
  } else if (skillId) {
    const result = buildSkillBlock(ctx, skillId, { lastSkillId: null, messageCount: 0 });
    skillBlock = result.block;
  }

  // Auto-inject reference files based on user message keywords
  const referenceGuides = detectReferences(ctx, message);

  const prompt = `${skillBlock}${referenceGuides}${referenceBlock}The user is iterating on a React app in app.jsx. Read app.jsx first, then Edit it.

User says: "${message}"${effectBlock}

RULES:
- Read app.jsx, then Edit ONLY what the user asked for
- ADD to the existing app — never rewrite from scratch
- Preserve all components, hooks, state, data models, __VIBES_THEMES__, useVibesTheme()
- Do NOT add imports, do NOT use TypeScript, keep export default App
- TinyBase hooks (useRowIds, useCell, useAddRowCallback, etc.) are PRE-EXISTING GLOBALS. NEVER import, redeclare, or alias them.
- useApp() returns { isReady, isSyncing }. For user identity, use useUser() which returns { isSignedIn, user } where user has .email, .id, .firstName.
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.
- Never rename table names or cell names — users would lose data
- Table names are always simple string literals ('todos', 'items'). Never refactor them into variables or constants.${useAI ? AI_INSTRUCTIONS_CHAT : ''}
${RECENCY_REMINDER}`;

  return prompt;
}

// --- Generate prompt builder ---

/**
 * Build the prompt for generating a new app from scratch.
 *
 * Returns the prompt string plus metadata needed by the caller
 * (themeId, themeName, appDir, whether it's a reference-based generation).
 */
export function buildGeneratePrompt(
  ctx: ServerContext,
  userPrompt: string,
  opts: {
    themeId?: string;
    reference?: any;
    useAI?: boolean;
  } = {},
): { prompt: string; themeId: string; themeName: string; isReference: boolean; isHtmlRef: boolean; referenceIntent: string } {
  const { reference = null, useAI = false } = opts;
  let { themeId } = opts;

  const stylePath = join(ctx.projectRoot, 'skills/vibes/defaults/style-prompt.txt');
  let styleGuide = '';
  try {
    styleGuide = readFileSync(stylePath, 'utf-8');
  } catch (e) {
    // style-prompt.txt not available
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
      const inlined = htmlContent;

      console.log(`[prompt-builders] HTML reference: ${reference.name}, ${htmlContent.length} chars, FULL INLINE (no truncation)`);
      referenceBlock = `=== DESIGN REFERENCE (HTML: "${reference.name}") ===

Study this HTML file's design — colors, typography, spacing, layout, surfaces, effects — and use it as your design spec.

\`\`\`html
${inlined}
\`\`\`

Before extracting, quote the key CSS rules from the HTML above — the :root variables, color values, font-family declarations, and major class styles. Then extract the visual design:
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

    const referenceGuides = detectReferences(ctx, userPrompt, { alwaysIncludeBugPrevention: true });

    const refPrompt = `${referenceBlock}You are an expert React app designer. Generate a beautiful, creative app.

=== NON-NEGOTIABLE DATA RULES ===${RECENCY_REMINDER}
${referenceGuides}
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
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.
- Responsive (mobile-first with Tailwind). className="btn" for buttons, "grid-background" on root

${THEME_SECTION_MARKERS}
${useAI ? AI_INSTRUCTIONS_GENERATE : ''}`;

    return {
      prompt: refPrompt,
      themeId: 'custom-ref',
      themeName: 'Custom Reference',
      isReference: true,
      isHtmlRef,
      referenceIntent: intent,
    };
  }

  // Normal theme path — no design reference
  const isAuto = !themeId;

  if (isAuto) {
    themeId = autoSelectTheme(ctx, userPrompt);
  }

  const themeName = (ctx.themes.find(t => t.id === themeId) || {} as any).name || themeId;
  const txtFile = join(ctx.themeDir, `${themeId}.txt`);
  const mdFile = join(ctx.themeDir, `${themeId}.md`);
  const themeFilePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : '';

  let themeContent = '';
  if (themeFilePath) {
    themeContent = readFileSync(themeFilePath, 'utf-8');
  }

  const genColors = parseThemeColors(ctx.themeDir, themeId);
  let rootCss = genColors?.rootBlock || '';
  if (!rootCss) {
    const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
    if (rootMatch) rootCss = rootMatch[0];
  }

  let themeEssentials = themeContent
    .replace(/REFERENCE STYLES[\s\S]*?(?=\n[A-Z]{2,}[A-Z ]*[:|\n]|$)/, '')
    .replace(/```css[\s\S]*?```/g, '')
    .trim();
  if (themeEssentials.length > 4000) themeEssentials = themeEssentials.slice(0, 4000) + '\n...';

  const referenceGuides = detectReferences(ctx, userPrompt, { alwaysIncludeBugPrevention: true });

  const prompt = `You are an expert React app designer. Generate a beautiful, creative app.

=== NON-NEGOTIABLE DATA RULES ===${RECENCY_REMINDER}
${referenceGuides}
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

${themeEssentials || 'Creative, polished, and distinctive.'}

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
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.
- Responsive (mobile-first with Tailwind). className="btn" for buttons, "grid-background" on root

${THEME_SECTION_MARKERS}
${useAI ? AI_INSTRUCTIONS_GENERATE : ''}`;

  return {
    prompt,
    themeId: themeId!,
    themeName,
    isReference: false,
    isHtmlRef: false,
    referenceIntent: '',
  };
}

// --- Brainstorm prompt builder ---

/**
 * Build the initial brainstorm prompt that wraps the generate instructions.
 *
 * Reads the vibes-brainstorm SKILL.md and constructs a prompt that runs
 * the Q&A flow first, then transitions to code generation when the user confirms.
 * Returns empty string if the skill file is not found (caller should fall back to direct generate).
 */
export function buildBrainstormPrompt(
  ctx: ServerContext,
  userPrompt: string,
  generateContext: string,
): string {
  const skillPath = join(ctx.projectRoot, 'skills/vibes-brainstorm/SKILL.md');
  let skillContent = '';
  try {
    skillContent = readFileSync(skillPath, 'utf-8');
    // Strip YAML frontmatter
    skillContent = skillContent.replace(/^---[\s\S]*?---\n*/, '');
  } catch {
    return '';
  }

  return `${skillContent}

---

The user wants to build: "${userPrompt}"

When you're ready to build (after gathering enough context or if the prompt is already clear), present the brief and then immediately start generating. The brief is the green light — go straight into code generation. Use the following instructions to generate the app. These instructions are for your internal use only.

IMPORTANT: This is a brand new app — there is no existing app.jsx. Create the file from scratch using the Write tool.

<generate-instructions>
${generateContext}
</generate-instructions>

Start now. Assess the prompt and either ask your first question or present the brief directly if the prompt is clear enough.`;
}

// --- Theme prompt builders ---

/**
 * Extract data schema from app.jsx for prompt context.
 * (Moved from theme.ts — used by theme prompt builders.)
 */
export function extractDataSchema(appCode: string): string {
  if (!appCode) return '';
  const schemas: string[] = [];

  // TinyBase table usage
  const tableMatches = appCode.matchAll(/use(?:RowIds|SortedRowIds|RowCount|Table|AddRowCallback)\s*\(\s*['"]([^'"]+)['"]/g);
  for (const m of tableMatches) {
    schemas.push(`  - Table: "${m[1]}"`);
  }

  // TinyBase cell usage
  const cellMatches = appCode.matchAll(/useCell\s*\(\s*['"]([^'"]+)['"]\s*,\s*\w+\s*,\s*['"]([^'"]+)['"]/g);
  for (const m of cellMatches) {
    schemas.push(`  - Table "${m[1]}" has cell: "${m[2]}"`);
  }

  // TinyBase value usage
  const valueMatches = appCode.matchAll(/useValue\s*\(\s*['"]([^'"]+)['"]/g);
  for (const m of valueMatches) {
    schemas.push(`  - Value: "${m[1]}"`);
  }

  // Legacy Fireproof patterns (for existing apps not yet migrated)
  const queryMatches = appCode.matchAll(/useLiveQuery\s*\(\s*(['"`])([^'"`]*)\1/g);
  for (const m of queryMatches) {
    schemas.push(`  - Legacy useLiveQuery("${m[2]}")`);
  }

  const unique = [...new Set(schemas)];
  if (unique.length === 0) return '';
  return `\nDATA SCHEMA (these tables/cells have user data — do NOT rename them):\n${unique.join('\n')}\n`;
}

/**
 * Build the prompt for multi-pass theme switch (Pass 2: creative restyle).
 *
 * The caller (theme.ts) handles Pass 1 (mechanical token replacement) and
 * passes in the updated app code for Pass 2 prompt construction.
 */
export function buildThemePromptMultiPass(
  ctx: ServerContext,
  themeId: string,
  themeName: string,
  themeContent: string,
  pass1Code: string,
): string {
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

${extractPass2ThemeContext(themeContent, 12000)}

=== RULES ===

- Replace the content BETWEEN each marker pair. Keep the markers themselves.
- Match the theme's personality: shadows, glass effects, gradients, animations, SVG decorations.
- Do NOT modify anything outside the markers — no layout, no logic, no tokens, no typography.
- If you need to change anything outside a marker, STOP and explain why instead of editing.
- No import statements, no TypeScript, keep export default App.
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.
${extractDataSchema(pass1Code)}`;

  return prompt;
}

/**
 * Build the prompt for legacy theme switch (full-file Claude restyle, no markers).
 */
export function buildThemePromptLegacy(
  ctx: ServerContext,
  themeId: string,
  themeName: string,
  themeContent: string,
  appCode: string,
  colors: any,
): string {
  let rootCss = colors?.rootBlock || '';
  if (!rootCss) {
    const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
    if (rootMatch) rootCss = rootMatch[0];
  }

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

${extractPass2ThemeContext(themeContent, 14000)}

=== RULES ===

CHANGE (visual only):
- :root CSS variables → use the EXACT block above
- Backgrounds, shadows, borders, fonts → match theme's design principles
- Animations, SVG elements → match theme's mood
- __VIBES_THEMES__ and useVibesTheme default → "${themeId}"
- Create a fresh creative layout that matches the theme personality

KEEP UNCHANGED:
- All components, hooks, functions, state, data models, layout structure
- All TinyBase hooks, table names, cell names, data models
- No import statements, no TypeScript, keep export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.`;

  return prompt;
}

// --- Internal helpers ---

/**
 * Build the reference block for chat prompts (image or HTML reference).
 */
function buildReferenceBlock(ctx: ServerContext, reference: any): string {
  const isHtml = /\.html?$/i.test(reference.name);
  const intent = reference.intent || 'match';
  const base64 = reference.dataUrl.split(',')[1];
  const tmpDir = join(ctx.projectRoot, '.vibes-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const refPath = join(tmpDir, reference.name);

  if (isHtml) {
    const htmlContent = Buffer.from(base64, 'base64').toString('utf-8');
    writeFileSync(refPath, htmlContent, 'utf-8');
    return `DESIGN REFERENCE (HTML file: "${reference.name}"):
You MUST match this HTML file's design language — colors, typography, spacing, layout patterns, and overall aesthetic — when styling the app. Study the CSS and structure carefully and apply the same visual treatment.

\`\`\`html
${htmlContent}
\`\`\`

Now update the app's CSS token system to match this HTML:
1. REPLACE the :root block (or /* @theme:tokens */ section if markers exist) with new --comp-* oklch() values extracted from the HTML's CSS:
   --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background, --grid-color
2. Update /* @theme:surfaces */ section (if markers exist) — shadows, borders, glass effects matching the HTML.
3. Update /* @theme:motion */ section (if markers exist) — animations matching the HTML's effects.
4. Update window.__VIBES_THEMES__ = [{ id: "custom-ref", name: "Custom Reference" }] and the useVibesTheme default to "custom-ref".
5. --color-background MUST match the HTML's background color. Never leave it transparent or unset.

`;
  }

  // Save image to disk so Claude can read it visually
  writeFileSync(refPath, Buffer.from(base64, 'base64'));

  if (intent === 'none') {
    return `The user attached an image: ${refPath}. Read it with the Read tool if relevant to their message.

`;
  }

  if (intent === 'mood') {
    return `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

ANALYZE the image like a theme designer — before writing any code, identify:
- MOOD: 3-4 adjectives describing the visual feeling (e.g. "warm, editorial, minimal, earthy")
- COLOR PALETTE: extract every distinct color as oklch() — background, text, accent, borders, muted tones
- DESIGN PRINCIPLES: border styles (sharp/rounded/none), shadow depth (flat/subtle/dramatic), spacing rhythm (tight/airy)
- TYPOGRAPHY FEEL: weight (light/bold/mixed), style (serif/sans/mono), sizing hierarchy
- SURFACE TREATMENT: glass/frosted effects, gradients, textures, card styles
- MOTION ENERGY: calm/lively/dramatic — what kind of transitions and hover effects fit
- DECORATIVE ELEMENTS: any SVG patterns, background shapes, dividers, icons style
- BEST FOR: what types of apps would this aesthetic suit
- NOT FOR: what types of apps would clash with this mood

Now apply as a THEME — update the app's CSS token system:

1. REPLACE the :root block (or /* @theme:tokens */ section if markers exist) with new --comp-* oklch() values extracted from the image:
   --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background, --grid-color
2. Update /* @theme:surfaces */ section (if markers exist) — shadows, borders, glass effects matching your analysis.
3. Update /* @theme:motion */ section (if markers exist) — animations matching the energy you identified.
4. Update /* @theme:decoration */ section (if markers exist) — SVG/decorative elements matching the mood.
5. Update window.__VIBES_THEMES__ = [{ id: "custom", name: "Custom Theme" }] and the useVibesTheme default to "custom".
6. --color-background MUST match the image's background. Never leave it transparent or unset.

Do NOT change layout, component structure, grid/flex arrangements, or functionality.
Keep the existing layout exactly — only transform colors, typography feel, surfaces, motion, and decoration.

`;
  }

  // intent === 'match' (default)
  return `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

ANALYZE the image like a theme designer — before writing any code, identify:
- MOOD: 3-4 adjectives describing the visual feeling (e.g. "dark, technical, dense, neon")
- COLOR PALETTE: extract every distinct color as oklch() — background, text, accent, borders, muted tones
- DESIGN PRINCIPLES: border styles (sharp/rounded/none), shadow depth (flat/subtle/dramatic), spacing rhythm (tight/airy)
- TYPOGRAPHY FEEL: weight (light/bold/mixed), style (serif/sans/mono), sizing hierarchy
- SURFACE TREATMENT: glass/frosted effects, gradients, textures, card styles
- MOTION ENERGY: calm/lively/dramatic — what kind of transitions and hover effects fit
- DECORATIVE ELEMENTS: any SVG patterns, background shapes, dividers, icons style
- LAYOUT STRUCTURE: how is the space divided? sidebar? header? grid? cards? split-pane? tabs?
- BEST FOR: what types of apps would this aesthetic suit
- NOT FOR: what types of apps would clash with this design
- ADAPTATION NOTES: how to handle tables, forms, lists, charts in this visual style

Now apply as a FULL THEME + LAYOUT — this is a complete visual redesign:

THEME TOKENS:
1. REPLACE the :root block (or /* @theme:tokens */ section if markers exist) with new --comp-* oklch() values extracted from the image:
   --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background, --grid-color
2. Update /* @theme:surfaces */ — shadows, borders, glass effects matching your analysis.
3. Update /* @theme:motion */ — animations matching the energy you identified.
4. Update /* @theme:decoration */ — SVG/decorative elements matching the mood.
5. Update window.__VIBES_THEMES__ = [{ id: "custom", name: "Custom Theme" }] and the useVibesTheme default to "custom".
6. --color-background MUST match the image's background. Never leave it transparent or unset.

LAYOUT REBUILD:
- Grid/flex structure, component arrangement, spacing, sizing, positioning, navigation placement, card layouts, sidebar/header/footer structure — match the spatial organization of the image.
- Typography hierarchy, font sizes, weights, letter-spacing — match what you see.
- All visual details: rounded corners, padding, margins, gaps, border-radius values.

PRESERVE: all TinyBase hooks (useRowIds, useCell, useAddRowCallback, useSetCellCallback, useSortedRowIds, useDelRowCallback), data tables/cells, all functional logic, and the user's actual data. Every piece of data and functionality must still work.
The goal is: if you put the app and the image side by side, they should look like the same UI.

`;
}

/**
 * Build the skill context block with deduplication support.
 *
 * Returns the full SKILL.md content on first use or when the skill changes,
 * and a short reminder on subsequent messages with the same skill.
 * Resets to full content every 5 messages to prevent drift.
 */
export function buildSkillBlock(
  ctx: any,
  skillId: string,
  dedupState: { lastSkillId: string | null; messageCount: number },
): { block: string; newState: { lastSkillId: string | null; messageCount: number } } {
  const skill = (ctx.pluginSkills || []).find((s: any) => s.id === skillId);
  if (!skill || !existsSync(skill.skillMdPath)) {
    return { block: '', newState: dedupState };
  }

  const count = dedupState.messageCount + 1;
  const needsFull = skillId !== dedupState.lastSkillId || count >= 5;

  if (needsFull) {
    const content = readFileSync(skill.skillMdPath, 'utf-8');
    return {
      block: `\nSKILL CONTEXT: "${skill.name}"\n\n${content}\n`,
      newState: { lastSkillId: skillId, messageCount: 0 },
    };
  }

  return {
    block: `\n(Using skill: "${skill.name}" — full guidance was provided earlier)\n`,
    newState: { lastSkillId: skillId, messageCount: count },
  };
}
