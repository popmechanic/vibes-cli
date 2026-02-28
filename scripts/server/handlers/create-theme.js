/**
 * Theme creation handlers — image generation + Claude extraction.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { reloadThemes, parseThemeColors } from '../config.js';
import { buildClaudeArgs, cleanEnv } from '../../lib/claude-subprocess.js';

const IMAGE_VARIATIONS = [
  'card-based layout with prominent content cards arranged in a grid or masonry pattern',
  'sidebar navigation layout with a persistent side panel and main content area',
  'split-pane layout with two distinct content zones separated by a divider',
];

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

async function generateThemeImages(openRouterKey, prompt) {
  if (!openRouterKey) throw new Error('OpenRouter API key not configured');

  const requests = IMAGE_VARIATIONS.map(async (variation, i) => {
    const fullPrompt = `UI design mockup for a web application theme: ${prompt}. Layout style: ${variation}. Clean, modern interface design with visible color palette and typography. No text labels, focus on visual design language and spatial composition.`;
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vibes.diy',
          'X-Title': 'Vibes Theme Creator',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-pro-image-preview',
          messages: [{ role: 'user', content: fullPrompt }],
          modalities: ['image', 'text'],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[ImageGen] Variation ${i} failed (${resp.status}): ${errText.slice(0, 200)}`);
        return null;
      }
      const data = await resp.json();
      return data.choices?.[0]?.message?.images?.[0]?.image_url?.url || null;
    } catch (err) {
      console.error(`[ImageGen] Variation ${i} error:`, err.message);
      return null;
    }
  });

  return Promise.all(requests);
}

async function extractThemeFromImage(projectRoot, imageUrl, prompt, themeId, themeName, model) {
  const themeDir = join(projectRoot, 'skills/vibes/themes');
  const archivePath = join(themeDir, 'archive.txt');
  let formatRef = '';
  if (existsSync(archivePath)) {
    formatRef = readFileSync(archivePath, 'utf-8').slice(0, 2000);
  }

  const tempFile = join(tmpdir(), `vibes-theme-${themeId}-${Date.now()}.png`);
  if (imageUrl.startsWith('data:')) {
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
    writeFileSync(tempFile, Buffer.from(base64Data, 'base64'));
  } else {
    return Promise.reject(new Error('Expected base64 data URL from image generation'));
  }
  console.log(`[ThemeExtract] Wrote image to ${tempFile}`);

  const extractionPrompt = `You are creating a new theme file for the Vibes design system.

FIRST: Read the image file at ${tempFile} using the Read tool. Analyze its visual design.

User's theme description: "${prompt}"
Theme ID: ${themeId}
Theme Name: ${themeName}

Here is an example of the format (from archive.txt — use this EXACT structure):

---
${formatRef}
---

Tasks:
1. Read the image at ${tempFile} to analyze the visual design.
2. Write the theme file to skills/vibes/themes/${themeId}.txt with ALL these sections:
   - THEME: ${themeId}
   - NAME: ${themeName}
   - MOOD: (3-4 adjectives describing the visual mood from the image)
   - DESCRIPTION: (2-4 sentences describing the layout and feel)
   - BEST FOR: (bullet list of app types this suits)
   - NOT FOR: (bullet list of app types this doesn't suit)
   - ADAPTATION NOTES: (how to adapt for tables, charts, forms, etc.)
   - COLOR TOKENS: (use oklch() values — extract colors from the image)
   - DESIGN PRINCIPLES: (typography, spacing, borders, shadows)
   - PERSONALITY: (voice and character of the theme)
   - ANIMATIONS: (transition and hover effects)
   - SVG ELEMENTS: (decorative SVG patterns if appropriate)
   - REFERENCE CSS: (complete CSS implementing the theme)

3. Append a catalog row to skills/vibes/themes/catalog.txt.
   Insert a new row BEFORE the line that says "HOW TO CHOOSE".
   Format: | ${themeId} | ${themeName} | <mood> | <best-for summary> |

Use oklch() for ALL color values. Study the image carefully for palette, typography weight, spacing rhythm, and overall composition.`;

  return new Promise((resolve, reject) => {
    const args = buildClaudeArgs({ ...{ outputFormat: 'stream-json', maxTurns: 5, timeoutMs: 120_000 }, addDirs: [tmpdir()], model });

    console.log(`[ThemeExtract] Spawning claude for theme "${themeId}" (with image)...`);
    const child = spawn('claude', args, {
      cwd: projectRoot,
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(extractionPrompt);
    child.stdin.end();

    let buffer = '';
    let stderr = '';
    let resultText = '';

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) resultText = block.text;
              if (block.type === 'tool_use') {
                const toolName = block.name || '';
                console.log(`[ThemeExtract] Tool: ${toolName}`);
              }
            }
          } else if (event.type === 'result') {
            resultText = event.result || resultText || 'Done.';
          }
        } catch {
          // ignore partial line parse errors
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const EXTRACT_TIMEOUT = 120_000;
    const timeout = setTimeout(() => {
      console.error(`[ThemeExtract] Timeout after ${EXTRACT_TIMEOUT / 1000}s — killing subprocess`);
      child.kill('SIGTERM');
    }, EXTRACT_TIMEOUT);

    const cleanup = () => {
      clearTimeout(timeout);
      if (tempFile) try { unlinkSync(tempFile); } catch {}
    };

    child.on('close', (code) => {
      cleanup();
      if (code !== 0) {
        console.error(`[ThemeExtract] Failed (code ${code}): ${stderr.slice(0, 300)}`);
        reject(new Error(`Theme extraction failed (exit code ${code})`));
        return;
      }
      console.log(`[ThemeExtract] Theme "${themeId}" created successfully`);
      resolve(resultText);
    });

    child.on('error', (err) => {
      cleanup();
      console.error(`[ThemeExtract] Spawn error:`, err.message);
      reject(new Error(`Failed to start claude: ${err.message}`));
    });
  });
}

/**
 * Generate theme variation images from a text prompt.
 * Stores images in connState.pendingImages for later selection.
 */
