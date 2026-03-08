/**
 * Shared environment/config utilities
 *
 * OIDC config validation and Connect config population.
 */


// Connect config placeholders (OIDC constants are hardcoded in auth-constants.js)
export const CONFIG_PLACEHOLDERS = {
  '__VITE_API_URL__': 'VITE_API_URL',
  '__VITE_CLOUD_URL__': 'VITE_CLOUD_URL',
};


/**
 * Validate that an OIDC authority URL is valid (must be HTTPS)
 * @param {string} url - The OIDC authority URL
 * @returns {boolean}
 */
export function validateOIDCAuthority(url) {
  return typeof url === 'string' && url.startsWith('https://');
}

/**
 * Validate that an OIDC client ID is a non-empty string
 * @param {string} id - The OIDC client ID
 * @returns {boolean}
 */
export function validateOIDCClientId(id) {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validate that an OpenRouter API key has the correct format
 */
export function validateOpenRouterKey(key) {
  return typeof key === 'string' && key.startsWith('sk-or-');
}

/**
 * Replace Connect config placeholders with values from .env
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

/**
 * Derive Connect URLs from a studio name (legacy exe.dev pattern).
 * NOTE: registry.js has a different deriveConnectUrls for Cloudflare Workers URLs.
 * @param {string} studioName - Studio name or full hostname
 * @returns {{ apiUrl: string, cloudUrl: string }}
 */
export function deriveStudioUrls(studioName) {
  if (!studioName || typeof studioName !== 'string') {
    throw new Error('Studio name is required');
  }
  const name = studioName.trim();
  // If it already contains dots, treat as full hostname
  const host = name.includes('.') ? name : `${name}.exe.xyz`;
  return {
    apiUrl: `https://${host}/api/`,
    cloudUrl: `fpcloud://${host}?protocol=wss`,
  };
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
