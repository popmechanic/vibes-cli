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
import { loadEnvFile, validateClerkKey, populateConnectConfig } from './lib/env-utils.js';
import { APP_PLACEHOLDER, validateAssembly } from './lib/assembly-utils.js';
import { stripForTemplate } from './lib/strip-code.js';

const PLACEHOLDER = APP_PLACEHOLDER;

function main() {
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

  // Check files exist
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  if (!existsSync(resolvedAppPath)) {
    throw new Error(`App file not found: ${resolvedAppPath}`);
  }

  // Read files
  const template = readFileSync(templatePath, 'utf8');
  const appCode = readFileSync(resolvedAppPath, 'utf8').trim();

  // Verify placeholder exists
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`Template missing placeholder: ${PLACEHOLDER}`);
  }

  // Load env vars from .env if present (for Connect config)
  const outputDir = dirname(resolvedOutputPath);
  const envVars = loadEnvFile(outputDir);

  // Validate Connect credentials - fail fast if invalid
  const hasValidConnect = validateClerkKey(envVars.VITE_CLERK_PUBLISHABLE_KEY) &&
                          envVars.VITE_API_URL;

  if (!hasValidConnect) {
    throw new Error(
      'Valid Clerk credentials required.\n\n' +
      'Expected in .env:\n' +
      '  VITE_CLERK_PUBLISHABLE_KEY=pk_test_... or pk_live_...\n' +
      '  VITE_API_URL=http://localhost:8080/api/\n\n' +
      'Run Connect setup before assembling apps.'
    );
  }

  console.log('Connect mode: Clerk auth + cloud sync enabled');

  // Assemble: strip imports/exports, insert app code at placeholder, then populate Connect config
  let output = template.replace(PLACEHOLDER, stripForTemplate(appCode));
  output = populateConnectConfig(output, envVars);

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

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
