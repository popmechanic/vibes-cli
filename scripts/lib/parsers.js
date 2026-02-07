/**
 * Parsing utilities for version extraction from CDN URLs
 */

/**
 * Extract version from a URL string
 * e.g., "https://esm.sh/use-vibes@0.24.3-dev?external=react" -> "0.24.3-dev"
 * @param {string} url - The URL to parse
 * @returns {string|null} - Version string or null
 */
export function extractVersion(url) {
  if (!url) return null;
  const match = url.match(/@([\d.]+[^?/]*)/);
  return match ? match[1] : null;
}
