# Desktop Claude CLI Auth Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auth placeholder in the desktop setup wizard with a real Claude CLI OAuth flow — checking `claude auth status`, showing a "Login with Anthropic" button when needed, spawning `claude auth login`, polling for completion, and gating app startup on valid credentials.

**Architecture:** New `claude-auth.ts` module with three pure functions (check, login, wait). Setup wizard's Step 3 calls these instead of the placeholder. Normal startup path gets a silent auth check that shows the login screen only if credentials are missing/expired. The setup HTML gains four new UI states (login button, waiting spinner, success flash, error).

**Tech Stack:** TypeScript, ElectroBun (Bun runtime), Claude CLI (`claude auth status/login`)

**Spec:** `docs/superpowers/specs/2026-03-09-desktop-claude-auth-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `vibes-desktop/src/bun/claude-auth.ts` | **NEW** — checkClaudeAuth, startClaudeLogin, waitForClaudeAuth |
| `vibes-desktop/src/bun/setup-html.ts` | **MODIFY** — Add login screen UI states (waiting, success, error, auth-email) |
| `vibes-desktop/src/bun/setup.ts` | **MODIFY** — Replace TODO(loom) placeholder with real auth flow |
| `vibes-desktop/src/bun/index.ts` | **MODIFY** — Add auth check on normal (non-setup) startup path |

---

## Task 1: Claude Auth Module

The core auth logic, isolated from UI concerns. Three functions that wrap Claude CLI commands.

**Files:**
- Create: `vibes-desktop/src/bun/claude-auth.ts`

- [ ] **Step 1: Create claude-auth.ts with types and cleanEnv helper**

```typescript
// vibes-desktop/src/bun/claude-auth.ts
// Wraps Claude CLI auth commands for desktop app startup.

import { CLAUDE_BIN } from "./auth.ts";

export interface ClaudeAuthResult {
	loggedIn: boolean;
	email?: string;
	authMethod?: string;
}

/**
 * Clean environment for spawning Claude subprocesses.
 * Loom gotcha #1: Remove nesting guards but preserve CLAUDE_CODE_OAUTH_TOKEN.
 */
function cleanEnv(): Record<string, string | undefined> {
	const env = { ...process.env };
	delete env.CLAUDECODE;
	delete env.CLAUDE_CODE_ENTRYPOINT;
	// Deliberately keep CLAUDE_CODE_OAUTH_TOKEN
	return env;
}
```

- [ ] **Step 2: Add checkClaudeAuth function**

Append to the same file:

```typescript
/**
 * Check if Claude CLI has valid authentication.
 * Spawns `claude auth status` and parses the JSON output.
 */
export function checkClaudeAuth(): ClaudeAuthResult {
	try {
		const result = Bun.spawnSync([CLAUDE_BIN, "auth", "status"], {
			timeout: 10_000,
			env: cleanEnv(),
		});

		const stdout = result.stdout.toString().trim();
		if (!stdout) return { loggedIn: false };

		const status = JSON.parse(stdout);
		return {
			loggedIn: !!status.loggedIn,
			email: status.email,
			authMethod: status.authMethod,
		};
	} catch {
		return { loggedIn: false };
	}
}
```

- [ ] **Step 3: Add startClaudeLogin function**

Append to the same file:

```typescript
/**
 * Start the Claude CLI login flow.
 * Spawns `claude auth login` which opens the system browser.
 * Non-blocking — returns the subprocess reference.
 */
export function startClaudeLogin(): ReturnType<typeof Bun.spawn> {
	return Bun.spawn([CLAUDE_BIN, "auth", "login"], {
		env: cleanEnv(),
		stdout: "ignore",
		stderr: "pipe",
	});
}
```

- [ ] **Step 4: Add waitForClaudeAuth function**

Append to the same file:

```typescript
/**
 * Poll `claude auth status` until loggedIn is true or timeout.
 * @param timeoutMs - Maximum wait time (default 5 minutes)
 * @param pollIntervalMs - Time between polls (default 2 seconds)
 * @returns Auth result on success
 * @throws Error on timeout
 */
