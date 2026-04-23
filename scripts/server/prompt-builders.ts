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
import { resolveProjectDir } from './app-context.js';
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

/**
 * The boilerplate JSX block every generated app.jsx must start with.
 * Shared between the reference and non-reference paths.
 */
function USE_VIBES_THEME_TEMPLATE(themeId: string, themeName: string): string {
  return `\`\`\`jsx
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
\`\`\``;
}

/**
 * Cross-cutting rules that apply to every step of the 2-step generation.
 * Kept in one place so the reference and non-reference prompts share identical text.
 */
const GLOBAL_STEP_RULES = `=== RULES THAT APPLY TO ALL STEPS ===

- NO import statements — the app runs in a Babel script block with globals
- NO TypeScript. End the file with: export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters: → ● « etc. CSS escapes break Babel.
- Responsive (mobile-first with Tailwind). Use className="btn" for buttons, className="grid-background" on the root element.
- TinyBase hooks (useRowIds, useCell, useAddRowCallback, useSetCellCallback, useDelRowCallback, useValue, useSortedRowIds, useTable) are PRE-EXISTING GLOBALS. NEVER import, redeclare, or alias them.
- Table names must be string literals: useRowIds('todos'), never useRowIds(tableName).
- Cells are scalars only (string/number/boolean) — no nested objects or arrays.
- No sync/connection status UI, not even decorative ("Online", "LIVE", "Connected") — SyncStatusDot is built-in.
- useApp() is mandatory in root App. It returns { isReady, isSyncing, user }.`;

/**
 * The core new behavior: tell Claude to produce the app via two tool calls.
 * Claude Code's native tool loop turns each tool_result into a new assistant turn
 * with its own fresh max_tokens budget — so we don't need server-side orchestration.
 */
