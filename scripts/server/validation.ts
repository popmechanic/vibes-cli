/**
 * Shared validation functions — SSRF guards + credential validation.
 *
 * Single source of truth imported by both router.ts (production Bun server)
 * and handlers/editor-api.js (test-only Node.js shim). Avoids ~300 lines of
 * duplicated business logic drifting between the two files.
 */

import { extractClerkDomain } from '../lib/env-utils.js';

// --- SSRF guard patterns ---
// TODO: Add IPv6 loopback (::1) and link-local (fe80::) guards.
// Currently only checks IPv4 private ranges and hostnames.

export const PRIVATE_PATTERNS = /^(localhost|127\.|10\.|169\.254\.|192\.168\.|0\.)/;
export const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;
export const IS_IP = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Check if a hostname resolves to a private/reserved network address.
 * Used by Clerk and Cloudflare credential validators to prevent SSRF.
 */
export function isPrivateHostname(hostname: string): boolean {
  return IS_IP.test(hostname) ||
    hostname.startsWith('[') ||
    PRIVATE_PATTERNS.test(hostname) ||
    PRIVATE_172.test(hostname);
}

// --- Credential validation ---

const CLERK_TIMEOUT_MS = 10_000;
const CF_TIMEOUT_MS = 10_000;

/**
 * Validate Clerk credentials by probing the Frontend API.
 * The publishable key encodes a domain (base64). We hit that domain's
 * well-known endpoint to verify the key is real.
 */
export async function validateClerkCredentials(
  { publishableKey }: { publishableKey?: string } = {}
): Promise<{ valid: boolean; error?: string }> {
  if (!publishableKey) {
    return { valid: false, error: 'No publishable key provided.' };
  }

  const domain = extractClerkDomain(publishableKey);
  if (!domain) {
    return { valid: false, error: 'Could not decode domain from publishable key. Make sure you copied the full key.' };
  }

  // SSRF guard: reject userinfo bypass (@), private IPs, etc.
  if (domain.includes('@')) {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes a userinfo bypass.' };
  }

  let fapiUrl: URL;
  try {
    fapiUrl = new URL('https://' + domain + '/v1/environment');
  } catch {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes a malformed URL.' };
  }

  const hostname = fapiUrl.hostname;
  if (isPrivateHostname(hostname)) {
    return { valid: false, error: 'Invalid Clerk domain. The key encodes an IP address or reserved hostname.' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLERK_TIMEOUT_MS);
  try {
    const res = await fetch(fapiUrl.href, {
      headers: { 'Authorization': `Bearer ${publishableKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'Key was rejected by Clerk.' };
    }
    return { valid: false, error: `Clerk API returned status ${res.status}.` };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { valid: false, error: 'Clerk API request timed out (10s).' };
    }
    if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
      return { valid: false, error: 'The domain encoded in this key does not exist.' };
    }
    return { valid: false, error: 'Failed to reach Clerk API: ' + err.message };
  }
}

/**
 * Validate Cloudflare credentials via the Cloudflare HTTP API.
 * Supports two auth modes:
 *   - API Token (preferred, scoped): GET /client/v4/user/tokens/verify
 *   - Global API Key (legacy): GET /client/v4/accounts with X-Auth-Key/X-Auth-Email
 */
export async function validateCloudflareCredentials(
  { apiToken, apiKey, email }: { apiToken?: string; apiKey?: string; email?: string } = {}
): Promise<{ valid: boolean; accountId?: string; authMode?: string; error?: string }> {
  try {
    if (apiToken) {
      const verifyCtrl = new AbortController();
      const verifyTimer = setTimeout(() => verifyCtrl.abort(), CF_TIMEOUT_MS);
      const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        signal: verifyCtrl.signal,
      });
      clearTimeout(verifyTimer);
      const verifyData = await verifyRes.json() as any;
      if (!verifyData.success || !verifyRes.ok) {
        return { valid: false, error: (verifyData.errors?.[0]?.message || 'Token verification failed') + '. Check your API Token.' };
      }

      const acctCtrl = new AbortController();
      const acctTimer = setTimeout(() => acctCtrl.abort(), CF_TIMEOUT_MS);
      const acctRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        signal: acctCtrl.signal,
      });
      clearTimeout(acctTimer);
      const acctData = await acctRes.json() as any;
      const accountId = acctData.result?.[0]?.id || null;
      if (!accountId) {
        return { valid: false, error: 'Token valid but no accounts accessible.' };
      }
      return { valid: true, accountId, authMode: 'api-token' };
    }

    if (apiKey && email) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CF_TIMEOUT_MS);
      const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: { 'X-Auth-Key': apiKey, 'X-Auth-Email': email, 'Content-Type': 'application/json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json() as any;
      if (!data.success || !res.ok) {
        return { valid: false, error: (data.errors?.[0]?.message || 'Authentication failed') + '. Check your Global API Key and email.' };
      }
      const accountId = data.result?.[0]?.id || null;
      if (!accountId) {
        return { valid: false, error: 'No accounts found for this API key.' };
      }
      return { valid: true, accountId, authMode: 'global-api-key' };
    }

    return { valid: false, error: 'Provide either an API Token or a Global API Key + email.' };
  } catch (err: any) {
    const msg = err.name === 'AbortError'
      ? 'Cloudflare API request timed out (10s).'
      : 'Failed to reach Cloudflare API: ' + err.message;
    return { valid: false, error: msg };
  }
}
