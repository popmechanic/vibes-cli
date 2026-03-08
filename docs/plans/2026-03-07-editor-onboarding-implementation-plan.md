# Editor Onboarding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 6-step setup wizard with a single-step sign-in flow using the shared Pocket ID instance.

**Architecture:** The editor's `/editor/status` endpoint checks `~/.vibes/auth.json` for cached tokens. If valid, skip to generate/edit. If expired or missing, show a welcome screen with one button. Clicking it hits `POST /editor/auth/login`, which calls `loginWithBrowser()` server-side. On completion, the server broadcasts `auth_complete` via WebSocket. The client shows a brief greeting, then transitions to generate.

**Tech Stack:** Node.js HTTP server, WebSocket (ws), OIDC PKCE via cli-auth.js, editor.html (vanilla JS/HTML)

**Design doc:** `docs/plans/2026-03-07-editor-onboarding-design.md`

**Design skill:** Tasks 3, 4, and 5 touch the user-facing welcome screen. When implementing those tasks, invoke the `emil-design-engineering` skill and apply its principles — particularly animations (enter/exit transitions, easing), UI polish (typography, shadows, spacing), and accessibility (reduced motion, keyboard nav, tap targets). The welcome screen is the first thing a non-technical user sees; it should feel subtly vibrant, warm, and alive. Refer to the skill's animation decision flowchart and easing guide. Key constraints from the skill:
- Animate with ease-out, 150-250ms for user-initiated transitions
- The greeting acknowledgment (1.5s) should fade/scale in, not just appear
- Spinner should respect `prefers-reduced-motion`
- Button needs 44px+ tap target, hover enhancement only via `@media (hover: hover)`
- No `transition: all` — specify exact properties
- No layout shift between welcome states (use consistent card dimensions)

---

## Task 1: Rewrite `/editor/status` to Auth-Only Check

**Files:**
- Modify: `scripts/server/handlers/editor-api.js:53-128`
- Create: `scripts/__tests__/unit/editor-status.test.js`

**Step 1: Write failing tests for the new status endpoint**

Create `scripts/__tests__/unit/editor-status.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock cli-auth before importing the module under test
vi.mock('../../lib/cli-auth.js', () => ({
  readCachedTokens: vi.fn(),
  isTokenExpired: vi.fn(),
  getAccessToken: vi.fn(),
}));

// Mock auth-constants
vi.mock('../../lib/auth-constants.js', () => ({
  OIDC_AUTHORITY: 'https://test-authority.example.com',
  OIDC_CLIENT_ID: 'test-client-id',
}));

import { readCachedTokens, isTokenExpired, getAccessToken } from '../../lib/cli-auth.js';
import { checkAuthStatus } from '../../server/handlers/editor-api.js';

describe('checkAuthStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns state "none" when no cached tokens', async () => {
    readCachedTokens.mockReturnValue(null);
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('none');
    expect(result.auth.userName).toBe(null);
  });

  it('returns state "valid" with userName when token is not expired', async () => {
    readCachedTokens.mockReturnValue({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    isTokenExpired.mockReturnValue(false);
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('valid');
    expect(result.auth.userName).toBe('Marcus');
  });

  it('returns state "valid" after successful silent refresh', async () => {
    readCachedTokens.mockReturnValue({
      accessToken: 'old',
      refreshToken: 'refresh',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
    });
    isTokenExpired.mockReturnValue(true);
    getAccessToken.mockResolvedValue({
      accessToken: 'new',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('valid');
  });

  it('returns state "expired" when refresh fails', async () => {
    readCachedTokens.mockReturnValue({
      accessToken: 'old',
      refreshToken: 'refresh',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
      expiresAt: Math.floor(Date.now() / 1000) - 100,
    });
    isTokenExpired.mockReturnValue(true);
    getAccessToken.mockResolvedValue(null);
    const result = await checkAuthStatus();
    expect(result.auth.state).toBe('expired');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/editor-status.test.js`
