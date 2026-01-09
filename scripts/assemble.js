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
import { resolve } from 'path';
import { TEMPLATES } from './lib/paths.js';
import { createBackup } from './lib/backup.js';

const PLACEHOLDER = '// __VIBES_APP_CODE__';

// Parse args
const appPath = process.argv[2];
const outputPath = process.argv[3] || 'index.html';

if (!appPath) {
  console.error('Usage: node scripts/assemble.js <app.jsx> [output.html]');
  process.exit(1);
}

// Resolve paths
const templatePath = TEMPLATES.vibesBasic;
const resolvedAppPath = resolve(appPath);
const resolvedOutputPath = resolve(outputPath);

// Check files exist
if (!existsSync(templatePath)) {
  console.error(`Template not found: ${templatePath}`);
  process.exit(1);
}
if (!existsSync(resolvedAppPath)) {
  console.error(`App file not found: ${resolvedAppPath}`);
  process.exit(1);
}

// Read files
const template = readFileSync(templatePath, 'utf8');
const appCode = readFileSync(resolvedAppPath, 'utf8').trim();

// Verify placeholder exists
if (!template.includes(PLACEHOLDER)) {
  console.error(`Template missing placeholder: ${PLACEHOLDER}`);
  process.exit(1);
}

// Assemble: insert app code at placeholder
const output = template.replace(PLACEHOLDER, appCode);

// Validate output
function validateAssembly(html, code) {
  const errors = [];

  if (!code || code.trim().length === 0) {
    errors.push('App code is empty');
  }

  if (html.includes(PLACEHOLDER)) {
    errors.push('Placeholder was not replaced');
  }

  if (!html.includes('export default function') && !html.includes('function App')) {
    errors.push('No App component found');
  }

  const scriptOpens = (html.match(/<script/gi) || []).length;
  const scriptCloses = (html.match(/<\/script>/gi) || []).length;
  if (scriptOpens !== scriptCloses) {
    errors.push(`Mismatched script tags: ${scriptOpens} opens, ${scriptCloses} closes`);
  }

  return errors;
}

const validationErrors = validateAssembly(output, appCode);
if (validationErrors.length > 0) {
  console.error('Assembly failed:');
  validationErrors.forEach(e => console.error(`  - ${e}`));
  // Provide specific guidance based on error type
  const fixes = validationErrors.map(e => {
    if (e.includes('empty')) return 'Ensure app.jsx has content';
    if (e.includes('Placeholder')) return 'Template may be corrupted - run /vibes:sync to refresh';
    if (e.includes('App component')) return 'Add "export default function App()" or "function App()"';
    if (e.includes('script tags')) return 'Check for unclosed <script> tags in template';
    return null;
  }).filter(Boolean);
  if (fixes.length > 0) {
    console.error(`\nFix: ${fixes.join('; ')}`);
  }
  process.exit(1);
}

// Backup existing file if present
const backupPath = createBackup(resolvedOutputPath);
if (backupPath) {
  console.log(`Backed up: ${backupPath}`);
}

// Write output
writeFileSync(resolvedOutputPath, output);
console.log(`Created: ${resolvedOutputPath}`);
