/**
 * Generate handler — create a new app from scratch via Claude.
 * Uses one-shot spawn with HMR time-lapse preview.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { runOneShot, acquireLock, releaseLock, type EventCallback } from '../claude-bridge.ts';
import { autoSelectTheme, parseThemeColors, extractPass2ThemeContext } from '../config.ts';
import type { ServerContext } from '../config.ts';
import { stripForTemplate } from '../../lib/strip-code.js';
import { APP_PLACEHOLDER } from '../../lib/assembly-utils.js';
import { loadEnvFile, populateConnectConfig } from '../../lib/env-utils.js';
import { TEMPLATES } from '../../lib/paths.js';
import { createHmrWatcher } from '../hmr.ts';
import { broadcast } from '../ws.ts';

/**
 * Generate a new app from a user prompt.
 */
export async function handleGenerate(
  ctx: ServerContext,
  onEvent: EventCallback,
  userPrompt: string,
  themeId: string | undefined,
  model: string | undefined,
  reference: any = null,
): Promise<void> {
  if (!userPrompt) {
    onEvent({ type: 'error', message: 'Please describe what you want to build.' });
    return;
  }

  let cancelFn = () => {};
  if (!acquireLock('generate', () => cancelFn())) {
    onEvent({ type: 'error', message: 'Another request is in progress. Please wait.' });
    return;
  }

  console.log(`[Generate] START prompt="${userPrompt.slice(0, 60)}" themeId=${themeId || '(auto)'}`);

  // Auto-archive existing app.jsx
  const appJsxPath = join(ctx.projectRoot, 'app.jsx');
  if (existsSync(appJsxPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `auto-${ts}`;
    const dest = join(ctx.appsDir, archiveName);
    mkdirSync(dest, { recursive: true });
    copyFileSync(appJsxPath, join(dest, 'app.jsx'));
    unlinkSync(appJsxPath);
    onEvent({ type: 'app_archived', name: archiveName });
    console.log(`[Generate] Archived existing app.jsx -> ${archiveName}`);
  }

  const stylePath = join(ctx.projectRoot, 'skills/vibes/defaults/style-prompt.txt');
  let styleGuide = '';
  try {
    styleGuide = readFileSync(stylePath, 'utf-8');
    console.log(`[Generate]   styleGuide: ${(styleGuide.length / 1024).toFixed(1)}KB (inlined)`);
  } catch (e: any) {
    console.log(`[Generate]   Could not read style-prompt.txt: ${e.message}`);
  }

  const isAuto = !themeId;
  if (isAuto) {
    themeId = autoSelectTheme(ctx, userPrompt);
    console.log(`[Generate]   autoSelectTheme => "${themeId}"`);
  } else {
    console.log(`[Generate]   user selected theme: "${themeId}"`);
  }

  const themeName = (ctx.themes.find((t: any) => t.id === themeId) || {} as any).name || themeId;
  const txtFile = join(ctx.themeDir, `${themeId}.txt`);
  const mdFile = join(ctx.themeDir, `${themeId}.md`);
  const themeFilePath = existsSync(txtFile) ? txtFile : existsSync(mdFile) ? mdFile : '';

  let themeContent = '';
  if (themeFilePath) {
    themeContent = readFileSync(themeFilePath, 'utf-8');
    console.log(`[Generate]   themeFile: ${(themeContent.length / 1024).toFixed(1)}KB — "${themeName}"`);
  }

  const genColors = parseThemeColors(ctx.themeDir, themeId!);
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

  let referenceBlock = '';
  if (reference && reference.name && reference.dataUrl) {
    const intent = reference.intent || 'match';
    const base64 = reference.dataUrl.split(',')[1];
    const tmpDir = join(ctx.projectRoot, '.vibes-tmp');
    mkdirSync(tmpDir, { recursive: true });
    const refPath = join(tmpDir, reference.name);
    writeFileSync(refPath, Buffer.from(base64, 'base64'));
    console.log(`[Generate]   reference image saved: ${refPath} (intent: ${intent})`);

    if (intent === 'mood') {
      referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

ANALYZE the image like a theme designer — identify MOOD, COLOR PALETTE, DESIGN PRINCIPLES, etc.
Apply the MOOD and COLOR PALETTE from this image. Use extracted oklch() colors for --comp-* tokens INSTEAD of theme colors.
--color-background MUST match the image's background.

`;
    } else {
      referenceBlock = `MANDATORY FIRST STEP: Read the image at ${refPath} using the Read tool.

ANALYZE the image — identify MOOD, COLOR PALETTE, LAYOUT STRUCTURE, etc.
Apply BOTH the visual style AND layout structure from this image.
Use extracted oklch() colors for --comp-* tokens INSTEAD of theme colors.
--color-background MUST match the image's background.

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
- What animations and effects match the theme mood?

=== WRITE app.jsx ===

Write the complete app to app.jsx. Rules:
- FIRST: the exact __VIBES_THEMES__ + useVibesTheme code shown above
- THEN: <style> tag with theme-sensitive CSS in marked sections
- Add rich visual effects: Canvas 2D backgrounds, animated SVG illustrations, CSS @property animations
- JSX with React hooks (useState, useEffect, useRef, useCallback, useMemo)
- useFireproofClerk("db-name") for database
- NO import statements — runs in Babel script block with globals
- NO TypeScript. End with: export default App
- Never use CSS unicode escapes. Use actual Unicode characters.
- Responsive (mobile-first). className="btn" for buttons, "grid-background" on root

=== THEME SECTION MARKERS ===

Organize ALL visual CSS into marked sections:

\`\`\`css
/* @theme:tokens */
:root { --comp-bg: ...; --comp-text: ...; }
/* @theme:tokens:end */

/* @theme:typography */
@import url('...');
/* @theme:typography:end */

/* @theme:surfaces */
.glass-card { backdrop-filter: ...; }
/* @theme:surfaces:end */

/* @theme:motion */
@keyframes drift { ... }
/* @theme:motion:end */
\`\`\`

DATABASE: useDocument({text:"",type:"item"}), useLiveQuery("type",{key:"item"}), database.put/del`;

  onEvent({ type: 'theme_selected', themeId, themeName });

  // Start HMR time-lapse
  const hmr = createHmrWatcher(ctx, broadcast);
  hmr.start();

  const wrappedOnEvent: EventCallback = (event) => {
    onEvent(event);
    if (event.type === 'tool_result') {
      hmr.onToolResult(event);
    }
  };

  const maxTurns = reference ? 8 : 5;
  console.log(`[Generate] Starting — theme: ${themeId} (${themeName}), prompt: ${(prompt.length / 1024).toFixed(1)}KB`);

  try {
    await runOneShot(prompt, {
      skipChat: true,
      maxTurns,
      model,
      cwd: ctx.projectRoot,
      tools: 'Write',
      onCancel: (fn) => { cancelFn = fn; },
    }, wrappedOnEvent, ctx.projectRoot);
  } finally {
    hmr.stop();
    releaseLock();
  }
}

/**
 * Assemble app.jsx into the vibes template with Fireproof bundle + Clerk auth.
 * Used by the /app-frame route and HMR.
 * Optional `code` parameter allows passing pre-read/validated code for HMR.
 */
export function assembleAppFrame(ctx: ServerContext, code?: string): string {
  const templatePath = TEMPLATES.vibesBasic;
  if (!existsSync(templatePath)) {
    return `<html><body><h1>Template not found</h1><p>${templatePath}</p></body></html>`;
  }

  let template = readFileSync(templatePath, 'utf-8');

  const appPath = join(ctx.projectRoot, 'app.jsx');

  // If code is provided, use it directly. Otherwise read from disk.
  const appCode = code ?? (existsSync(appPath) ? readFileSync(appPath, 'utf-8') : null);
  if (!appCode) {
    return `<html><body><h1>app.jsx not found</h1></body></html>`;
  }

  const strippedCode = stripForTemplate(appCode, { stripReactHooks: false });

  if (!template.includes(APP_PLACEHOLDER)) {
    return `<html><body><h1>Template missing placeholder</h1><p>${APP_PLACEHOLDER}</p></body></html>`;
  }
  template = template.replace(APP_PLACEHOLDER, strippedCode);

  const envVars = loadEnvFile(ctx.projectRoot);
  template = populateConnectConfig(template, envVars);

  if (!envVars.VITE_API_URL || !envVars.VITE_CLOUD_URL) {
    if (!(assembleAppFrame as any)._warnedMissingConnect) {
      (assembleAppFrame as any)._warnedMissingConnect = true;
      console.log('[preview] Connect URLs not configured — sync disabled until first deploy');
    }
  }

  return template;
}
