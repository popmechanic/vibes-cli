#!/usr/bin/env node
/**
 * Vibes App Assembler
 *
 * Inserts JSX app code into the template to create a complete HTML file.
 *
 * Usage:
 *   node scripts/assemble.js <app.jsx> [output.html]
 *
 * Example:
 *   node scripts/assemble.js app.jsx index.html
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { TEMPLATES } from './lib/paths.js';
import { createBackup } from './lib/backup.js';
import { loadEnvFile, populateConnectConfig } from './lib/env-utils.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from './lib/auth-constants.js';
import { APP_PLACEHOLDER, validateAssembly, loadAndValidateTemplate } from './lib/assembly-utils.js';
import { stripForTemplate } from './lib/strip-code.js';


async function main() {
  // Parse args
  const appPath = process.argv[2];
  const outputPath = process.argv[3] || 'index.html';

  if (!appPath) {
    throw new Error('Usage: node scripts/assemble.js <app.jsx> [output.html]');
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

  // Load env vars from .env in the output directory
  const outputDir = dirname(resolvedOutputPath);
  const envVars = loadEnvFile(outputDir);

  // Connect URLs are optional at assembly time — they'll be populated
  // by deploy-cloudflare.js on first deploy (alchemy + auto-reassembly).
  // If present, they'll be substituted; if absent, placeholders become empty strings.
  if (envVars.VITE_API_URL) {
    console.log('Connect mode: OIDC auth + cloud sync enabled');
  } else {
    console.log('Connect mode: OIDC auth enabled (Connect URLs will be set at deploy time)');
  }

  // Strip imports/exports/destructuring that conflict with the template.
  // Keep React destructuring — vibes template provides React as a global,
  // so app code needs `const { useState } = React;` to access hooks.
  const cleanedAppCode = stripForTemplate(appCode, { stripReactHooks: false });

  // Assemble: insert app code at placeholder, then populate Connect config
  let output = template.replace(APP_PLACEHOLDER, cleanedAppCode);
  output = populateConnectConfig(output, envVars);

  // Inject hardcoded OIDC constants (same for every app)
  output = output.replace('__VITE_OIDC_AUTHORITY__', OIDC_AUTHORITY);
  output = output.replace('__VITE_OIDC_CLIENT_ID__', OIDC_CLIENT_ID);

  // Validate output
  const validationErrors = validateAssembly(output, appCode);
  if (validationErrors.length > 0) {
    const lines = ['Assembly failed:'];
    validationErrors.forEach(e => lines.push(`  - ${e}`));
    // Provide specific guidance based on error type
    const fixes = validationErrors.map(e => {
      if (e.includes('empty')) return 'Ensure app.jsx has content';
      if (e.includes('Placeholder')) return 'Template may be corrupted - rebuild with: node scripts/merge-templates.js --force';
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