export async function waitForClaudeAuth(
	timeoutMs: number = 300_000,
	pollIntervalMs: number = 2_000,
): Promise<ClaudeAuthResult> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		await new Promise(r => setTimeout(r, pollIntervalMs));
		const result = checkClaudeAuth();
		if (result.loggedIn) return result;
	}

	throw new Error("Sign-in timed out — please try again");
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/claude-auth.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add vibes-desktop/src/bun/claude-auth.ts
git commit -m "feat(desktop): add Claude CLI auth module (check, login, wait)"
```

---

## Task 2: Setup HTML — Login Screen States

Add UI functions to the inline HTML for the four login states: auth button visible, waiting spinner, success with email, and error display. These are called from Bun via `executeJavascript()`.

**Files:**
- Modify: `vibes-desktop/src/bun/setup-html.ts`

- [ ] **Step 1: Add CSS for auth-specific states**

After the `.error-detail` CSS block (line 108, before `</style>`), add:

```css
  .auth-waiting {
    font-size: 13px;
    color: #888;
    margin-top: 8px;
    display: none;
    text-align: center;
  }
  .auth-waiting .hint {
    font-size: 11px;
    color: #555;
    margin-top: 4px;
  }
  .auth-email {
    font-size: 14px;
    color: #e0e0e0;
    margin-top: 8px;
    display: none;
    text-align: center;
  }
```

- [ ] **Step 2: Add auth-waiting and auth-email elements to the HTML body**

After the `error-detail` div (line 135, before `</div>` closing `.card`), add:

```html
  <div style="font-size:11px;color:#555;margin-top:6px;text-align:center" id="auth-hint">Opens your browser</div>
  <div class="auth-waiting" id="auth-waiting">
    Complete sign-in in your browser
    <div class="hint">then return here</div>
  </div>
  <div class="auth-email" id="auth-email"></div>
```

- [ ] **Step 3: Add JavaScript UI functions for auth states**

After the `showReady()` function (line 163, before `</script>`), add:

```javascript
function showWaitingForAuth() {
  document.getElementById('auth-btn').style.display = 'none';
  document.getElementById('auth-hint').style.display = 'none';
  document.getElementById('auth-waiting').style.display = 'block';
}
function showAuthSuccess(email) {
  document.getElementById('auth-waiting').style.display = 'none';
  document.getElementById('auth-btn').style.display = 'none';
  document.getElementById('retry-btn').style.display = 'none';
  var el = document.getElementById('auth-email');
  el.textContent = email || 'Authenticated';
  el.style.display = 'block';
}
function showAuthError(msg) {
  document.getElementById('auth-waiting').style.display = 'none';
  document.getElementById('auth-btn').style.display = 'none';
  showError(msg);
  showRetryButton(true);
}
function showLoginScreen(subtitle) {
  document.querySelector('.subtitle').textContent = subtitle || 'Setting up your environment';
  document.querySelector('.steps').style.display = 'none';
  document.getElementById('auth-btn').style.display = 'block';
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/setup-html.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add vibes-desktop/src/bun/setup-html.ts
git commit -m "feat(desktop): add login screen states to setup HTML"
```

---

## Task 3: Setup Orchestrator — Replace Auth Placeholder

Replace the `TODO(loom)` block in `setup.ts` with real auth flow using the `claude-auth.ts` module.

**Files:**
- Modify: `vibes-desktop/src/bun/setup.ts:1-11` (imports)
- Modify: `vibes-desktop/src/bun/setup.ts:147-162` (auth placeholder)

- [ ] **Step 1: Add claude-auth import**

At line 11 (after the `installPlugin` import), add:

```typescript
import { checkClaudeAuth, startClaudeLogin, waitForClaudeAuth } from "./claude-auth.ts";
```

- [ ] **Step 2: Add UI helpers for auth states**

In the `ui` object inside `runSetup()`, insert before the closing `};` on line 91 (after the `ready` method on line 90). Add a trailing comma after `ready`:



```typescript
		waitingForAuth: () =>
			mainWindow.webview.executeJavascript(`showWaitingForAuth()`),
		authSuccess: (email: string) =>
			mainWindow.webview.executeJavascript(`showAuthSuccess("${email.replace(/"/g, '\\"')}")`),
		authError: (msg: string) =>
			mainWindow.webview.executeJavascript(`showAuthError("${msg.replace(/"/g, '\\"')}")`),
```

- [ ] **Step 3: Replace the auth placeholder**

Replace lines 147-162 (the entire `// --- Step 3: Authentication ---` block) with:

