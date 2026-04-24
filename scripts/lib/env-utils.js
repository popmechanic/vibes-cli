/**
 * Shared environment/config utilities
 *
 * App config population.
 */


// Legacy Connect config placeholders (kept for sell template compatibility)
export const CONFIG_PLACEHOLDERS = {
  '__VITE_API_URL__': 'VITE_API_URL',
  '__VITE_CLOUD_URL__': 'VITE_CLOUD_URL',
};

// TinyBase app config placeholders — injected at deploy time by Deploy API,
// or with safe defaults in preview mode by the editor server.
export const APP_CONFIG_PLACEHOLDERS = {
  '__APP_NAME__': 'preview-app',
  '__WS_URL__': '__WS_URL__',       // left as placeholder = sync skipped (template checks startsWith('__'))
  '__APP_PUBLIC__': 'true',          // preview runs as public (no auth gate)
  // Factory-mode fields — only the factory assembler sets these to real
  // values. In preview mode and for non-factory deploys they need safe
  // defaults; otherwise the template's `factoryMode: __FACTORY_MODE__,`
  // line evaluates as a reference to an undefined identifier and crashes
  // the preview with a ReferenceError.
  '__FACTORY_MODE__': 'false',       // literal `false` — no quotes in the template
  '__FACTORY_BASE__': '',            // empty string — factoryBase only meaningful in factory-mode apps
};


/**
 * Replace app config placeholders with values from env vars object
 * @param {string} html - Template HTML
 * @param {object} envVars - Environment variables
 * @param {boolean} [globalReplace=false] - Use global regex replacement (for sell templates with multiple occurrences)
 */

// Legacy — validates Connect URLs for backward compatibility
/**
 * Validate Connect URL format
 * @param {string} url - URL to validate
 * @param {'api'|'cloud'} type - URL type
 */
export function validateConnectUrl(url, type) {
  if (!url || typeof url !== 'string') return false;
  if (type === 'api') return url.startsWith('https://');
  if (type === 'cloud') return url.startsWith('fpcloud://');
  return false;
}


export function populateConnectConfig(html, envVars, globalReplace = false) {
  let result = html;

  // Legacy Connect placeholders
  for (const [placeholder, envKey] of Object.entries(CONFIG_PLACEHOLDERS)) {
    const value = envVars[envKey] || '';
    if (globalReplace) {
      result = result.replace(new RegExp(placeholder, 'g'), value);
    } else {
      result = result.replace(placeholder, value);
    }
  }

  // TinyBase app config placeholders — use provided values or safe defaults.
  // `in` check (not ||) so a caller can intentionally pass '' / 'false' / '0'
  // without silently getting the default back.
  for (const [placeholder, defaultValue] of Object.entries(APP_CONFIG_PLACEHOLDERS)) {
    const value = placeholder in envVars ? envVars[placeholder] : defaultValue;
    result = result.replaceAll(placeholder, value);
  }

  return result;
}
