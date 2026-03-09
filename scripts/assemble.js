#!/usr/bin/env node
/**
 * Vibes App Assembler
 *
 * Inserts JSX app code into the template to create a complete HTML file.
 *
 * Usage:
 *   bun scripts/assemble.js <app.jsx> [output.html]
 *
 * Example:
 *   bun scripts/assemble.js app.jsx index.html
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { TEMPLATES } from './lib/paths.js';
import { createBackup } from './lib/backup.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from './lib/auth-constants.js';
import { APP_PLACEHOLDER, validateAssembly, loadAndValidateTemplate } from './lib/assembly-utils.js';
import { stripForTemplate } from './lib/strip-code.js';


async function main() {
  // Parse args
  const appPath = process.argv[2];
  const outputPath = process.argv[3] || 'index.html';

  if (!appPath) {
    throw new Error('Usage: bun scripts/assemble.js <app.jsx> [output.html]');
  }

  // Resolve paths
  const templatePath = TEMPLATES.vibesBasic;
  const resolvedAppPath = resolve(appPath);
  const resolvedOutputPath = resolve(outputPath);

  // Check app file exists
  if (!existsSync(resolvedAppPath)) {
    throw new Error(`App file not found: ${resolvedAppPath}`);
  }

  // Load and validate template (checks existence + placeholder)
  const template = loadAndValidateTemplate(templatePath, readFileSync);
  const appCode = readFileSync(resolvedAppPath, 'utf8').trim();

  console.log('Assembling (Connect URLs will be injected at deploy time)');

  // Strip imports/exports/destructuring that conflict with the template.
  // Keep React destructuring — vibes template provides React as a global,
  // so app code needs `const { useState } = React;` to access hooks.
  const cleanedAppCode = stripForTemplate(appCode, { stripReactHooks: false });

  // Assemble: insert app code at placeholder
  let output = template.replace(APP_PLACEHOLDER, cleanedAppCode);

  // Inject hardcoded OIDC constants (same for every app) — replaceAll for templates
  // with multiple occurrences of the same placeholder
  output = output.replaceAll('__VITE_OIDC_AUTHORITY__', OIDC_AUTHORITY);
  output = output.replaceAll('__VITE_OIDC_CLIENT_ID__', OIDC_CLIENT_ID);
  output = output.replaceAll('__VITE_DEPLOY_API_URL__', DEPLOY_API_URL);
  output = output.replaceAll('__VITE_AI_PROXY_URL__', AI_PROXY_URL);

  // Validate output
  const validationErrors = validateAssembly(output, appCode);
  if (validationErrors.length > 0) {
    const lines = ['Assembly failed:'];
    validationErrors.forEach(e => lines.push(`  - ${e}`));
    // Provide specific guidance based on error type
    const fixes = validationErrors.map(e => {
      if (e.includes('empty')) return 'Ensure app.jsx has content';
      if (e.includes('Placeholder')) return 'Template may be corrupted - rebuild with: bun scripts/merge-templates.js --force';
      if (e.includes('App component')) return 'Add "export default function App()" or "function App()"';
      if (e.includes('script tags')) return 'Check for unclosed <script> tags in template';
      return null;
    }).filter(Boolean);
    if (fixes.length > 0) {
      lines.push(`\nFix: ${fixes.join('; ')}`);
    }
    throw new Error(lines.join('\n'));
  }

  // Backup existing file if present
  const backupPath = createBackup(resolvedOutputPath);
  if (backupPath) {
    console.log(`Backed up: ${backupPath}`);
  }

  // Write output
  writeFileSync(resolvedOutputPath, output);
  console.log(`Created: ${resolvedOutputPath}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
