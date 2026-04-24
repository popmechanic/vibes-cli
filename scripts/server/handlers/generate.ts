/**
 * Preview-frame assembly — wraps app.jsx in the vibes template for the
 * /app-frame route. The editor generate flow lives in ws.ts (`case 'generate':`)
 * and runs through the persistent bridge — not through this file.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripForTemplate } from '../../lib/strip-code.js';
import { APP_PLACEHOLDER, injectCode, patchAppBackground } from '../../lib/assembly-utils.js';
import { populateConnectConfig } from '../../lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from '../../lib/auth-constants.js';
import { TEMPLATES } from '../../lib/paths.js';
import { resolveProjectDir } from '../app-context.js';

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
  template = injectCode(template, APP_PLACEHOLDER, strippedCode);

  // Preview mode: inject safe defaults for TinyBase config (local-only, no sync, no auth).
  // Full config (wsUrl, oidcClientId) is injected at deploy time by the Deploy API.
  const resolvedName = appName || 'preview-app';
  template = populateConnectConfig(template, { '__APP_NAME__': resolvedName });

  // Inject OIDC constants (same as assemble.js does for CLI assembly)
  template = template.replaceAll('__OIDC_AUTHORITY__', OIDC_AUTHORITY);
  template = template.replaceAll('__OIDC_CLIENT_ID__', OIDC_CLIENT_ID);
  template = template.replaceAll('__DEPLOY_API_URL__', DEPLOY_API_URL);
  template = template.replaceAll('__AI_PROXY_URL__', AI_PROXY_URL);

  // Patch bg color + cache-control so the preview iframe matches
  // the deployed app. Same helper as assemble.js uses.
  template = patchAppBackground(template, appCode);

  return template;
}
