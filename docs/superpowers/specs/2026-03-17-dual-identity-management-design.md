# Dual Identity Management in Editor Settings

## Problem

VibesOS has two independent identity systems:

1. **Pocket ID (vibesos.com)** — OIDC auth for Fireproof sync, sharing, and invites
2. **Claude (Anthropic)** — CLI auth for AI-powered editing via `claude -p` subprocesses

The editor settings panel currently shows only Pocket ID account info with a sign-out button. There is no way to see which Anthropic/Claude account is active, sign out of it, or switch accounts. This makes it impossible to troubleshoot auth issues (e.g., wrong subscription tier, expired credentials, `out_of_credits` errors).

## User Context

Only the "vibe coder admin" (app creator) needs Claude auth. End users of generated apps never interact with Claude credentials. Therefore, Claude account management belongs exclusively in the **editor settings panel**, not in VibesPanel (which ships in every generated app).

## Design

### Editor Settings Panel — Accounts Section

The existing `editSettingsPanel` slide-out gains a second account row below the Pocket ID section:

```
┌─────────────────────────────┐
│ [avatar] Marcus Estes       │  Pocket ID (existing)
│          marcus@vibes.diy   │
│          Sign out            │
├─────────────────────────────┤
│ Claude Account              │  NEW
│   marcus@example.com        │
│   Sign out                  │
├─────────────────────────────┤
│ Deployed Apps               │  (existing)
│ ...                         │
```

The Claude email is fetched from a new server endpoint on panel open. While loading, shows "Loading..." to avoid layout shift. If credentials are missing or expired, shows "Not signed in" instead of an email.

### Server Endpoints

**`GET /editor/auth-status`**

Reads `~/.vibes/claude-config/.claude.json`, extracts the `oauthAccount.emailAddress` field (camelCase, matching Claude CLI's config format). This direct file-read approach avoids subprocess overhead on every panel open. Field names must stay in sync with `checkClaudeAuth()` in `vibes-desktop/src/bun/claude-auth.ts`.

Response:
```json
{ "loggedIn": true, "email": "marcus@example.com" }
```

Or if no valid credentials:
```json
{ "loggedIn": false, "email": null }
```

**`POST /editor/claude-logout`**

1. Runs `claude auth logout` **synchronously** via `Bun.spawnSync` with `CLAUDE_CONFIG_DIR=~/.vibes/claude-config/` and a 10-second timeout (matching the defensive pattern in `checkClaudeAuth()`). Uses the resolved `CLAUDE_BIN` path, not bare `claude`.
2. If logout succeeds, calls `ctx.onClaudeReauth()` callback (see below).
3. Returns `{ ok: true }` on success, `{ ok: false, error: "..." }` on failure.
4. When `ctx.managed` is false (CLI mode, no desktop app), the logout still clears credentials but the re-auth callback is skipped (no-op).

### Desktop App — Re-Auth via ServerContext Callback

The server-to-desktop communication uses a **direct callback on `ServerContext`**, following the same pattern as `ctx.onWindowControl`. The desktop app registers `ctx.onClaudeReauth` when starting the server, and the logout handler calls it directly — no WebSocket hop needed.

In `vibes-desktop/src/bun/index.ts`:
```typescript
ctx.onClaudeReauth = () => {
  showLoginAndWait(mainWindow, "Sign in to continue");
  mainWindow.webview.loadURL(SERVER_URL); // reload after re-auth
};
```

After successful re-auth:
- Desktop app reloads the editor URL
- Editor re-fetches `/editor/auth-status` to display the new account

### Sign-Out Flow (Complete)

```
User clicks "Sign out" under Claude Account
  ↓
Editor calls POST /editor/claude-logout
  ↓
Server runs `claude auth logout` synchronously (spawnSync, 10s timeout)
  ↓
Server calls ctx.onClaudeReauth() callback directly
  ↓
Desktop app calls showLoginAndWait() → shows login screen
  ↓
User authenticates in browser → claude auth completes
  ↓
Desktop app reloads editor URL
  ↓
Editor fetches GET /editor/auth-status → displays new email
```

## Files to Modify

| File | Change |
|------|--------|
| `skills/vibes/templates/editor.html` | Add Claude account section to `editSettingsPanel`, fetch auth status on panel open, add `claudeSignOut()` function |
| `scripts/server/router.ts` | Add `GET /editor/auth-status` and `POST /editor/claude-logout` routes |
| `scripts/server/config.ts` | Add `onClaudeReauth?: () => void` to `ServerContext` interface |
| `vibes-desktop/src/bun/index.ts` | Register `ctx.onClaudeReauth` callback after server start |

## Out of Scope

- Claude account management in the setup wizard (not needed — momentary phase)
- Claude account display in VibesPanel (only ships in generated apps for end users)
- Removing the `CLAUDE_CONFIG_DIR` isolation (separate issue from this feature)
- Web-only editor (CLI `/launch` path) — desktop-only feature
- Displaying subscription tier/plan info (follow-up enhancement)
