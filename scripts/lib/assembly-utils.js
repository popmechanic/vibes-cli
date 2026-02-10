/**
 * Shared assembly constants and validation utilities.
 *
 * Used by assemble.js, assemble-all.js, assemble-sell.js, and their tests.
 */

export const APP_PLACEHOLDER = '// __VIBES_APP_CODE__';

/**
 * Load a template file and validate it contains the placeholder.
 * @param {string} templatePath - Path to template file
 * @param {Function} readFileFn - Function to read a file (default: fs.readFileSync)
 * @param {string} [placeholder=APP_PLACEHOLDER] - Placeholder to check for
 * @returns {string} Template content
 * @throws {Error} If file missing or no placeholder found
 */
export function loadAndValidateTemplate(templatePath, readFileFn, placeholder = APP_PLACEHOLDER) {
  let content;
  try {
    content = readFileFn(templatePath, 'utf8');
  } catch (err) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  if (!content.includes(placeholder)) {
    throw new Error(`Template missing placeholder: ${placeholder}`);
  }

  return content;
}

/**
 * Validate assembled HTML output.
 * Returns array of error strings (empty = valid).
 * Checks: app code present, no remaining placeholder, App component found, script tags balanced.
 *
 * @param {string} html - Assembled HTML output
 * @param {string} code - App code that was inserted
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateAssembly(html, code) {
  const errors = [];

  if (!code || code.trim().length === 0) {
    errors.push('App code is empty');
  }

  if (html.includes(APP_PLACEHOLDER)) {
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
