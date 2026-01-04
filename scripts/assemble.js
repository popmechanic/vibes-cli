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

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { dirname, join, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER = '// __VIBES_APP_CODE__';

/**
 * Create a timestamped backup of an existing file
 * @param {string} filePath - Path to the file to backup
 * @returns {string|null} - Backup path if created, null otherwise
 */
function createBackup(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupPath = filePath.replace(/\.html$/, `.${timestamp}.bak.html`);
  copyFileSync(filePath, backupPath);
  return backupPath;
}

// Parse args
const appPath = process.argv[2];
const outputPath = process.argv[3] || 'index.html';

if (!appPath) {
  console.error('Usage: node scripts/assemble.js <app.jsx> [output.html]');
  process.exit(1);
}

// Resolve paths
const templatePath = join(__dirname, '../skills/vibes/templates/index.html');
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
  console.error('\nFix: Check your app.jsx for syntax errors');
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
