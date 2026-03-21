/**
 * Theme switch handlers — multi-pass (markers) and legacy (full-file) modes.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { runOneShot } from '../claude-bridge.ts';
import type { EventCallback } from '../claude-bridge.ts';
import { sanitizeAppJsx } from '../post-process.ts';
import { parseThemeColors } from '../config.ts';
import type { ServerContext } from '../config.ts';
import { hasThemeMarkers, replaceThemeSection, extractNonThemeSections, moveVisualCSSToSurfaces } from '../../lib/theme-sections.js';
import { createBackup, restoreFromBackup } from '../../lib/backup.js';
import { currentAppDir } from '../app-context.js';
import { buildThemePromptMultiPass, buildThemePromptLegacy } from '../prompt-builders.ts';

/**
 * Replace __VIBES_THEMES__ array and useVibesTheme default in app code.
 */
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

/**
 * Handle theme switch — dispatches to multi-pass or legacy based on markers.
 */
export async function handleThemeSwitch(ctx: ServerContext, onEvent: EventCallback, themeId: string, model: string | undefined, appName: string | undefined = undefined) {
  const txtFile = join(ctx.themeDir, `${themeId}.txt`);
  const mdFile = join(ctx.themeDir, `${themeId}.md`);
  let themeContent = '';
  if (existsSync(txtFile)) themeContent = readFileSync(txtFile, 'utf-8');
  else if (existsSync(mdFile)) themeContent = readFileSync(mdFile, 'utf-8');

  if (!themeContent) {
    onEvent({ type: 'error', message: `Theme "${themeId}" not found` });
    return;
  }

  const themeMeta = ctx.themes.find(t => t.id === themeId);
  const themeName = themeMeta ? themeMeta.name : themeId;

  onEvent({ type: 'theme_selected', themeId, themeName });

  const appDir = currentAppDir(ctx, appName);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app active.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
  if (!existsSync(appJsxPath)) {
    onEvent({ type: 'error', message: 'No app.jsx found.' });
    return;
  }

  const appCode = readFileSync(appJsxPath, 'utf-8');
  const colors = parseThemeColors(ctx.themeDir, themeId);

  if (hasThemeMarkers(appCode)) {
    await handleThemeSwitchMultiPass(ctx, onEvent, themeId, themeName, themeContent, appCode, appJsxPath, colors, model, appName);
  } else {
    await handleThemeSwitchLegacy(ctx, onEvent, themeId, themeName, themeContent, colors, model, appName);
  }
}

/**
 * Multi-pass theme switch: instant tokens/typography (Pass 1) + Claude creative (Pass 2).
 */
async function handleThemeSwitchMultiPass(ctx, onEvent, themeId, themeName, themeContent, appCode, appJsxPath, colors, model, appName: string | undefined = undefined) {
  console.log(`[ThemeSwitch] Multi-pass for "${themeName}" (${themeId})`);

  // === Pass 1: Mechanical token + typography replacement (instant) ===
  let updatedCode = appCode;

  if (colors?.rootBlock) {
    updatedCode = replaceThemeSection(updatedCode, 'tokens', colors.rootBlock);
    console.log(`[ThemeSwitch] Pass 1: replaced tokens (${colors.rootBlock.split('\n').length} lines)`);
  }

  if (colors?.fontImports?.length > 0) {
    updatedCode = replaceThemeSection(updatedCode, 'typography', colors.fontImports.join('\n'));
    console.log(`[ThemeSwitch] Pass 1: replaced typography (${colors.fontImports.length} fonts)`);
  }

  updatedCode = updateThemeMeta(updatedCode, themeId, themeName);

  // Move orphaned visual CSS into @theme:surfaces before Pass 2
  updatedCode = moveVisualCSSToSurfaces(updatedCode);

  createBackup(appJsxPath);
  writeFileSync(appJsxPath, updatedCode, 'utf-8');

  onEvent({
    type: 'theme_pass1_complete',
    themeId,
    themeName,
    rootCss: colors?.rootBlock || null,
    fontImports: colors?.fontImports || []
  });
  console.log(`[ThemeSwitch] Pass 1 complete — tokens + typography applied`);

  // === Pass 2: Claude creative restyle ===
  onEvent({
    type: 'progress',
    progress: 40,
    stage: `Enhancing ${themeName} surfaces, motion, decoration...`,
    elapsed: 0
  });

  const pass1Code = readFileSync(appJsxPath, 'utf-8');
  const beforeNonTheme = extractNonThemeSections(pass1Code);

  const prompt = buildThemePromptMultiPass(ctx, themeId, themeName, themeContent, pass1Code);

  console.log(`[ThemeSwitch] Pass 2: Claude creative restyle, prompt: ${(prompt.length / 1024).toFixed(1)}KB`);

  // Use skipChat in onEvent — the wsAdapter will check event.skipChat
  const claudeResult = await runOneShot(prompt, { lockType: 'theme', skipChat: true, maxTurns: 5, model, cwd: currentAppDir(ctx, appName), tools: 'Read,Edit' }, onEvent, ctx.projectRoot);

  if (claudeResult === null) {
    onEvent({ type: 'app_updated' });
  }

  // === Post-edit validation (Layer 2 guardrail) ===
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
    onEvent({
      type: 'theme_validation_failed',
      message: `Theme "${themeName}" creative pass modified app logic — reverted to safe version with new colors/fonts only.`
    });
  } else {
    console.log(`[ThemeSwitch] Pass 2 validated — non-theme content unchanged`);
    sanitizeAppJsx(currentAppDir(ctx, appName) || ctx.projectRoot);
  }
}

/**
 * Legacy theme switch: full-file Claude restyle (no markers).
 */
async function handleThemeSwitchLegacy(ctx, onEvent, themeId, themeName, themeContent, colors, model, appName: string | undefined = undefined) {
  const appDir = currentAppDir(ctx, appName);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app active.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
  const appCode = readFileSync(appJsxPath, 'utf-8');

  const prompt = buildThemePromptLegacy(ctx, themeId, themeName, themeContent, appCode, colors);

  console.log(`[ThemeSwitch] Legacy mode for "${themeName}" (${themeId}), prompt: ${(prompt.length / 1024).toFixed(1)}KB`);
  await runOneShot(prompt, { lockType: 'theme', skipChat: true, maxTurns: 8, model, cwd: currentAppDir(ctx, appName), tools: 'Read,Edit' }, onEvent, ctx.projectRoot);

  sanitizeAppJsx(currentAppDir(ctx, appName) || ctx.projectRoot);
}

/**
 * Apply a custom color palette to app.jsx by replacing :root block.
 */
export async function handlePaletteTheme(ctx: ServerContext, onEvent: EventCallback, colors: Record<string, string>, appName: string | undefined = undefined) {
  if (!colors || typeof colors !== 'object' || Object.keys(colors).length === 0) {
    onEvent({ type: 'error', message: 'Invalid palette colors' });
    return;
  }

  const appDir = currentAppDir(ctx, appName);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app active.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
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
      console.log('[Palette] No :root block found, cannot apply palette');
      onEvent({ type: 'error', message: 'No :root token block found in app.jsx' });
      return;
    }
  }

  createBackup(appJsxPath);
  writeFileSync(appJsxPath, appCode, 'utf-8');

  onEvent({ type: 'app_updated' });
  console.log('[Palette] Custom palette applied');
}
