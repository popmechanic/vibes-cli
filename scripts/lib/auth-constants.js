/**
 * Shared OIDC auth constants
 *
 * These are the same for every Vibes app. The single Pocket ID instance
 * and shared OIDC client are managed infrastructure — users never configure these.
 */

// TODO: Replace with actual production values after Pocket ID deployment
export const OIDC_AUTHORITY = 'https://pocket-id.vibes.diy';
export const OIDC_CLIENT_ID = 'vibes-apps';
