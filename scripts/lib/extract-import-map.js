//
// Extracts the import map from source-templates/base/template.html.
// Used by SKILL.md !`command` injection to keep import maps in sync.
//
// Output: JSON object of the "imports" field, pretty-printed.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = join(__dirname, '..', '..', 'source-templates', 'base', 'template.html');

try {
  const html = readFileSync(templatePath, 'utf8');
  const match = html.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  if (!match) {
    console.error('No <script type="importmap"> found in base template');
    process.exit(1);
  }
  const importMap = JSON.parse(match[1]);
  console.log(JSON.stringify(importMap.imports, null, 2));
} catch (err) {
  console.error(`Failed to extract import map: ${err.message}`);
  process.exit(1);
}
