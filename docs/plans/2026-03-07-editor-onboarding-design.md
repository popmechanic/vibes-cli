# Editor Onboarding — Zero-Friction First-Time Experience

## Design Goal

The least friction-inducing first-time user experience possible. The audience is people who have never built an app. The product should make them feel like they belong here and can do this.

## Core Principle

Onboarding is exactly one step: sign in. Everything else is deferred or hardcoded.

## Welcome Screen

First visit (no cached tokens):

```
┌─────────────────────────────────┐
│                                 │
│        Welcome to Vibes         │
│                                 │
│   Describe an app and we'll     │
│   build it. Create an account   │
│   to save and share your apps.  │
│                                 │
│     [ Create your account ]     │
│                                 │
└─────────────────────────────────┘
```

Returning user (expired/cached tokens exist): same layout, button reads **"Sign in"** instead.

**Smart label logic:** `/editor/status` checks `~/.vibes/auth.json`. If cached tokens exist (even expired), show "Sign in". If no tokens at all, show "Create your account."

**Valid tokens:** Skip welcome entirely — go straight to generate (no `app.jsx`) or edit (`app.jsx` exists).

## Auth Flow

1. User clicks the button
2. Editor sends `POST /editor/auth/login` to the server
3. Server calls `loginWithBrowser()` from `cli-auth.js` (hardcoded `OIDC_AUTHORITY` and `OIDC_CLIENT_ID` from `auth-constants.js`)
4. New browser tab opens to Pocket ID
5. Editor UI shows waiting state:

```
┌─────────────────────────────────┐
│                                 │
│        Welcome to Vibes         │
│                                 │
│     ◌ Waiting for sign in...    │
│                                 │
└─────────────────────────────────┘
```

6. Auth completes — server sends WebSocket message: `{ type: 'auth_complete', user: { name } }`
7. Brief acknowledgment (~1.5 seconds):

```
┌─────────────────────────────────┐
│                                 │
│     Welcome, Marcus!            │
│                                 │
└─────────────────────────────────┘
```

8. Transition to generate phase

### Edge Cases

- **Login timeout (5 min):** Show "Sign in timed out" with "Try again" button
- **Browser didn't open:** Terminal shows manual URL (existing `cli-auth.js` behavior)
- **User closes Pocket ID tab:** Stays in waiting state until timeout

## Returning User Fast Path

```
Page loads → /editor/status
  → tokens valid (or silent refresh succeeds) → generate/edit phase
  → tokens expired, refresh failed            → welcome ("Sign in")
  → no tokens at all                          → welcome ("Create your account")
```

Server attempts `refreshTokens()` silently before responding to `/editor/status`. Refresh success = fast path.

## Deploy

The user authenticated during onboarding, so `~/.vibes/auth.json` has valid (or refreshable) tokens. The deploy handler's existing `getAccessToken({ silent: true })` reads the cache.

If the token expired between auth and deploy: `getAccessToken` tries refresh first. If refresh fails, the deploy handler sends a WebSocket message that re-triggers the welcome screen with "Sign in" — same flow, just re-auth.

## What Gets Removed

### Editor template (`editor.html`)
- Entire 6-step wizard UI (OIDC fields, Connect Studio, Cloudflare tokens, OpenRouter key, Confirm & Save)
- All wizard JavaScript (`setWizardStep`, `validateWizardOidcInputs`, `selectStudioMode`, `checkStudio`, `validateWizardCfInputs`, `validateAndAdvanceCf`, `validateOpenRouterKey`, `renderWizardSummary`, `wizardSave`, `prefillFromStatus`)
- All wizard/setup CSS (`.wizard-*`, `.setup-*` classes)
- `checkEditorDeps()` / `renderChecklist()` flow

### Server (`editor-api.js`)
- `checkEditorDeps()` — replaced by auth-only status check
- `saveCredentials()` — nothing to save during onboarding
- `/editor/status` rewritten to only check auth state

## What Gets Added

### Server
- `POST /editor/auth/login` — triggers `loginWithBrowser()`, sends WebSocket `auth_complete` on success
- Simplified `/editor/status` — returns `{ auth: { cached, valid, userName } }`

### Editor template
- Simple welcome card (one headline, one sentence, one button)
- Waiting state (spinner + message)
- Acknowledgment state (name + checkmark, 1.5s)
- WebSocket handler for `auth_complete` message

## What's Kept

- `cli-auth.js` — already does everything needed
- `auth-constants.js` — hardcoded OIDC values
- Deploy handler — existing `silent: true` auth check works
- OpenRouter key — stays in `~/.vibes/.env`, surfaced later via settings (separate future task)

## OpenRouter Key

Removed from onboarding entirely. Will be surfaced later via a settings UI, or prompted when the user first tries an AI feature (theme generation, `useAI` hook). Not part of this design.