Expected: FAIL — `checkAuthStatus` is not exported

**Step 3: Implement `checkAuthStatus` and rewrite the `status` handler**

In `scripts/server/handlers/editor-api.js`:

1. Add imports at the top:
```javascript
import { readCachedTokens, isTokenExpired, getAccessToken } from '../../lib/cli-auth.js';
import { OIDC_AUTHORITY, OIDC_CLIENT_ID } from '../../lib/auth-constants.js';
```

2. Replace `checkEditorDeps()` (lines 53-120) with:
```javascript
/**
 * Parse the 'name' claim from a JWT id_token without verification.
 * Returns null if parsing fails or name is absent.
 */
function parseUserNameFromIdToken(idToken) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    return payload.name || payload.preferred_username || null;
  } catch {
    return null;
  }
}

/**
 * Check auth state from cached tokens.
 * Returns { auth: { state: 'valid'|'expired'|'none', userName: string|null } }
 */
export async function checkAuthStatus() {
  const cached = readCachedTokens();

  if (!cached) {
    return { auth: { state: 'none', userName: null } };
  }

  if (!isTokenExpired(cached.expiresAt)) {
    return { auth: { state: 'valid', userName: parseUserNameFromIdToken(cached.idToken) } };
  }

  // Try silent refresh
  try {
    const refreshed = await getAccessToken({
      authority: OIDC_AUTHORITY,
      clientId: OIDC_CLIENT_ID,
      silent: true,
    });
    if (refreshed) {
      return { auth: { state: 'valid', userName: parseUserNameFromIdToken(refreshed.idToken) } };
    }
  } catch {
    // refresh failed
  }

  return { auth: { state: 'expired', userName: parseUserNameFromIdToken(cached.idToken) } };
}
```

3. Rewrite the `status` handler:
```javascript
export async function status(ctx, req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const result = await checkAuthStatus();
  return res.end(JSON.stringify(result));
}
```

**Step 4: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/editor-status.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/server/handlers/editor-api.js scripts/__tests__/unit/editor-status.test.js
git commit -m "Rewrite /editor/status to auth-only check"
```

---

## Task 2: Add `POST /editor/auth/login` Endpoint

**Files:**
- Modify: `scripts/server/handlers/editor-api.js`
- Modify: `scripts/server/routes.js`
- Modify: `scripts/preview-server.js`
- Create: `scripts/__tests__/unit/editor-auth-login.test.js`

**Step 1: Write failing test for the login handler**

Create `scripts/__tests__/unit/editor-auth-login.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/cli-auth.js', () => ({
  loginWithBrowser: vi.fn(),
  readCachedTokens: vi.fn(),
  isTokenExpired: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('../../lib/auth-constants.js', () => ({
  OIDC_AUTHORITY: 'https://test-authority.example.com',
  OIDC_CLIENT_ID: 'test-client-id',
}));

import { loginWithBrowser } from '../../lib/cli-auth.js';
import { handleAuthLogin } from '../../server/handlers/editor-api.js';

