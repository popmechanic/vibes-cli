# Dual Identity Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude/Anthropic account visibility and sign-out to the editor settings panel, alongside existing Pocket ID account.

**Architecture:** Two new server endpoints (`GET /editor/claude-auth`, `POST /editor/claude-logout`) read/clear Claude credentials from `~/.vibes/claude-config/.claude.json`. A new `ctx.onClaudeReauth` callback on `ServerContext` lets the desktop app show the re-auth screen when Claude sign-out is triggered. The editor settings panel gets a new "Claude Account" section below the existing Pocket ID account header.

**Tech Stack:** TypeScript (server), HTML/JS (editor template), ElectroBun (desktop app)

**Spec:** `docs/superpowers/specs/2026-03-17-dual-identity-management-design.md`

---

### Task 1: Add `onClaudeReauth` to ServerContext

**Files:**
- Modify: `scripts/server/config.ts:17-36` (ServerContext interface)

- [ ] **Step 1: Add the callback field to the interface**

In `scripts/server/config.ts`, add `onClaudeReauth` to the `ServerContext` interface, right after the existing `onWindowControl` field (line 35):

```typescript
  onWindowControl?: (action: string) => void;
  onClaudeReauth?: () => void;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/server/config.ts
git commit -m "feat(config): add onClaudeReauth callback to ServerContext"
```

---

### Task 2: Add server endpoints for Claude auth status and logout

**Files:**
- Modify: `scripts/server/router.ts` (add two route handlers + route cases)

- [ ] **Step 1: Add imports**

At the top of `scripts/server/router.ts`, add `homedir` to the existing `os` import (or add a new import if not present). Also ensure `readFileSync` and `existsSync` are imported from `fs` (they likely already are).

Check existing imports. Add `homedir` from `os` if missing:

```typescript
import { homedir } from 'os';
```

Also import `resolveClaudeBin` and `cleanEnv` from the claude-subprocess module. Find the existing imports section and add:

```typescript
import { resolveClaudeBin, cleanEnv } from '../lib/claude-subprocess.js';
```

- [ ] **Step 2: Add `editorClaudeAuthStatus` handler**

Add this function near the existing `editorAuthLogout` function (around line 354):

```typescript
function editorClaudeAuthStatus(): Response {
  try {
    const configPath = join(homedir(), '.vibes', 'claude-config', '.claude.json');
    if (!existsSync(configPath)) {
      return json({ loggedIn: false, email: null });
    }
    const data = JSON.parse(readFileSync(configPath, 'utf-8'));
    const email = data?.oauthAccount?.emailAddress || null;
    return json({ loggedIn: !!email, email });
  } catch {
    return json({ loggedIn: false, email: null });
  }
}
```

- [ ] **Step 3: Add `editorClaudeLogout` handler**

Add this function right after `editorClaudeAuthStatus`:

```typescript
function editorClaudeLogout(ctx: ServerContext): Response {
  try {
    const claudeBin = resolveClaudeBin();
    const env = cleanEnv();
    const result = Bun.spawnSync({
      cmd: [claudeBin, 'auth', 'logout'],
      env: env as Record<string, string>,
      timeout: 10_000,
    });
    if (result.exitCode !== 0) {
      const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : '';
      console.error('[Claude Logout] Failed:', stderr);
      return json({ ok: false, error: stderr || 'Logout failed' }, 500);
    }
    // Trigger re-auth in desktop app (no-op in CLI mode)
    if (ctx.managed && ctx.onClaudeReauth) {
      ctx.onClaudeReauth();
    }
    return json({ ok: true });
  } catch (err: any) {
    console.error('[Claude Logout] Error:', err.message);
    return json({ ok: false, error: err.message }, 500);
  }
}
```

- [ ] **Step 4: Add route cases**

In the route switch/case block (around lines 628-643), add the two new routes. Place them near the existing `/editor/auth/*` routes:

```typescript
      case 'GET /editor/claude-auth':       return editorClaudeAuthStatus();
      case 'POST /editor/claude-logout':    return editorClaudeLogout(ctx);
```

- [ ] **Step 5: Commit**

```bash
git add scripts/server/router.ts
git commit -m "feat(server): add Claude auth status and logout endpoints"
```

---

### Task 3: Register `onClaudeReauth` callback in desktop app

**Files:**
- Modify: `vibes-desktop/src/bun/index.ts` (after `ctx.onWindowControl` registration, around line 286)

- [ ] **Step 1: Register the callback**

Add this block right after the `ctx.onWindowControl` registration (after line 286):

```typescript
	// 4d. Wire up Claude re-auth callback
	ctx.onClaudeReauth = async () => {
		log("[vibes-desktop] Claude re-auth triggered");
		await showLoginAndWait(mainWindow, "Sign in to continue");
		mainWindow.webview.loadURL(SERVER_URL);
	};
```

