/**
 * Shared environment/config utilities
 *
 * Connect config population.
 */


// Connect config placeholders (OIDC constants are hardcoded in auth-constants.js)
export const CONFIG_PLACEHOLDERS = {
  '__VITE_API_URL__': 'VITE_API_URL',
  '__VITE_CLOUD_URL__': 'VITE_CLOUD_URL',
};


/**
 * Replace Connect config placeholders with values from env vars object
 * @param {string} html - Template HTML
 * @param {object} envVars - Environment variables
 * @param {boolean} [globalReplace=false] - Use global regex replacement (for sell templates with multiple occurrences)
 */

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

  for (const [placeholder, envKey] of Object.entries(CONFIG_PLACEHOLDERS)) {
    const value = envVars[envKey] || '';
    if (globalReplace) {
      result = result.replace(new RegExp(placeholder, 'g'), value);
    } else {
      result = result.replace(placeholder, value);
    }
  }

  return result;
}
