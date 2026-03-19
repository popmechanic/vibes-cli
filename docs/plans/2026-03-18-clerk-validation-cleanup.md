# Clerk Validation Cleanup

## Status: Planned

## Background

The project migrated from Clerk to Pocket ID (OIDC) for authentication. Clerk validation code remains in the server but is no longer called by the editor UI.

## Dead Code Locations

### `scripts/server/validation.ts`
- `validateClerkKey()` (line 14) — validates `pk_test_`/`pk_live_` format
- `validateClerkSecretKey()` (line 21) — validates `sk_test_`/`sk_live_` format
- `extractClerkDomain()` (line 29) — decodes base64 domain from Clerk key
- `validateClerkCredentials()` (line 80) — probes Clerk Frontend API to verify key
- `CLERK_TIMEOUT_MS` constant (line 72)

**Keep:** `isPrivateHostname()`, SSRF guard patterns, `validateCloudflareCredentials()` — these are still used.

### `scripts/server/router.ts`
- `editorValidateClerk()` (line 438) — handles `POST /editor/credentials/validate-clerk`
- Clerk key validation inside `editorSaveCredentials()` (lines 385-390) — checks `pk` and `sk` fields
- Clerk status check inside `checkEditorDeps()` (line 96) — reports Clerk key presence
- Import of `validateClerkKey`, `validateClerkSecretKey`, `validateClerkCredentials` (line 19)
- Route entry for `POST /editor/credentials/validate-clerk` (line 652)

### `scripts/server/handlers/editor-api.js` (test shim)
- Parallel implementations of Clerk validation logic for Node.js test environment

## Why It's Not a Simple Delete

`editorSaveCredentials()` handles three credential types in one function: Clerk, OpenRouter, and Cloudflare. The Clerk branches are interleaved with the others. `checkEditorDeps()` builds a status object that includes Clerk key presence alongside other dependency checks.

## Approach

1. Remove `validateClerkKey`, `validateClerkSecretKey`, `extractClerkDomain`, `validateClerkCredentials`, and `CLERK_TIMEOUT_MS` from `validation.ts`
2. Remove `editorValidateClerk()` function and its route from `router.ts`
3. Remove Clerk `pk`/`sk` branches from `editorSaveCredentials()` — keep OpenRouter and Cloudflare handling
4. Remove Clerk status from `checkEditorDeps()` return value
5. Remove Clerk imports from `router.ts` line 19
6. Update `editor-api.js` test shim to match
7. Run full test suite to verify