- [ ] **Step 2: Commit**

```bash
git add vibes-desktop/src/bun/index.ts
git commit -m "feat(desktop): register onClaudeReauth callback for Claude sign-out"
```

---

### Task 4: Add Claude account section to editor settings panel

**Files:**
- Modify: `skills/vibes/templates/editor.html` (HTML + CSS + JS)

- [ ] **Step 1: Add CSS for Claude account section**

Find the existing `.account-signout` CSS rule in the editor template (search for `account-signout`). After that rule block, add:

```css
    .claude-account-section {
      padding: 0.75rem 1rem;
      border-top: 1px solid #333;
    }
    .claude-account-label {
      font-size: 0.6875rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #999;
      margin-bottom: 0.35rem;
    }
    .claude-account-email {
      font-size: 0.875rem;
      color: #f0f0f0;
      margin-bottom: 0.25rem;
    }
    .claude-account-signout {
      background: none;
      border: none;
      color: #999;
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0;
      font-family: inherit;
      text-decoration: underline;
    }
    .claude-account-signout:hover { color: var(--vibes-red); }
```

- [ ] **Step 2: Add HTML for Claude account section**

In the `editSettingsPanel` div (around line 2943), add a new section between the Pocket ID sign-out button and the "Deployed Apps" gallery title. Find:

```html
      <button class="account-signout" onclick="signOut()">Sign out</button>
      </div>
    </div>
    <div class="gallery-title">Deployed Apps</div>
```

Insert between the `</div></div>` and `<div class="gallery-title">`:

```html
    <div class="claude-account-section" id="claudeAccountSection">
      <div class="claude-account-label">Claude Account</div>
      <div class="claude-account-email" id="claudeAccountEmail">Loading...</div>
      <button class="claude-account-signout" id="claudeSignOutBtn" onclick="claudeSignOut()" style="display:none">Sign out</button>
    </div>
```

- [ ] **Step 3: Add JavaScript to fetch Claude auth status and handle sign-out**

In the editor's `<script>` section, find the `openEditSettings()` function (around line 3312). At the end of that function, before `editSettingsOpen = true;`, add a call to fetch Claude auth status:

```javascript
    // Fetch Claude auth status
    fetch('/editor/claude-auth').then(r => r.json()).then(data => {
      const emailEl = document.getElementById('claudeAccountEmail');
      const btnEl = document.getElementById('claudeSignOutBtn');
      if (data.loggedIn && data.email) {
        emailEl.textContent = data.email;
        btnEl.style.display = '';
      } else {
        emailEl.textContent = 'Not signed in';
        btnEl.style.display = 'none';
      }
    }).catch(() => {
      document.getElementById('claudeAccountEmail').textContent = 'Not signed in';
    });
```

Then add the `claudeSignOut()` function near the existing `signOut()` function:

```javascript
  function claudeSignOut() {
    if (!confirm('Sign out of Claude? You will need to sign in again to use AI features.')) return;
    const btn = document.getElementById('claudeSignOutBtn');
    btn.disabled = true;
    btn.textContent = 'Signing out...';
    fetch('/editor/claude-logout', { method: 'POST' }).then(r => r.json()).then(data => {
      if (!data.ok) {
        alert('Failed to sign out: ' + (data.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Sign out';
        return;
      }
      // In desktop mode, the app will show re-auth screen and reload.
      // In CLI mode (no desktop), update the UI directly.
      document.getElementById('claudeAccountEmail').textContent = 'Not signed in';
      btn.style.display = 'none';
    }).catch(err => {
      alert('Failed to sign out: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Sign out';
    });
  }
```

- [ ] **Step 4: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat(editor): add Claude account section to settings panel with sign-out"
```

---

### Task 5: Manual integration test

- [ ] **Step 1: Start the server in editor mode**

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(pwd)}"
bun "$VIBES_ROOT/scripts/server.ts" --mode=editor
```

- [ ] **Step 2: Verify `GET /editor/claude-auth` endpoint**

```bash
curl -s http://localhost:3333/editor/claude-auth | python3 -m json.tool
```

Expected: `{ "loggedIn": true/false, "email": "..." }` depending on credentials at `~/.vibes/claude-config/.claude.json`.

- [ ] **Step 3: Open the editor in a browser**

Open `http://localhost:3333`, create or load an app, click the settings gear icon. Verify:
- Pocket ID account section appears (existing behavior)
- Claude Account section appears below it with email or "Not signed in"
- "Sign out" link appears if logged in

- [ ] **Step 4: Test Claude sign-out (desktop only)**

Build and run the desktop app. Open settings, click Claude "Sign out". Verify:
- Confirmation dialog appears
- Login screen shows after confirming
- After re-authenticating, editor reloads with updated Claude email
