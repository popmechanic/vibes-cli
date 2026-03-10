/**
 * Shared OIDC auth constants
 *
 * These are the same for every Vibes app. The single Pocket ID instance
 * and shared OIDC client are managed infrastructure — users never configure these.
 * OIDC_CLIENT_ID is the shared CLI client; per-app client IDs are injected at deploy time.
 */

export const OIDC_AUTHORITY = 'https://vibesos.com';
export const OIDC_CLIENT_ID = '6c154be6-e6fa-47f3-ad2b-31740cedc1f1';
export const DEPLOY_API_URL = 'https://share.vibesos.com';
export const AI_PROXY_URL = 'https://ai.vibesos.com';