const TWO_STEP_INSTRUCTIONS = `=== BUILD app.jsx IN TWO TOOL CALLS ===

Build this app in two separate tool calls, in order. Each step has a specific purpose; do not try to do everything in one call.

STEP 1 — Write app.jsx: the visible skeleton.
Produce a file that compiles and renders the app's basic shape — even without data or interactions. Include:
- The exact __VIBES_THEMES__ + useVibesTheme code from above (unchanged)
- A <style> tag with :root tokens and the four marker sections (/* @theme:tokens */, /* @theme:surfaces */, /* @theme:motion */, {/* @theme:decoration */}) present even when their contents are empty, plus base layout CSS
- A functioning component tree with visible elements: header with the app title, main content area, whatever structural regions fit this app (sidebar/nav/footer as needed). Components render placeholder/empty states but the layout is real.
- Basic React hooks for local UI state (useState). NO TinyBase hooks yet. NO event handlers yet.
- export default App

After STEP 1 the preview should look like the final app in colors, typography, and layout — just without data or polish.

STEP 2 — Edit app.jsx: data, interactions, and polish.
Read app.jsx (the skeleton you just wrote), then Edit it to add everything else:
- TinyBase hooks (useRowIds, useCell, useAddRowCallback, useSetCellCallback, useDelRowCallback, useValue)
- React event handlers, effects, refs
- useApp() integration; useAI wiring if the app needs it
- Inside the @theme:surfaces marker: shadows, borders, gradients, glass effects
- Inside the @theme:motion marker: @keyframes, CSS @property animations, hover effects
- Inside the @theme:decoration marker: SVG illustrations, Canvas 2D or WebGL backgrounds, decorative patterns

After STEP 2 the app is complete.

IMPORTANT: Do NOT produce a <design> narrative before STEP 1. Any design notes belong inside CSS comments in the <style> tag. Narrative prose counts against the same output budget as your code.`;

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
  const appDir = resolveProjectDir(ctx, appName) || ctx.projectRoot;
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

  // Reference file — image, HTML, text, or data file
  if (reference && reference.name && (reference.serverPath || reference.dataUrl || reference.textContent)) {
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
  const hasRef = reference && reference.name && (reference.serverPath || reference.dataUrl || reference.textContent);
  if (hasRef) {
    const isHtmlRef = /\.html?$/i.test(reference.name);
    const intent = reference.intent || 'match';
    const refPath = resolveRefPath(ctx, reference);

    let referenceBlock = '';

    if (isHtmlRef) {
      const htmlContent = readFileSync(refPath, 'utf-8');
      const inlined = htmlContent;

      console.log(`[prompt-builders] HTML reference: ${reference.name}, ${htmlContent.length} chars, FULL INLINE (no truncation)`);
      referenceBlock = `=== DESIGN REFERENCE (HTML: "${reference.name}") ===

Study this HTML file's design and use it as your design spec:

\`\`\`html
${inlined}
\`\`\`

Extract and apply — keep any design notes inside CSS comments in the generated file, NOT as narrative prose in the assistant message (output budget is precious):
- COLOR PALETTE: map every color to oklch() for the --comp-* tokens
- TYPOGRAPHY, SURFACES, LAYOUT, MOTION: mirror the reference
- --color-background MUST match the HTML's background. Never transparent.

`;
    } else if (reference.textContent || (existsSync(refPath) && /\.(txt|md|csv|tsv|json|xml|rtf)$/i.test(reference.name))) {
      // Text file reference in generate path — delegate to buildReferenceBlock
      referenceBlock = buildReferenceBlock(ctx, reference);
    } else {
      // Image/binary reference — file already on disk from upload
      if (intent === 'mood') {
        referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

Extract a complete visual theme from this image and apply it to the generated app.

IMPORTANT: Keep any design analysis inside CSS comments in the generated <style> tag. Do NOT produce a long <design> narrative in the assistant message before the Write — output budget is precious and narrative prose counts against the same ceiling as the app code.

Required extractions (apply directly, don't pre-announce):
- COLOR PALETTE: every distinct color in oklch() — complete :root block with --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background
- TYPOGRAPHY: font families (matching Google Fonts), weights, letter-spacing
- SURFACES: border-radius, shadows, backdrop-filter, gradients
- DECORATIVE ELEMENTS and MOTION ENERGY: match the mood

Use extracted oklch() colors EXACTLY — do not approximate.
--color-background MUST match the image's background. Never transparent.

`;
      } else {
        // intent === 'match'
        referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

Extract a complete visual theme AND layout from this image and apply it to the generated app.

IMPORTANT: Keep any design analysis inside CSS comments in the generated <style> tag. Do NOT produce a long <design> narrative in the assistant message before the Write — output budget is precious and narrative prose counts against the same ceiling as the app code.

Required extractions (apply directly, don't pre-announce):
- COLOR PALETTE: every distinct color in oklch() — complete :root block with --comp-bg, --comp-text, --comp-border, --comp-accent, --comp-accent-text, --comp-muted, --color-background
- TYPOGRAPHY: font families (matching Google Fonts), weights, letter-spacing
- SURFACES: border-radius, shadows, backdrop-filter, gradients
- LAYOUT STRUCTURE: how the space is divided (sidebar/header/grid/cards/tabs), component arrangement, spatial proportions
- DECORATIVE ELEMENTS and MOTION ENERGY: match the mood

Use extracted oklch() colors EXACTLY — do not approximate.
Match the layout structure, spatial organization, and visual hierarchy.
--color-background MUST match the image's background. Never transparent.
Goal: the generated app should look like the image was its design spec.

`;
      }
    }

    const referenceGuides = detectReferences(ctx, userPrompt, { alwaysIncludeBugPrevention: true });

    const refPrompt = `${referenceBlock}You are an expert React app designer. Generate a beautiful, creative app.

=== NON-NEGOTIABLE DATA RULES ===${RECENCY_REMINDER}
${referenceGuides}
USER REQUEST: "${userPrompt}"

Your app.jsx MUST start with these EXACT lines (copy-paste, do not modify):

${USE_VIBES_THEME_TEMPLATE('custom-ref', 'Custom Reference')}

Derive ALL :root CSS tokens from the design reference above — do NOT use any predefined theme.

=== DESIGN GUIDANCE ===

${styleGuide}

=== DESIGN REASONING ===

Briefly note design decisions inside CSS comments in the <style> tag — not as a separate <design> narrative before the Write. Consider:
- Colors, typography, and surfaces extracted from the reference and their mapping to --comp-* tokens
- Custom SVG illustrations that fit
- Animations that match the reference mood (Canvas particles, animated SVG, scroll reveals, card tilt, cursor glow)

${TWO_STEP_INSTRUCTIONS}

${GLOBAL_STEP_RULES}

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

${USE_VIBES_THEME_TEMPLATE(themeId!, themeName)}

Your <style> tag MUST include these EXACT CSS custom properties from the "${themeName}" theme:

\`\`\`css
${rootCss || `/* No :root block found — create one with warm oklch colors matching "${themeName}" */`}
\`\`\`

=== THEME PERSONALITY ===

${themeEssentials || 'Creative, polished, and distinctive.'}

=== DESIGN GUIDANCE ===

${styleGuide}

=== DESIGN REASONING ===

Briefly note design decisions inside CSS comments in the <style> tag — not as a separate <design> narrative before the Write. Consider:
- How "${themeName}" personality shapes visual choices
- What custom SVG illustrations fit this app
- What animations match the theme mood (Canvas particles, animated SVG, scroll reveals, card tilt, cursor glow)

${TWO_STEP_INSTRUCTIONS}

${GLOBAL_STEP_RULES}

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
 * Resolve the on-disk path for a reference file.
 * New flow: file already at serverPath from HTTP upload.
 * Legacy flow: decode base64 dataUrl and write to .vibes-tmp/.
 */
function resolveRefPath(ctx: ServerContext, reference: any): string {
  if (reference.serverPath && existsSync(reference.serverPath)) {
    return reference.serverPath;
  }
  // Legacy: decode base64 dataUrl to .vibes-tmp/
  const tmpDir = join(ctx.projectRoot, '.vibes-tmp');
  mkdirSync(tmpDir, { recursive: true });
  const refPath = join(tmpDir, reference.name);
  if (reference.dataUrl) {
    const base64 = reference.dataUrl.split(',')[1];
    writeFileSync(refPath, Buffer.from(base64, 'base64'));
  } else if (reference.textContent) {
    writeFileSync(refPath, reference.textContent, 'utf-8');
  }
  return refPath;
}

/**
 * Build the reference block for chat prompts (image, HTML, or text reference).
 */
function buildReferenceBlock(ctx: ServerContext, reference: any): string {
  const isHtml = /\.html?$/i.test(reference.name);
  const intent = reference.intent || 'match';
  const refPath = resolveRefPath(ctx, reference);

  if (isHtml) {
    const htmlContent = readFileSync(refPath, 'utf-8');
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

  // Text files — read from disk (uploaded via HTTP POST or written by resolveRefPath)
  const isText = /\.(txt|md|csv|tsv|json|xml|rtf)$/i.test(reference.name);
  if (isText && existsSync(refPath)) {
    const textContent = readFileSync(refPath, 'utf-8');

    if (intent === 'seed') {
      return `FILE REFERENCE: "${reference.name}" (intent: Seed Data)

The user uploaded this file to populate the app's database. Parse the data and design an appropriate TinyBase table schema. Use useAddRowCallback or store.setRow to seed rows on first load (guard with a check so data isn't duplicated on reload).

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
    }

    if (intent === 'content') {
      return `FILE REFERENCE: "${reference.name}" (intent: Content)

The user uploaded this file as content the app should display or reference. Use the <Markdown> component if the content is text/markdown. For structured data (JSON, CSV), design an appropriate UI to present it.

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
    }

    if (intent === 'auto') {
      return `FILE REFERENCE: "${reference.name}"

The user uploaded this file without specifying how to use it. Decide based on the content:
- If it looks like structured data (CSV, TSV, JSON) — parse it and populate TinyBase tables. Guard seeding with a check so data isn't duplicated on reload.
- If it looks like prose, documentation, or markdown — build an app that displays the content. Use the <Markdown> component for rendering.
- Otherwise — use it as background context to inform your design decisions.

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
    }

    // intent === 'context'
    return `FILE REFERENCE: "${reference.name}" (intent: Context)

The user uploaded this file as background context. Use it to inform your design decisions, but do NOT include this content directly in the app.

\`\`\`
${textContent.slice(0, 50000)}
\`\`\`
${textContent.length > 50000 ? '\n(Content truncated — full file at ' + refPath + ')\n' : ''}
`;
  }

  // Image/binary file — already on disk from upload
  if (!existsSync(refPath)) {
    return `The user attached a file: ${reference.name}. The file could not be found on disk.\n\n`;
  }

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
