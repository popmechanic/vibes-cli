/**
 * Chat handler — iterative edits to app.jsx via Claude.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runClaude } from '../claude-bridge.js';
import { sanitizeAppJsx } from '../post-process.js';
import { getAnimationInstructions } from '../config.js';
import { currentAppDir } from '../app-context.js';

const EFFECT_INSTRUCTIONS = {
  '3d': `MANDATORY: Use WebGL or CSS 3D transforms (perspective, rotateX/Y/Z, preserve-3d) for this feature. Create actual 3D depth — not flat elements with shadows. Consider: rotating 3D cards, perspective grids, WebGL scenes with Three.js-style raw GL, isometric layouts, parallax depth layers. Use useRef + useEffect for any canvas/WebGL setup with proper cleanup.`,
  'animated': `MANDATORY: Add rich CSS & JS animations. Use @keyframes, CSS transitions, requestAnimationFrame loops, staggered animation-delay on lists, scroll-triggered reveals with IntersectionObserver, @property for animated gradients, clip-path morphing, and entrance/exit animations. Everything should feel alive and in motion.`,
  'interactive': `MANDATORY: Make elements respond to user interaction. Add mouse-follow effects (cursor glow, tilt cards on hover with perspective), drag & drop, hover state morphs, click-triggered path drawing, SMIL animate on mouseover/mouseout, parallax on scroll, and mouse-reactive particle displacement. Use onMouseMove with getBoundingClientRect for position tracking.`,
  'particles': `MANDATORY: Add a Canvas 2D particle system background. Use useRef + useEffect with requestAnimationFrame. Create floating particles that drift, connect particles with lines when close, add mouse-reactive displacement. Use devicePixelRatio for retina, keep count under 100 for mobile. The particles should be behind content with position:fixed, zIndex:0, pointerEvents:none.`,
  'shader': `MANDATORY: Add a WebGL fragment shader background. Create a fullscreen quad with vertex shader, pass u_time/u_resolution/u_mouse uniforms. Use effects like: aurora (sine wave color mixing), plasma (layered sine interference), noise gradient mesh (hash-based noise with mouse reactivity), or animated color fields. Use precision mediump float. Graceful fallback if WebGL unavailable.`,
};

export async function handleChat(ctx, onEvent, message, effects = [], animationId = null, model, reference = null) {
  let effectBlock = '';
  let referenceBlock = '';

  console.log(`[Chat] reference received:`, reference ? { name: reference.name, type: reference.type, hasDataUrl: !!reference.dataUrl, dataUrlLen: reference.dataUrl?.length } : null);

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
    const isHtml = /\.html?$/i.test(reference.name);
    const intent = reference.intent || 'match';
    const base64 = reference.dataUrl.split(',')[1];
    const tmpDir = join(ctx.projectRoot, '.vibes-tmp');
    mkdirSync(tmpDir, { recursive: true });
    const refPath = join(tmpDir, reference.name);

    if (isHtml) {
      const htmlContent = Buffer.from(base64, 'base64').toString('utf-8');
      writeFileSync(refPath, htmlContent, 'utf-8');
      referenceBlock = `DESIGN REFERENCE (HTML file: "${reference.name}"):
You MUST match this HTML file's design language — colors, typography, spacing, layout patterns, and overall aesthetic — when styling the app. Study the CSS and structure carefully and apply the same visual treatment.

\`\`\`html
${htmlContent.slice(0, 15000)}
\`\`\`

`;
    } else {
      // Save image to disk so Claude can read it visually
      writeFileSync(refPath, Buffer.from(base64, 'base64'));

      if (intent === 'none') {
        referenceBlock = `The user attached an image: ${refPath}. Read it with the Read tool if relevant to their message.

`;
      } else if (intent === 'mood') {
        referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

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
      } else {
        // intent === 'match' (default)
        referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

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

PRESERVE: all Fireproof hooks (useDocument, useLiveQuery), database.put/del calls, data models, all functional logic, and the user's actual data. Every piece of data and functionality must still work.
The goal is: if you put the app and the image side by side, they should look like the same UI.

`;
      }
    }
  }

  const prompt = `${referenceBlock}The user is iterating on a React app in app.jsx. Read app.jsx first, then Edit it.

User says: "${message}"${effectBlock}

RULES:
- Read app.jsx, then Edit ONLY what the user asked for
- ADD to the existing app — never rewrite from scratch
- Preserve all components, hooks, state, data models, __VIBES_THEMES__, useVibesTheme()
- Do NOT add imports, do NOT use TypeScript, keep export default App
- Never use CSS unicode escapes (\\2192, \\2022, \\00BB). Use actual Unicode characters instead: → ● « etc. CSS escapes break Babel.
- Never change Fireproof document types or query filters`;

  const maxTurns = (animationId || effects.length > 0 || reference) ? 12 : 8;
  await runClaude(prompt, { maxTurns, model, cwd: currentAppDir(ctx) || ctx.projectRoot, tools: 'Read,Edit,Write,Glob,Grep' }, onEvent);

  sanitizeAppJsx(ctx.projectRoot);
}