```typescript
	// --- Step 3: Authentication ---
	ui.step("auth", "active", "Checking authentication...");
	log("[setup] Checking Claude auth status...");

	let authResult = checkClaudeAuth();

	if (authResult.loggedIn) {
		log(`[setup] Already authenticated as ${authResult.email}`);
		ui.step("auth", "done", `Signed in as ${authResult.email || "authenticated"}`);
	} else {
		log("[setup] Not authenticated, showing login button");
		ui.step("auth", "active", "Sign in to continue");
		ui.showAuth(true);

		// Wait for user to click "Sign in with Anthropic"
		await new Promise<void>((resolve) => {
			const handler = (event: any) => {
				const msg = event.data?.detail;
				if (msg?.type === "setup-action" && msg?.action === "auth") {
					mainWindow.webview.off("host-message", handler);
					resolve();
				}
			};
			mainWindow.webview.on("host-message", handler);
		});

		// Start login and poll for completion
		ui.showAuth(false);
		ui.step("auth", "active", "Waiting for sign-in...");
		ui.waitingForAuth();
		log("[setup] Starting Claude auth login...");

		const loginProc = startClaudeLogin();

		try {
			authResult = await waitForClaudeAuth();
			log(`[setup] Auth successful: ${authResult.email}`);
			ui.authSuccess(authResult.email || "");
			ui.step("auth", "done", `Signed in as ${authResult.email || "authenticated"}`);
		} catch (err: any) {
			// Kill the login process if it's still running
			try { loginProc.kill(); } catch {}
			log(`[setup] Auth failed: ${err.message}`);
			ui.step("auth", "error", "Sign-in failed");
			ui.authError(err.message);

			// Wait for retry — reuse existing pattern
			authResult = await waitForRetry(mainWindow, async () => {
				ui.showRetry(false);
				ui.showError("");
				ui.step("auth", "active", "Waiting for sign-in...");
				ui.waitingForAuth();
				const retryProc = startClaudeLogin();
				try {
					const result = await waitForClaudeAuth();
					return result;
				} catch (retryErr) {
					try { retryProc.kill(); } catch {}
					throw retryErr;
				}
			}, log);
			ui.authSuccess(authResult.email || "");
			ui.step("auth", "done", `Signed in as ${authResult.email || "authenticated"}`);
		}
	}
```

- [ ] **Step 4: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/setup.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors (may warn about electrobun import — that's fine)

- [ ] **Step 5: Commit**

```bash
git add vibes-desktop/src/bun/setup.ts
git commit -m "feat(desktop): wire Claude CLI auth into setup wizard step 3"
```

---

## Task 4: Entry Point — Auth Check on Normal Startup

Add a silent auth check when setup is already complete. If credentials are missing, show the login screen before loading the editor.

**Files:**
- Modify: `vibes-desktop/src/bun/index.ts:18-21` (imports)
- Modify: `vibes-desktop/src/bun/index.ts:132-153` (normal startup path)

- [ ] **Step 1: Add claude-auth import**

At line 21 (after the `SETUP_HTML` import), add:

```typescript
import { checkClaudeAuth, startClaudeLogin, waitForClaudeAuth } from "./claude-auth.ts";
```

- [ ] **Step 2: Add auth check function**

After the `getAppVersion()` function (after line 56), add:

```typescript
/**
 * Show the login screen in the given window and wait for auth completion.
 * Used both during first-launch setup and on normal startup when credentials expire.
 * Includes retry loop — never throws, keeps showing login until the user succeeds.
 */
async function showLoginAndWait(
	mainWindow: BrowserWindow,
	subtitle: string,
): Promise<ClaudeAuthResult> {
	// Load setup HTML and switch to login-only view
	mainWindow.webview.loadHTML(SETUP_HTML);
	await new Promise(r => setTimeout(r, 300));
	mainWindow.webview.executeJavascript(`showLoginScreen("${subtitle.replace(/"/g, '\\"')}")`);

	while (true) {
		// Wait for button click (auth or retry)
		await new Promise<void>((resolve) => {
			const handler = (event: any) => {
				const msg = event.data?.detail;
				if (msg?.type === "setup-action" && (msg?.action === "auth" || msg?.action === "retry")) {
					mainWindow.webview.off("host-message", handler);
					resolve();
				}
			};
			mainWindow.webview.on("host-message", handler);
		});

		// Start login and poll
		mainWindow.webview.executeJavascript(`showWaitingForAuth()`);
		const loginProc = startClaudeLogin();

		try {
			const result = await waitForClaudeAuth();
			mainWindow.webview.executeJavascript(`showAuthSuccess("${(result.email || "").replace(/"/g, '\\"')}")`);
			await new Promise(r => setTimeout(r, 1000));
			return result;
		} catch (err: any) {
			try { loginProc.kill(); } catch {}
			log(`[vibes-desktop] Auth failed: ${err.message}`);
			mainWindow.webview.executeJavascript(`showAuthError("${err.message.replace(/"/g, '\\"')}")`);
			// Loop back — retry button click will re-enter the while loop
		}
	}
}
```

Add `ClaudeAuthResult` to the import:

```typescript
import { checkClaudeAuth, startClaudeLogin, waitForClaudeAuth, type ClaudeAuthResult } from "./claude-auth.ts";
```

- [ ] **Step 3: Add auth check after setup verification in normal startup**

In the `else` branch of `if (needsSetup)` (the normal startup path, lines 132-153), add an auth check after the existing Claude binary and plugin checks. After line 153 (the closing `}` of the plugin check), before `// Expose resolved Claude path` (line 155), insert:

```typescript

	// --- Auth check (both paths) ---
	log("[vibes-desktop] Checking Claude auth...");
	const authCheck = checkClaudeAuth();
	if (!authCheck.loggedIn) {
		log("[vibes-desktop] Not authenticated, showing login screen");
		await showLoginAndWait(mainWindow, needsSetup ? "Setting up your environment" : "Welcome back");
	} else {
		log(`[vibes-desktop] Authenticated as ${authCheck.email}`);
	}
```

Note: This goes AFTER both the setup path and the normal path converge (after line 153), so auth is checked regardless of which branch was taken. In the setup path, auth was already handled by `runSetup()`, so `checkClaudeAuth()` will return `loggedIn: true` and this is a no-op.

- [ ] **Step 4: Verify compilation**

Run: `cd vibes-desktop && bun build --no-bundle src/bun/index.ts --outdir /tmp/verify-build 2>&1`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add vibes-desktop/src/bun/index.ts
git commit -m "feat(desktop): add silent auth check on normal startup"
```

---

## Task 5: Update Plan Documentation

Update the original distribution plan to mark Task 9 as implemented.

**Files:**
- Modify: `docs/plans/2026-03-09-desktop-bundled-distribution-plan.md:937-957`

- [ ] **Step 1: Update Task 9 header and content**

Replace the Task 9 section (lines 937-957) to reflect that auth is now implemented:

```markdown
## Task 9: Auth Flow — Claude CLI OAuth

> **Implemented.** See `docs/superpowers/specs/2026-03-09-desktop-claude-auth-design.md` for the design spec and `docs/superpowers/plans/2026-03-09-desktop-claude-auth.md` for the implementation plan.

**What was built:**
- `claude-auth.ts` — checkClaudeAuth, startClaudeLogin, waitForClaudeAuth functions
- Setup wizard Step 3 gates on `claude auth status`, shows "Login with Anthropic" button, spawns `claude auth login`, polls for completion
- Normal startup path runs silent auth check, shows login screen if credentials are missing/expired
- Unified login screen with four states: ready, waiting, success, error
- Pocket ID auth deferred to first deploy (handled by existing `cli-auth.js`)
```

- [ ] **Step 2: Commit**

```bash
git add docs/plans/2026-03-09-desktop-bundled-distribution-plan.md
git commit -m "docs: mark Task 9 auth flow as implemented"
```

---

## Verification

After all tasks are complete:

- [ ] **Build check:** `cd vibes-desktop && bun build --no-bundle src/bun/index.ts --outdir /tmp/verify-build 2>&1` — no errors
- [ ] **Full app build:** `bash scripts/build-desktop.sh` — builds successfully
- [ ] **Test first launch:** Delete `~/.vibes/setup-complete-*` and launch. Verify:
  - Setup UI appears with 3 steps
  - Steps 1-2 complete automatically
  - Step 3 shows "Sign in to continue" and the "Login with Anthropic" button
  - Clicking button opens browser to Anthropic login
  - After completing browser login, app shows email and transitions to editor
- [ ] **Test subsequent launch (auth valid):** Launch again. Verify editor loads directly with no login prompt (sub-second)
- [ ] **Test expired auth:** Run `claude auth logout`, then launch. Verify:
  - Login screen appears with "Welcome back" subtitle
  - No step checklist (just the login button)
  - Completing login transitions to editor
- [ ] **Test timeout:** Start login, don't complete it in browser, wait 5 minutes. Verify error message and retry button appear
