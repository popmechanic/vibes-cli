/**
 * Generate handler — create a new app from scratch via Claude.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { readVibesJson } from '../../lib/vibes-json.js';
import { runOneShot } from '../claude-bridge.ts';
import type { EventCallback } from '../claude-bridge.ts';
import { sanitizeAppJsx } from '../post-process.ts';
import type { ServerContext } from '../config.ts';
import { stripForTemplate } from '../../lib/strip-code.js';
import { APP_PLACEHOLDER } from '../../lib/assembly-utils.js';
import { populateConnectConfig } from '../../lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from '../../lib/auth-constants.js';
import { TEMPLATES } from '../../lib/paths.js';
import { resolveProjectDir } from '../app-context.js';
import { buildGeneratePrompt } from '../prompt-builders.ts';

export async function handleGenerate(ctx: ServerContext, onEvent: EventCallback, userPrompt: string, themeId: string | undefined, model: string | undefined, reference: any = null, useAI: boolean = false, previousApp: string | undefined = undefined) {
  if (!userPrompt) {
    onEvent({ type: 'error', message: 'Please describe what you want to build.' });
    return;
  }

  console.log(`[Generate] ▸ START prompt="${userPrompt.slice(0, 60)}" themeId=${themeId || '(auto)'}`);

  // Auto-save previous app before switching
  if (previousApp) {
    try {
      const prevDir = resolveProjectDir(ctx, previousApp);
      const prevIndexPath = join(prevDir, 'index.html');
      const assembled = assembleAppFrame(ctx, previousApp);
      writeFileSync(prevIndexPath, assembled);
      console.log(`[Generate] Auto-saved index.html for "${previousApp}"`);
    } catch (e) {
      console.warn(`[Generate] Auto-save failed for "${previousApp}": ${e.message}`);
    }
  }

  if (!ctx.projectDir) {
    onEvent({ type: 'error', message: 'No project folder selected.' });
    return;
  }

  const appDir = ctx.projectDir;
  const config = readVibesJson(ctx.projectDir);
  const appName = config?.name || basename(ctx.projectDir);
  onEvent({ type: 'app_created', name: appName });
  console.log(`[Generate] Using project directory: ${appName}`);

  // Build the prompt
  const result = buildGeneratePrompt(ctx, userPrompt, { themeId, reference, useAI });

  const themeColors = ctx.themeColors[result.themeId] || null;
  onEvent({ type: 'theme_selected', themeId: result.themeId, themeName: result.themeName, themeBackground: themeColors?.bg || null });

  if (result.isReference) {
    const maxTurns = result.isHtmlRef ? 10 : 12;
    console.log(`[Generate] Starting (reference path) — ref: ${reference.name} (${result.referenceIntent}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);

    // Reference preview: show the user their uploaded reference asset in the
    // iframe while Claude is analyzing it. Only for HTML and image refs;
    // text-file refs (seed/content/context intents) skip this — their content
    // doesn't visualize meaningfully and the user already saw it on upload.
    const refName = reference?.name as string | undefined;
    const isTextRef = !!refName && /\.(txt|md|csv|tsv|json|xml|rtf)$/i.test(refName);
    if (refName && !isTextRef) {
      const refKind = result.isHtmlRef ? 'html' : 'image';
      const vibesTmpPath = join(ctx.projectRoot, '.vibes-tmp', refName);
      if (existsSync(vibesTmpPath)) {
        onEvent({
          type: 'reference_preview',
          src: `/reference-frame?name=${encodeURIComponent(refName)}&kind=${refKind}`,
        });
      }
    }

    onEvent({ type: 'generation_stage', stage: 'reading_reference' });
    await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns, model, cwd: appDir, tools: 'Write,Edit,Read', initialStage: 'reading_reference' }, onEvent, ctx.projectRoot);
  } else {
    console.log(`[Generate] Starting — theme: ${result.themeId} (${result.themeName}), prompt: ${(result.prompt.length / 1024).toFixed(1)}KB`);
    onEvent({ type: 'generation_stage', stage: 'foundation' });
    await runOneShot(result.prompt, { lockType: 'generate', skipChat: true, maxTurns: 10, model, cwd: appDir, tools: 'Write,Edit,Read', initialStage: 'foundation' }, onEvent, ctx.projectRoot);
  }

  sanitizeAppJsx(appDir);
}

/**
 * Assemble app.jsx into the vibes template with TinyBase boilerplate.
 * Used by the /app-frame route.
 */
export function assembleAppFrame(ctx, appName?: string) {
  const templatePath = TEMPLATES.vibesBasic;
  if (!existsSync(templatePath)) {
    return `<html><body><h1>Template not found</h1><p>${templatePath}</p></body></html>`;
  }

  let template = readFileSync(templatePath, 'utf-8');

  const appDir = resolveProjectDir(ctx, appName);
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

  // Preview mode: inject safe defaults for TinyBase config (local-only, no sync, no auth).
  // Full config (wsUrl, oidcClientId) is injected at deploy time by the Deploy API.
  const resolvedName = appName || 'preview-app';
  template = populateConnectConfig(template, { '__APP_NAME__': resolvedName });

  // Inject OIDC constants (same as assemble.js does for CLI assembly)
  template = template.replaceAll('__OIDC_AUTHORITY__', OIDC_AUTHORITY);
  template = template.replaceAll('__OIDC_CLIENT_ID__', OIDC_CLIENT_ID);
  template = template.replaceAll('__DEPLOY_API_URL__', DEPLOY_API_URL);
  template = template.replaceAll('__AI_PROXY_URL__', AI_PROXY_URL);

  return template;
}
