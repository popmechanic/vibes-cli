/**
 * Utility functions for stripping import/export statements from JSX code
 * before injecting into templates.
 */

/**
 * Remove all import statements from code
 * @param {string} code - Source code
 * @returns {string} Code with imports removed
 */
export function stripImports(code) {
  return code
    // Multi-line imports: import { ... } from "..."
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+["'].*?["'];?\s*$/gm, '')
    // Single-line named/default imports: import X from "..."
    .replace(/^import\s+.*?from\s+["'].*?["'];?\s*$/gm, '')
    // Side-effect imports: import "..."
    .replace(/^import\s+["'].*?["'];?\s*$/gm, '');
}

/**
 * Remove "export default" from function/class declarations
 * @param {string} code - Source code
 * @returns {string} Code with export default removed
 */
export function stripExportDefault(code) {
  return code.replace(/^export\s+default\s+/m, '');
}

/**
 * Remove CONFIG object declarations
 * @param {string} code - Source code
 * @returns {string} Code with CONFIG removed
 */
export function stripConfig(code) {
  return code.replace(/^const\s+CONFIG\s*=\s*\{[\s\S]*?\n\};?\s*$/gm, '');
}

/**
 * Remove declarations of template-provided constants
 * @param {string} code - Source code
 * @param {string[]} constants - Array of constant names to remove
 * @returns {string} Code with constants removed
 */
export function stripConstants(code, constants) {
  let result = code;
  for (const constant of constants) {
    result = result.replace(new RegExp(`^const\\s+${constant}\\s*=.*$`, 'gm'), '');
  }
  return result;
}

/**
 * Remove React destructuring assignments (e.g., const { useState } = React;)
 * These conflict with sell template which already imports React hooks.
 * @param {string} code - Source code
 * @returns {string} Code with React destructuring removed
 */
export function stripReactDestructuring(code) {
  // [^}] (not [\s\S]) so the match can span newlines inside the braces
  // but cannot leap past an unrelated `}` on a preceding line. Without
  // that guard, a destructure earlier in the file would glue onto this
  // one and delete everything between them.
  return code.replace(/^const\s+\{[^}]*\}\s*=\s*React\s*;?\s*$/gm, '');
}

/**
 * Remove window destructuring assignments (e.g., const { useApp } = window;)
 * These conflict with templates that already provide these via ES imports.
 * @param {string} code - Source code
 * @returns {string} Code with window destructuring removed
 */
export function stripWindowDestructuring(code) {
  // See stripReactDestructuring for the [^}] vs [\s\S] rationale.
  return code
    // const { useApp } = window;  (single- or multi-line identifier list)
    .replace(/^const\s+\{[^}]*\}\s*=\s*window\s*;?\s*$/gm, '')
    // Conditional form from older templates: const { useApp } = React.useMemo ? window : {};
    .replace(/^const\s+\{[^}]*\}\s*=\s*React\.useMemo\s*\?\s*window\s*:\s*\{\}\s*;?\s*$/gm, '');
}

/**
 * Strip all template conflicts from app code (imports, exports, CONFIG, constants)
 * @param {string} code - Source code
 * @param {string[]|object} [templateConstantsOrOptions] - Array of constants OR options object
 * @param {string[]} [templateConstantsOrOptions.templateConstants] - Constants the template provides
 * @param {boolean} [templateConstantsOrOptions.stripReactHooks=true] - Strip `const { useState } = React;`
 *   All templates now import React hooks via ES imports, so this should be true (default).
 * @returns {string} Cleaned code ready for template injection
 */
export function stripForTemplate(code, templateConstantsOrOptions = []) {
  // Support both old signature (string[]) and new signature (options object)
  let templateConstants = [];
  let stripReactHooks = true;
  if (Array.isArray(templateConstantsOrOptions)) {
    templateConstants = templateConstantsOrOptions;
  } else {
    templateConstants = templateConstantsOrOptions.templateConstants || [];
    stripReactHooks = templateConstantsOrOptions.stripReactHooks !== false;
  }

  let result = code.trim();
  result = stripImports(result);
  if (stripReactHooks) {
    result = stripReactDestructuring(result);
  }
  result = stripWindowDestructuring(result);
  result = stripExportDefault(result);
  result = stripConfig(result);
  if (templateConstants.length > 0) {
    result = stripConstants(result, templateConstants);
  }
  return result;
}