export async function handleCreateTheme(ctx, onEvent, prompt, model, connState) {
  if (!ctx.openRouterKey) {
    onEvent({ type: 'error', message: 'OpenRouter API key not configured. Add OPENROUTER_API_KEY to .env to enable theme creation.' });
    return;
  }

  try {
    onEvent({ type: 'status', status: 'generating_images', stage: 'Generating theme images...', progress: 0, elapsed: 0 });
    const images = await generateThemeImages(ctx.openRouterKey, prompt);
    connState.pendingImages = images;

    const validCount = images.filter(Boolean).length;
    if (validCount === 0) {
      onEvent({ type: 'error', message: 'All image generations failed. Check your OpenRouter API key and balance.' });
      return;
    }

    onEvent({ type: 'theme_images', images });
    console.log(`[CreateTheme] Generated ${validCount}/3 images for "${prompt}"`);
  } catch (err) {
    console.error('[CreateTheme] Error:', err.message);
    onEvent({ type: 'error', message: `Image generation failed: ${err.message}` });
  }
}

/**
 * Extract a theme from a previously generated image.
 */
export async function handlePickThemeImage(ctx, onEvent, index, prompt, model, connState) {
  if (!prompt) {
    onEvent({ type: 'error', message: 'Prompt is required' });
    return;
  }

  const imageUrl = (connState.pendingImages || [])[index];
  if (!imageUrl) {
    onEvent({ type: 'error', message: `No image at index ${index}` });
    return;
  }

  const themeId = uniqueThemeId(ctx.themeDir, slugify(prompt));
  const themeName = prompt
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  try {
    onEvent({ type: 'status', status: 'extracting_theme', stage: 'Extracting theme from image...', themeId, themeName, progress: 0, elapsed: 0 });
    console.log(`[CreateTheme] Extracting theme "${themeId}" from image ${index}...`);

    const startTime = Date.now();
    const expectedDuration = 45_000;
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(90, Math.round((elapsed / expectedDuration) * 80));
      const stages = ['Reading image...', 'Analyzing colors and layout...', 'Generating theme tokens...', 'Writing theme file...'];
      const stageIdx = Math.min(stages.length - 1, Math.floor((elapsed / expectedDuration) * stages.length));
      const stage = elapsed > expectedDuration * 1.5
        ? 'Still processing... (this is taking longer than usual)'
        : stages[stageIdx];
      onEvent({ type: 'status', status: 'extracting_theme', stage, themeId, themeName, progress, elapsed: Math.round(elapsed / 1000) });
    }, 2000);

    try {
      await extractThemeFromImage(ctx.projectRoot, imageUrl, prompt, themeId, themeName, model);
    } finally {
      clearInterval(progressInterval);
    }

    const themeFilePath = join(ctx.themeDir, `${themeId}.txt`);
    if (!existsSync(themeFilePath)) {
      throw new Error('Theme file was not created — Claude may have encountered an issue');
    }

    reloadThemes(ctx);

    const newColors = parseThemeColors(ctx.themeDir, themeId);
    if (newColors) ctx.themeColors[themeId] = newColors;

    onEvent({ type: 'theme_created', themeId, themeName });
    console.log(`[CreateTheme] Theme "${themeId}" (${themeName}) created and loaded`);
  } catch (err) {
    console.error('[CreateTheme] Extraction error:', err.message);
    onEvent({ type: 'error', message: `Theme extraction failed: ${err.message}` });
  }
}
