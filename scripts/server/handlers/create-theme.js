/**
 * Save current app theme as a reusable catalog theme.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { reloadThemes } from '../config.js';
import { currentAppDir } from '../app-context.js';
import { buildClaudeArgs, cleanEnv } from '../../lib/claude-subprocess.js';
import { createStreamParser } from '../../lib/stream-parser.js';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

function uniqueThemeId(themeDir, base) {
  if (!existsSync(join(themeDir, `${base}.txt`))) return base;
  let n = 2;
  while (existsSync(join(themeDir, `${base}-${n}.txt`))) n++;
  return `${base}-${n}`;
}

async function extractThemeFromAppJsx(projectRoot, appCode, themeId, themeName, model) {
  const themeDir = join(projectRoot, 'skills/vibes/themes');
  const archivePath = join(themeDir, 'archive.txt');
  let formatRef = '';
  if (existsSync(archivePath)) {
    formatRef = readFileSync(archivePath, 'utf-8').slice(0, 2000);
  }

  const extractionPrompt = `You are saving the current app's visual design as a reusable theme for the Vibes design system.

Theme ID: ${themeId}
Theme Name: ${themeName}

Here is the current app.jsx:

\`\`\`jsx
${appCode.slice(0, 30000)}
\`\`\`

Here is an example of the theme file format (from archive.txt — use this EXACT structure):

---
${formatRef}
---

Tasks:
1. Analyze the app.jsx code above — study its :root CSS tokens, styles, layout patterns, color choices, surfaces, animations, and decorative elements.
2. Write the theme file to skills/vibes/themes/${themeId}.txt with ALL these sections:
   - THEME: ${themeId}
   - NAME: ${themeName}
   - MOOD: (3-4 adjectives describing the visual mood)
   - DESCRIPTION: (2-4 sentences describing the layout and feel)
   - BEST FOR: (bullet list of app types this suits)
   - NOT FOR: (bullet list of app types this doesn't suit)
   - ADAPTATION NOTES: (how to adapt for tables, charts, forms, etc.)
   - COLOR TOKENS: (use oklch() values — convert from the app's current colors)
   - DESIGN PRINCIPLES: (typography, spacing, borders, shadows)
   - PERSONALITY: (voice and character of the theme)
   - ANIMATIONS: (transition and hover effects present in the app)
   - SVG ELEMENTS: (decorative SVG patterns if present)
   - REFERENCE CSS: (complete CSS implementing the theme, extracted from the app)

3. Append a catalog row to skills/vibes/themes/catalog.txt.
   Insert a new row BEFORE the line that says "HOW TO CHOOSE".
   Format: | ${themeId} | ${themeName} | <mood> | <best-for summary> |

Use oklch() for ALL color values in the COLOR TOKENS section. Study the app carefully for palette, typography weight, spacing rhythm, and overall composition.`;

  return new Promise((resolve, reject) => {
    const args = buildClaudeArgs({ outputFormat: 'stream-json', maxTurns: 10, timeoutMs: 240_000, tools: 'Edit,Read,Write', model, permissionMode: 'bypassPermissions' });

    console.log(`[SaveTheme] Spawning claude for theme "${themeId}"...`);
    const child = spawn('claude', args, {
      cwd: projectRoot,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(extractionPrompt);
    child.stdin.end();

    let stderr = '';
    let resultText = '';

    const parse = createStreamParser((event) => {
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) resultText = block.text;
          if (block.type === 'tool_use') {
            console.log(`[SaveTheme] Tool: ${block.name || ''}`);
          }
        }
      } else if (event.type === 'result') {
        if (event.is_error) {
          console.error(`[SaveTheme] Result is_error: ${event.result}`);
        } else {
          resultText = event.result || resultText || 'Done.';
        }
      }
    });

    child.stdout.on('data', parse);
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const EXTRACT_TIMEOUT = 240_000;
    const timeout = setTimeout(() => {
      console.error(`[SaveTheme] Timeout after ${EXTRACT_TIMEOUT / 1000}s — killing subprocess`);
      child.kill('SIGTERM');
    }, EXTRACT_TIMEOUT);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.error(`[SaveTheme] Failed (code ${code}): ${stderr.slice(0, 300)}`);
        reject(new Error(`Theme save failed (exit code ${code})`));
        return;
      }
      console.log(`[SaveTheme] Theme "${themeId}" created successfully`);
      resolve(resultText);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[SaveTheme] Spawn error:`, err.message);
      reject(new Error(`Failed to start claude: ${err.message}`));
    });
  });
}

/**
 * Save the current app.jsx theme as a catalog theme.
 */
export async function handleSaveTheme(ctx, onEvent, themeName, model) {
  const appDir = currentAppDir(ctx);
  if (!appDir) {
    onEvent({ type: 'error', message: 'No app selected — generate an app first.' });
    return;
  }
  const appJsxPath = join(appDir, 'app.jsx');
  if (!existsSync(appJsxPath)) {
    onEvent({ type: 'error', message: 'No app.jsx found — generate an app first.' });
    return;
  }

  const appCode = readFileSync(appJsxPath, 'utf-8');
  const themeId = uniqueThemeId(ctx.themeDir, slugify(themeName));

  try {
    onEvent({ type: 'status', status: 'saving_theme', stage: 'Analyzing app styles...', themeId, themeName, progress: 0, elapsed: 0 });
    console.log(`[SaveTheme] Saving theme "${themeId}" from current app.jsx...`);

    const startTime = Date.now();
    const expectedDuration = 45_000;
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(90, Math.round((elapsed / expectedDuration) * 80));
      const stages = ['Analyzing app styles...', 'Extracting color tokens...', 'Writing design principles...', 'Creating theme file...'];
      const stageIdx = Math.min(stages.length - 1, Math.floor((elapsed / expectedDuration) * stages.length));
      const stage = elapsed > expectedDuration * 1.5
        ? 'Still processing... (this is taking longer than usual)'
        : stages[stageIdx];
      onEvent({ type: 'status', status: 'saving_theme', stage, themeId, themeName, progress, elapsed: Math.round(elapsed / 1000) });
    }, 2000);

    try {
      await extractThemeFromAppJsx(ctx.projectRoot, appCode, themeId, themeName, model);
    } finally {
      clearInterval(progressInterval);
    }

    const themeFilePath = join(ctx.themeDir, `${themeId}.txt`);
    if (!existsSync(themeFilePath)) {
      throw new Error('Theme file was not created — Claude may have encountered an issue');
    }

    reloadThemes(ctx);

    onEvent({ type: 'theme_created', themeId, themeName });
    console.log(`[SaveTheme] Theme "${themeId}" (${themeName}) saved and loaded`);
  } catch (err) {
    console.error('[SaveTheme] Error:', err.message);
    onEvent({ type: 'error', message: `Theme save failed: ${err.message}` });
  }
}
