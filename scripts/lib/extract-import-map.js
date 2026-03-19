//
// Extracts the import map from source-templates/base/template.html.
// Used by SKILL.md !`command` injection to keep import maps in sync.
//
// Output: JSON object of the "imports" field, pretty-printed.
//
// Can be imported as a module (extractImportMap function) or run directly as a script.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regex to match a <script type="importmap"> tag.
 * Uses [^>]* to tolerate additional attributes on the script tag.
 */
export const IMPORTMAP_REGEX = /<script[^>]+type="importmap"[^>]*>\s*([\s\S]*?)\s*<\/script>/;

/**
 * Extracts the "imports" object from an HTML string containing a <script type="importmap"> block.
 * @param {string} html - HTML content containing an importmap script tag
 * @returns {object} The parsed "imports" object
 * @throws {Error} If no importmap is found or JSON is invalid
 */
export function extractImportMapFromHtml(html) {
  const match = html.match(IMPORTMAP_REGEX);
  if (!match) {
    throw new Error('No <script type="importmap"> found in HTML');
  }
  const importMap = JSON.parse(match[1]);
  return importMap.imports;
}

/**
 * Extracts the import map from the base template file at the default path.
 * @returns {object} The parsed "imports" object
 * @throws {Error} If the template file cannot be read or parsed
 */
export function extractImportMap() {
  const templatePath = join(__dirname, '..', '..', 'source-templates', 'base', 'template.html');
  const html = readFileSync(templatePath, 'utf8');
  return extractImportMapFromHtml(html);
}

// When run directly as a script, output the import map JSON
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  try {
    const imports = extractImportMap();
    console.log(JSON.stringify(imports, null, 2));
  } catch (err) {
    console.error(`Failed to extract import map: ${err.message}`);
    process.exit(1);
  }
}
