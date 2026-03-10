# Desktop Claude CLI Authentication

## Problem

The desktop app's setup wizard has a placeholder for authentication (Task 9 in the bundled distribution plan). Without auth, `claude -p` fails on first invocation — a confusing experience. Users need valid Anthropic credentials before the editor is useful.

## Decision: Claude CLI Auth Only at Startup

- **Claude CLI auth** is the hard gate. The app can't function without it.
- **Pocket ID auth** is deferred to first deploy. The existing `cli-auth.js` browser flow handles it when `/vibes:cloudflare` runs. No setup wizard involvement.
- Users can generate, preview, and iterate on apps entirely without Pocket ID.

## Auth Primitives

The Claude CLI provides clean auth commands:

| Command | Output | Purpose |
|---------|--------|---------|
| `claude auth status` | JSON: `{ loggedIn, email, authMethod, ... }` | Check current state |
| `claude auth login` | Opens browser for Anthropic OAuth | Trigger login |
| `claude auth logout` | Clears credentials | (not used in our flow) |

## Startup Flow

Two entry points, same auth check:

### First Launch (setup wizard)

```
Install Claude → Install Plugin → Auth Check
                                    ↓
                              loggedIn: true? → mark done, continue
                              loggedIn: false? → show login screen
```

### Subsequent Launch

```
Setup marker exists? → claude auth status
                          ↓
                    loggedIn: true? → editor (zero friction, sub-second)
                    loggedIn: false? → show login screen
```

Silent verification on every launch. No login screen unless credentials are actually missing or expired.

## Login Screen

Unified design for both contexts (first launch and expired session). Same layout, different subtitle:

- First launch: "Setting up your environment" (with completed step checkmarks above)
- Returning user: "Welcome back" or "Your session has expired"

### State Transitions

1. **Ready** — "Login with Anthropic" button, "Opens your browser" hint
2. **Waiting** — Spinner, "Complete sign-in in your browser, then return here"
3. **Success** — Checkmark, user's email displayed, "Launching editor..." (auto-transitions after ~1s)
4. **Error/Timeout** — Error message card, "Try Again" button

### Timing

- Poll `claude auth status` every 2 seconds while waiting
- 5-minute timeout
- Success flash for ~1 second before transitioning to editor

## Architecture

### New Module: `vibes-desktop/src/bun/claude-auth.ts`

Three functions:

- **`checkClaudeAuth()`** — spawn `claude auth status`, parse JSON, return `{ loggedIn, email }` or `{ loggedIn: false }`
- **`startClaudeLogin()`** — spawn `claude auth login` (opens system browser). Non-blocking, returns subprocess handle
- **`waitForClaudeAuth(timeoutMs = 300_000)`** — poll `checkClaudeAuth()` every 2s until `loggedIn: true` or timeout. Returns auth result or throws on timeout.

Uses the existing `CLAUDE_BIN` from `auth.ts` for the binary path. Must use `cleanEnv()` pattern (Loom gotcha #1) — strip `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` env vars but preserve `CLAUDE_CODE_OAUTH_TOKEN`.

### Modified: `vibes-desktop/src/bun/setup.ts`

Replace `TODO(loom)` placeholder (lines 148-162) with:

1. Call `checkClaudeAuth()`
2. If `loggedIn: true` → update UI step to done, continue
3. If `loggedIn: false` → show auth button via `showAuthButton(true)`, wait for host-message click
4. On click → `startClaudeLogin()` + update UI to waiting spinner
5. `waitForClaudeAuth()` → on success: flash email, mark step done, continue
6. On timeout: show error + retry button (reuses existing `waitForRetry` pattern)

### Modified: `vibes-desktop/src/bun/index.ts`

On normal startup (setup already complete), add auth check before starting server:

```
const auth = await checkClaudeAuth();
if (!auth.loggedIn) {
    // Show auth screen in mainWindow (same unified component)
    // Wait for login completion
    // Then continue to server start
}
```

### Modified: `vibes-desktop/src/bun/setup-html.ts`

Add new UI functions to the inline HTML:

- `showLoginScreen(subtitle)` — renders the login button view (replaces or follows step list)
- `showWaitingForAuth()` — spinner + "Complete sign-in in your browser"
- `showAuthSuccess(email)` — checkmark + email address
- `showAuthError(message)` — error card + "Try Again" button

These are called from the Bun process via `mainWindow.webview.executeJavascript()`.

## Files Changed

| File | Change |
|------|--------|
| `vibes-desktop/src/bun/claude-auth.ts` | **NEW** — checkClaudeAuth, startClaudeLogin, waitForClaudeAuth |
| `vibes-desktop/src/bun/setup.ts` | Replace TODO(loom) with real auth flow |
| `vibes-desktop/src/bun/setup-html.ts` | Add login screen states (button, waiting, success, error) |
| `vibes-desktop/src/bun/index.ts` | Add auth check on normal startup path |

## Not in Scope

- Pocket ID auth (handled at deploy time by existing `cli-auth.js`)
- API key auth (Claude CLI handles this internally)
- Token refresh (Claude CLI manages its own credential lifecycle)
- Multi-account support