describe('handleAuthLogin', () => {
  let ctx, req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = {
      wss: {
        clients: new Set(),
      },
    };
    req = {};
    res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
  });

  it('calls loginWithBrowser and returns success', async () => {
    loginWithBrowser.mockResolvedValue({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
    });

    await handleAuthLogin(ctx, req, res);

    expect(loginWithBrowser).toHaveBeenCalledWith({
      authority: 'https://test-authority.example.com',
      clientId: 'test-client-id',
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it('broadcasts auth_complete to WebSocket clients', async () => {
    const mockSend = vi.fn();
    const mockClient = { readyState: 1, send: mockSend };
    ctx.wss.clients.add(mockClient);

    loginWithBrowser.mockResolvedValue({
      accessToken: 'tok',
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJuYW1lIjoiTWFyY3VzIn0.fake',
    });

    await handleAuthLogin(ctx, req, res);

    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('"type":"auth_complete"')
    );
  });

  it('returns 500 on login failure', async () => {
    loginWithBrowser.mockRejectedValue(new Error('Login timed out'));

    await handleAuthLogin(ctx, req, res);

    expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd scripts && npx vitest run __tests__/unit/editor-auth-login.test.js`
Expected: FAIL — `handleAuthLogin` is not exported

**Step 3: Implement `handleAuthLogin`**

In `scripts/server/handlers/editor-api.js`, add:

```javascript
import { readCachedTokens, isTokenExpired, getAccessToken, loginWithBrowser } from '../../lib/cli-auth.js';

/**
 * Trigger browser-based Pocket ID login.
 * On success, broadcasts auth_complete to all WebSocket clients.
 */
export async function handleAuthLogin(ctx, req, res) {
  try {
    const tokens = await loginWithBrowser({
      authority: OIDC_AUTHORITY,
      clientId: OIDC_CLIENT_ID,
    });

    const userName = parseUserNameFromIdToken(tokens.idToken);

    // Broadcast to all connected WebSocket clients
    const message = JSON.stringify({ type: 'auth_complete', user: { name: userName } });
    for (const client of ctx.wss.clients) {
      if (client.readyState === 1) {
        try { client.send(message); } catch { /* client may have disconnected */ }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, userName }));
  } catch (err) {
    console.error('[Auth] Login failed:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
```

**Step 4: Wire up the route and ctx.wss**

In `scripts/server/routes.js`, add to the route table:
```javascript
'POST /editor/auth/login':           editorApi.handleAuthLogin,
```

In `scripts/preview-server.js`, after the `wss` is created (line 51), add:
```javascript
ctx.wss = wss;
```

**Step 5: Run tests to verify they pass**

Run: `cd scripts && npx vitest run __tests__/unit/editor-auth-login.test.js`
Expected: PASS

**Step 6: Commit**

```bash
git add scripts/server/handlers/editor-api.js scripts/server/routes.js scripts/preview-server.js scripts/__tests__/unit/editor-auth-login.test.js
git commit -m "Add POST /editor/auth/login endpoint with WebSocket broadcast"
```

---

## Task 3: Replace Wizard HTML with Welcome Screen

> **BEFORE writing any code in this task:** Invoke the `emil-design-engineering` skill via the Skill tool (`skill: "emil-design-engineering"`). Read its animations and UI polish guides. Apply its principles to all CSS in this task — easing, transitions, reduced motion, tap targets, no layout shift.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

This is the editor template, which is generated — but it's the one the server serves directly. The editor template is NOT generated by `merge-templates.js` (that's for `index.html`). It lives at `skills/vibes/templates/editor.html` and is edited directly.

**Step 1: Replace wizard CSS**

In `editor.html`, find the wizard/setup CSS block (around lines 271-452). Replace all `.setup-*` and `.wizard-*` styles with:

```css
/* === PHASE 1: WELCOME === */
.welcome-phase {
  display: flex; align-items: center; justify-content: center;
  min-height: 80vh;
}
.welcome-card {
  background: white; border-radius: 16px; padding: 3rem 2.5rem;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center;
  max-width: 420px; width: 100%;
}
.welcome-title {
  font-size: 1.75rem; font-weight: 800; margin-bottom: 0.75rem;
  color: var(--vibes-near-black);
}
.welcome-subtitle {
  font-size: 1rem; line-height: 1.5; color: #555; margin-bottom: 2rem;
}
.welcome-btn {
  display: inline-block; padding: 0.875rem 2rem; font-size: 1rem;
  font-weight: 700; border: none; border-radius: 10px; cursor: pointer;
  background: var(--vibes-blue); color: white;
  transition: transform 0.1s, box-shadow 0.1s;
}
.welcome-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,154,206,0.3);
}
.welcome-btn:active { transform: translateY(0); }
.welcome-spinner {
  display: inline-block; width: 20px; height: 20px;
  border: 2.5px solid #ccc; border-top-color: var(--vibes-blue);
  border-radius: 50%; animation: spin 0.8s linear infinite;
  vertical-align: middle; margin-right: 0.5rem;
}
@keyframes spin { to { transform: rotate(360deg); } }
.welcome-greeting {
  font-size: 1.5rem; font-weight: 700; color: var(--vibes-near-black);
}
.welcome-check {
  color: var(--vibes-green); margin-left: 0.5rem;
}
```

**Step 2: Replace wizard HTML**

Replace the entire `<!-- Phase 1: Setup -->` div (lines 2361-2549) with:

```html
<!-- Phase 1: Welcome -->
<div class="phase welcome-phase" id="phaseSetup">
  <div class="welcome-card" id="welcomeCard">
    <div id="welcomeDefault">
      <div class="welcome-title">Welcome to Vibes</div>
      <div class="welcome-subtitle">
        Describe an app and we'll build it.<br>
        Create an account to save and share your apps.
      </div>
      <button class="welcome-btn" id="welcomeBtn" onclick="startAuth()">
        Create your account
      </button>
    </div>
    <div id="welcomeWaiting" style="display:none;">
      <div class="welcome-title">Welcome to Vibes</div>
      <div style="margin-top:1.5rem;color:#555;">
        <span class="welcome-spinner"></span> Waiting for sign in...
      </div>
    </div>
    <div id="welcomeGreeting" style="display:none;">
      <div class="welcome-greeting">
        Welcome, <span id="welcomeUserName"></span>! <span class="welcome-check">&#10003;</span>
      </div>
    </div>
    <div id="welcomeError" style="display:none;">
      <div class="welcome-title">Welcome to Vibes</div>
      <div style="margin-top:1rem;color:var(--vibes-red);" id="welcomeErrorMsg"></div>
      <button class="welcome-btn" style="margin-top:1.5rem;" onclick="startAuth()">Try again</button>
    </div>
  </div>
</div>
```

Note: the phase div id stays `phaseSetup` so the existing `setPhase('setup')` call works without renaming the phase system.

**Step 3: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "Replace wizard HTML/CSS with single-step welcome screen"
```

---

## Task 4: Replace Wizard JavaScript with Auth Flow

> **BEFORE writing any code in this task:** If you haven't already, invoke the `emil-design-engineering` skill via the Skill tool (`skill: "emil-design-engineering"`). The greeting acknowledgment should fade/scale in (not just appear). State transitions between welcome/waiting/greeting/error should animate smoothly with ease-out timing.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Remove old wizard JS**

Delete the following functions (approximately lines 2911-2712 in the `<script>` block):
- `wizardStep`, `wizardData`, `cfAuthMode`, `studioCheckTimer`, `studioMode` variables
- `checkSetup()`, `renderChecklist()`, `skipSetup()`, `goToGenerate()`
- `setWizardStep()`, `validateWizardOidcInputs()`, `selectStudioMode()`
- `checkStudio()`, `debouncedCheckStudio()`, `validateAdvancedUrls()`
- `setCfAuthMode()`, `validateWizardCfInputs()`, `validateAndAdvanceCf()`
- `validateOpenRouterKey()` (the wizard version)
- `startStudioDeploy()`, `renderWizardSummary()`, `wizardSave()`, `prefillFromStatus()`

**Step 2: Add new auth flow JS**

Add these functions in the `<script>` block:

```javascript
// === Phase 1: Welcome ===
async function startAuth() {
  // Show waiting state
  document.getElementById('welcomeDefault').style.display = 'none';
  document.getElementById('welcomeError').style.display = 'none';
  document.getElementById('welcomeWaiting').style.display = '';

  try {
    const res = await fetch('/editor/auth/login', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      showWelcomeError(data.error || 'Sign in failed');
    }
    // Success is handled by the WebSocket auth_complete message
  } catch (err) {
    showWelcomeError(err.message || 'Could not reach the server');
  }
}

function showWelcomeError(msg) {
  document.getElementById('welcomeWaiting').style.display = 'none';
  document.getElementById('welcomeDefault').style.display = 'none';
  document.getElementById('welcomeErrorMsg').textContent = msg;
  document.getElementById('welcomeError').style.display = '';
}

function handleAuthComplete(userName) {
  // Show greeting
  document.getElementById('welcomeWaiting').style.display = 'none';
  document.getElementById('welcomeDefault').style.display = 'none';
  document.getElementById('welcomeError').style.display = 'none';
  document.getElementById('welcomeUserName').textContent = userName || 'friend';
  document.getElementById('welcomeGreeting').style.display = '';

  // Transition to generate after 1.5s
  setTimeout(() => {
    fetch('/editor/app-exists').then(r => r.json()).then(data => {
      if (data.exists) {
        setPhase('edit');
      } else {
        setPhase('generate');
        fetch('/editor/initial-prompt').then(r => r.json()).then(data => {
          if (data.prompt) document.getElementById('generatePrompt').value = data.prompt;
        }).catch(() => {});
        document.getElementById('generatePrompt').focus();
      }
    }).catch(() => {
      setPhase('generate');
      document.getElementById('generatePrompt').focus();
    });
  }, 1500);
}
```

**Step 3: Add WebSocket handler for `auth_complete`**

Find the existing WebSocket `onmessage` handler. Add a case for `auth_complete`:

```javascript
// Inside the ws.onmessage handler, add:
if (parsed.type === 'auth_complete') {
  handleAuthComplete(parsed.user?.name);
  return;
}
```

**Step 4: Rewrite the startup decision tree**

Replace the startup logic (lines 5641-5673) with:

```javascript
connectWs();
checkExistingApps();

// Check auth → decide welcome vs generate/edit
fetch('/editor/status').then(r => r.json()).then(status => {
  if (status.auth?.state === 'valid') {
    // Authenticated — go to generate or edit
    fetch('/editor/app-exists').then(r => r.json()).then(data => {
      if (data.exists) {
        setPhase('edit');
      } else {
        setPhase('generate');
        fetch('/editor/initial-prompt').then(r => r.json()).then(data => {
          if (data.prompt) document.getElementById('generatePrompt').value = data.prompt;
        }).catch(() => {});
        document.getElementById('generatePrompt').focus();
      }
    }).catch(() => {
      setPhase('generate');
      document.getElementById('generatePrompt').focus();
    });
  } else {
    // Not authenticated — show welcome
    setPhase('setup');
    // Smart button label
    const btn = document.getElementById('welcomeBtn');
    if (status.auth?.state === 'expired') {
      btn.textContent = 'Sign in';
    }
  }
}).catch(() => {
  // Network error — show welcome anyway
  setPhase('setup');
});

populateThemeSelect();
fetch('/themes/has-key').then(r => r.json()).then(d => { hasOpenRouterKey = !!d.hasKey; }).catch(() => {});
```

**Step 5: Commit**

```bash
git add skills/vibes/templates/editor.html
git commit -m "Replace wizard JS with single-step auth flow"
```

---

## Task 5: Update Deploy Handler for Re-Auth

> **Design note:** The re-auth transition (deploy fails → welcome screen reappears) should animate smoothly. If you haven't already invoked the `emil-design-engineering` skill, do so now via the Skill tool (`skill: "emil-design-engineering"`).

**Files:**
- Modify: `scripts/server/handlers/deploy.js:29-41`

**Step 1: Replace terminal error with re-auth trigger**

In `deploy.js`, replace the `silent: true` error block (lines 29-41):

```javascript
// Auto-obtain token via Pocket ID if not provided by client
if (!token) {
  onEvent({ type: 'progress', progress: 1, stage: 'Checking authentication...', elapsed: 0 });
  try {
    const tokens = await getAccessToken({ authority: OIDC_AUTHORITY, clientId: OIDC_CLIENT_ID, silent: true });
    if (!tokens) {
      onEvent({ type: 'auth_required' });
      return;
    }
    token = tokens.accessToken;
  } catch (err) {
    onEvent({ type: 'auth_required' });
    return;
  }
}
```

Then in the editor template's WebSocket handler, add a case:

```javascript
if (parsed.type === 'auth_required') {
  setPhase('setup');
  const btn = document.getElementById('welcomeBtn');
  btn.textContent = 'Sign in';
  document.getElementById('welcomeDefault').style.display = '';
  document.getElementById('welcomeWaiting').style.display = 'none';
  document.getElementById('welcomeGreeting').style.display = 'none';
  document.getElementById('welcomeError').style.display = 'none';
  return;
}
```

**Step 2: Commit**

```bash
git add scripts/server/handlers/deploy.js skills/vibes/templates/editor.html
git commit -m "Replace deploy auth error with re-auth trigger"
```

---

## Task 6: Clean Up Old Wizard Code

**Files:**
- Modify: `scripts/server/handlers/editor-api.js`
- Modify: `scripts/server/routes.js`

**Step 1: Remove old handler functions from editor-api.js**

Delete these functions (they were only used by the wizard):
- `checkEditorDeps()` (already replaced in Task 1)
- `saveCredentials()`
- `validateCloudflare()`
- `validateOidc()`
- `checkStudio()`

Remove imports that are only used by deleted functions:
- `loadEnvFile`, `validateOIDCAuthority`, `validateOIDCClientId`, `validateConnectUrl`, `deriveStudioUrls`, `writeEnvFile` from env-utils (check if any are still used by remaining handlers first)
- `loadRegistry`, `getCloudflareConfig`, `setCloudflareConfig` from registry (check if still used)

**Step 2: Remove old routes from routes.js**

Delete these routes from the route table:
```javascript
'POST /editor/credentials':                        // saveCredentials
'POST /editor/credentials/validate-cloudflare':     // validateCloudflare
'POST /editor/credentials/validate-oidc':           // validateOidc
'POST /editor/credentials/check-studio':            // checkStudio
```

**Step 3: Run full test suite**

Run: `cd scripts && npm test`

Fix any failures caused by removed exports or changed status response shape.

**Step 4: Commit**

```bash
git add scripts/server/handlers/editor-api.js scripts/server/routes.js
git commit -m "Remove old wizard handlers and routes"
```

---

## Task 7: Verify End-to-End

**Step 1: Restore clean state for testing**

```bash
# Remove cached auth to simulate first-time user
rm -f ~/.vibes/auth.json
# Remove local .env (should already be .env.backup)
```

**Step 2: Start the server**

```bash
node scripts/preview-server.js --mode=editor
```

**Step 3: Manual verification checklist**

Open http://localhost:3333 and verify:

- [ ] Welcome screen shows with "Create your account" button
- [ ] Clicking button opens Pocket ID in a new tab
- [ ] Editor shows "Waiting for sign in..."
- [ ] After completing auth, editor shows "Welcome, [name]!"
- [ ] After 1.5s, transitions to generate phase
- [ ] Reload page — skips welcome, goes straight to generate (valid token)
- [ ] Delete `~/.vibes/auth.json`, reload — welcome shows again
- [ ] Create a fake expired token in `auth.json`, reload — button says "Sign in"

**Step 4: Restore backup files**

```bash
mv .env.backup .env
mv ~/.vibes/.env.backup ~/.vibes/.env
mv ~/.vibes/cloudflare-api-token.backup ~/.vibes/cloudflare-api-token
```

**Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "Fix issues found during onboarding E2E verification"
```
