/**
 * Theme switch handlers — multi-pass (markers) and legacy (full-file) modes.
 * Uses one-shot spawn for Claude creative restyle.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { runOneShot, acquireLock, releaseLock, type EventCallback } from '../claude-bridge.ts';
import { sanitizeAppJsx } from '../post-process.ts';
import { parseThemeColors, extractPass2ThemeContext } from '../config.ts';
import type { ServerContext } from '../config.ts';
import { hasThemeMarkers, replaceThemeSection, extractNonThemeSections, moveVisualCSSToSurfaces } from '../../lib/theme-sections.js';
import { createBackup, restoreFromBackup } from '../../lib/backup.js';

function extractDataSchema(appCode: string): string {
  if (!appCode) return '';
  const schemas: string[] = [];

  const queryMatches = appCode.matchAll(/useLiveQuery\s*\(\s*(['"`])([^'"`]*)\1[^)]*(?:,\s*\{[^}]*type:\s*(['"`])([^'"`]*)\3)?/g);
  for (const m of queryMatches) {
    if (m[4]) schemas.push(`  - useLiveQuery("${m[2]}") filters by type: "${m[4]}"`);
    else schemas.push(`  - useLiveQuery("${m[2]}")`);
  }

  const putMatches = appCode.matchAll(/(?:database|db)\.put\s*\(\s*\{[^}]*type:\s*(['"`])([^'"`]*)\1/g);
  for (const m of putMatches) schemas.push(`  - database.put() creates documents with type: "${m[2]}"`);

  const typeMatches = appCode.matchAll(/(?:doc|item|row|entry|record)\.type\s*===?\s*(['"`])([^'"`]*)\1/g);
  for (const m of typeMatches) schemas.push(`  - Documents filtered by type: "${m[2]}"`);

  const unique = [...new Set(schemas)];
  if (unique.length === 0) return '';
  return `\nDATA SCHEMA (these document types have user data — do NOT rename or change them):\n${unique.join('\n')}\n`;
}

function updateThemeMeta(code: string, themeId: string, themeName: string): string {
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

export async function handleThemeSwitch(
  ctx: ServerContext,
  onEvent: EventCallback,
  themeId: string,
  model: string | undefined,
): Promise<void> {
  const txtFile = join(ctx.themeDir, `${themeId}.txt`);
  const mdFile = join(ctx.themeDir, `${themeId}.md`);
  let themeContent = '';
  if (existsSync(txtFile)) themeContent = readFileSync(txtFile, 'utf-8');
  else if (existsSync(mdFile)) themeContent = readFileSync(mdFile, 'utf-8');

  if (!themeContent) {
    onEvent({ type: 'error', message: `Theme "${themeId}" not found` });
    return;
  }

  const themeMeta = ctx.themes.find((t: any) => t.id === themeId);
  const themeName = themeMeta ? themeMeta.name : themeId;

  onEvent({ type: 'theme_selected', themeId, themeName });

  const appJsxPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appJsxPath)) {
    onEvent({ type: 'error', message: 'No app.jsx found.' });
    return;
  }

  if (!acquireLock('theme', () => {})) {
    onEvent({ type: 'error', message: 'Another request is in progress. Please wait.' });
    return;
  }

  const appCode = readFileSync(appJsxPath, 'utf-8');
  const colors = parseThemeColors(ctx.themeDir, themeId);

  try {
    if (hasThemeMarkers(appCode)) {
      await handleThemeSwitchMultiPass(ctx, onEvent, themeId, themeName, themeContent, appCode, appJsxPath, colors, model);
    } else {
      await handleThemeSwitchLegacy(ctx, onEvent, themeId, themeName, themeContent, colors, model);
    }
  } finally {
    releaseLock();
  }
}

async function handleThemeSwitchMultiPass(
  ctx: ServerContext,
  onEvent: EventCallback,
  themeId: string,
  themeName: string,
  themeContent: string,
  appCode: string,
  appJsxPath: string,
  colors: any,
  model: string | undefined,
): Promise<void> {
  console.log(`[ThemeSwitch] Multi-pass for "${themeName}" (${themeId})`);

  let updatedCode = appCode;
  if (colors?.rootBlock) {
    updatedCode = replaceThemeSection(updatedCode, 'tokens', colors.rootBlock);
  }
  if (colors?.fontImports?.length > 0) {
    updatedCode = replaceThemeSection(updatedCode, 'typography', colors.fontImports.join('\n'));
  }
  updatedCode = updateThemeMeta(updatedCode, themeId, themeName);
  updatedCode = moveVisualCSSToSurfaces(updatedCode);

  createBackup(appJsxPath);
  writeFileSync(appJsxPath, updatedCode, 'utf-8');

  onEvent({ type: 'theme_pass1_complete', themeId, themeName, rootCss: colors?.rootBlock || null, fontImports: colors?.fontImports || [] });
  console.log(`[ThemeSwitch] Pass 1 complete — tokens + typography applied`);

  onEvent({ type: 'progress', progress: 40, stage: `Enhancing ${themeName} surfaces, motion, decoration...`, elapsed: 0 });

  const pass1Code = readFileSync(appJsxPath, 'utf-8');
  const beforeNonTheme = extractNonThemeSections(pass1Code);

  const prompt = `Restyle ONLY the marked theme sections in app.jsx for the "${themeName}" theme.

=== CURRENT app.jsx ===

\`\`\`jsx
${pass1Code}
\`\`\`

=== WHAT TO EDIT ===

You MUST only edit content between these marker pairs in app.jsx:
- \`/* @theme:surfaces */\` ... \`/* @theme:surfaces:end */\`
- \`/* @theme:motion */\` ... \`/* @theme:motion:end */\`
- \`{/* @theme:decoration */}\` ... \`{/* @theme:decoration:end */}\`

=== THEME PERSONALITY ===

${extractPass2ThemeContext(themeContent, 12000)}

=== RULES ===

- Replace content BETWEEN markers. Keep markers themselves.
- Match the theme's personality.
- Do NOT modify anything outside the markers.
- No imports, no TypeScript, keep export default App.
- Never use CSS unicode escapes.
${extractDataSchema(pass1Code)}`;

  const claudeResult = await runOneShot(prompt, {
    skipChat: true,
    maxTurns: 5,
    model,
    cwd: ctx.projectRoot,
    tools: 'Read,Edit',
  }, onEvent, ctx.projectRoot);

  if (claudeResult === null) {
    onEvent({ type: 'app_updated' });
  }

  // Post-edit validation
  const afterCode = readFileSync(appJsxPath, 'utf-8');
  const afterNonTheme = extractNonThemeSections(afterCode);

  if (beforeNonTheme !== afterNonTheme) {
    const charDiff = afterNonTheme.length - beforeNonTheme.length;
    console.log(`[ThemeSwitch] GUARDRAIL: Claude modified non-theme content (${charDiff >= 0 ? '+' : ''}${charDiff} chars) — restoring backup`);
    const restored = restoreFromBackup(appJsxPath);
    if (restored.success) {
      let restoredCode = readFileSync(appJsxPath, 'utf-8');
      if (colors?.rootBlock) restoredCode = replaceThemeSection(restoredCode, 'tokens', colors.rootBlock);
      if (colors?.fontImports?.length > 0) restoredCode = replaceThemeSection(restoredCode, 'typography', colors.fontImports.join('\n'));
      restoredCode = updateThemeMeta(restoredCode, themeId, themeName);
      writeFileSync(appJsxPath, restoredCode, 'utf-8');
    }
    onEvent({ type: 'theme_validation_failed', message: `Theme "${themeName}" creative pass modified app logic — reverted.` });
  } else {
    console.log(`[ThemeSwitch] Pass 2 validated — non-theme content unchanged`);
    sanitizeAppJsx(ctx.projectRoot);
  }
}

