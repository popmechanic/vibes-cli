#!/usr/bin/env node
/**
 * Vibes Parallel Assembler
 *
 * Assembles multiple riff apps in parallel.
 *
 * Usage:
 *   bun scripts/assemble-all.js riff-1 riff-2 riff-3 ...
 *
 * Each directory should contain app.jsx, output goes to index.html in same dir.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { TEMPLATES } from './lib/paths.js';
import { APP_PLACEHOLDER, injectCode, loadAndValidateTemplate } from './lib/assembly-utils.js';
import { stripForTemplate } from './lib/strip-code.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID, DEPLOY_API_URL, AI_PROXY_URL } from './lib/auth-constants.js';

const templatePath = TEMPLATES.vibesBasic;

// Load and validate template (checks existence + placeholder)
let template;
try {
  template = loadAndValidateTemplate(templatePath, readFileSync);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Get riff directories from args
const riffDirs = process.argv.slice(2);

if (riffDirs.length === 0) {
  console.error('Usage: bun scripts/assemble-all.js riff-1 riff-2 ...');
  process.exit(1);
}

// Assemble all in parallel
const results = await Promise.all(
  riffDirs.map(async (dir) => {
    const appPath = resolve(dir, 'app.jsx');
    const outputPath = resolve(dir, 'index.html');

    if (!existsSync(appPath)) {
      return { dir, success: false, error: `App not found: ${appPath}` };
    }

    try {
      const appCode = readFileSync(appPath, 'utf8').trim();
      const cleanedCode = stripForTemplate(appCode, { stripReactHooks: true });
      let output = injectCode(template, APP_PLACEHOLDER, cleanedCode);
      output = output.replaceAll('__OIDC_AUTHORITY__', OIDC_AUTHORITY);
      output = output.replaceAll('__OIDC_CLIENT_ID__', OIDC_CLIENT_ID);
      output = output.replaceAll('__DEPLOY_API_URL__', DEPLOY_API_URL);
      output = output.replaceAll('__AI_PROXY_URL__', AI_PROXY_URL);
      // Non-factory riffs still carry factoryMode/factoryBase keys in
      // __APP_CONFIG__. Substitute with safe defaults so the raw
      // __FACTORY_MODE__ identifier doesn't blow up at runtime.
      output = output.replaceAll('__FACTORY_MODE__', 'false');
      output = output.replaceAll('__FACTORY_BASE__', '');
      writeFileSync(outputPath, output);
      return { dir, success: true };
    } catch (e) {
      return { dir, success: false, error: e.message };
    }
  })
);

// Report results
let hasErrors = false;
for (const r of results) {
  if (r.success) {
    console.log(`Assembled: ${r.dir}/index.html`);
  } else {
    console.error(`Failed: ${r.dir} - ${r.error}`);
    hasErrors = true;
  }
}

console.log(`\nAssembled ${results.filter(r => r.success).length}/${results.length} riffs.`);
process.exit(hasErrors ? 1 : 0);