async function handleThemeSwitchLegacy(
  ctx: ServerContext,
  onEvent: EventCallback,
  themeId: string,
  themeName: string,
  themeContent: string,
  colors: any,
  model: string | undefined,
): Promise<void> {
  let rootCss = colors?.rootBlock || '';
  if (!rootCss) {
    const rootMatch = themeContent.match(/:root\s*\{[\s\S]*?\}/);
    if (rootMatch) rootCss = rootMatch[0];
  }

  const appJsxPath = join(ctx.projectRoot, 'app.jsx');
  const appCode = readFileSync(appJsxPath, 'utf-8');

  const prompt = `Restyle app.jsx to the "${themeName}" (${themeId}) theme.

=== CURRENT app.jsx ===

\`\`\`jsx
${appCode}
\`\`\`

=== MANDATORY CSS CHANGES ===

Replace the ENTIRE :root block with:

\`\`\`css
${rootCss || `/* Build :root with oklch colors matching "${themeName}" */`}
\`\`\`

Replace __VIBES_THEMES__ with: [{ id: "${themeId}", name: "${themeName}" }]
Replace useVibesTheme default with: "${themeId}"

=== THEME PERSONALITY ===

${extractPass2ThemeContext(themeContent, 14000)}

=== RULES ===

CHANGE: :root CSS variables, backgrounds, shadows, borders, fonts, animations, SVGs, __VIBES_THEMES__
KEEP UNCHANGED: All components, hooks, functions, state, data models, Fireproof calls
- No imports, no TypeScript, keep export default App
- Never use CSS unicode escapes.`;

  console.log(`[ThemeSwitch] Legacy mode for "${themeName}" (${themeId})`);
  await runOneShot(prompt, {
    skipChat: true,
    maxTurns: 8,
    model,
    cwd: ctx.projectRoot,
    tools: 'Read,Edit',
  }, onEvent, ctx.projectRoot);
}

/**
 * Apply a custom color palette to app.jsx.
 */
export async function handlePaletteTheme(
  ctx: ServerContext,
  onEvent: EventCallback,
  colors: Record<string, string>,
): Promise<void> {
  if (!colors || typeof colors !== 'object' || Object.keys(colors).length === 0) {
    onEvent({ type: 'error', message: 'Invalid palette colors' });
    return;
  }

  const appJsxPath = join(ctx.projectRoot, 'app.jsx');
  if (!existsSync(appJsxPath)) {
    onEvent({ type: 'error', message: 'No app.jsx found.' });
    return;
  }

  let appCode = readFileSync(appJsxPath, 'utf-8');

  const lines = Object.entries(colors).map(([varName, value]) => `    ${varName}: ${value};`);
  const rootBlock = `:root {\n${lines.join('\n')}\n}`;

  if (hasThemeMarkers(appCode)) {
    appCode = replaceThemeSection(appCode, 'tokens', rootBlock);
    console.log('[Palette] Replaced tokens section with custom palette');
  } else {
    const rootRegex = /:root\s*\{[^}]*\}/;
    if (rootRegex.test(appCode)) {
      appCode = appCode.replace(rootRegex, rootBlock);
      console.log('[Palette] Replaced :root block in app code');
    } else {
      console.log('[Palette] No :root block found');
      onEvent({ type: 'error', message: 'No :root token block found in app.jsx' });
      return;
    }
  }

  createBackup(appJsxPath);
  writeFileSync(appJsxPath, appCode, 'utf-8');

  onEvent({ type: 'app_updated' });
  console.log('[Palette] Custom palette applied');
}
