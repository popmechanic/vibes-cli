# Perfect Setup Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the editor's setup wizard foolproof for non-technical users — remove the ability to skip required setup, add detailed guidance for obtaining Clerk and Cloudflare keys, improve error messages, auto-skip completed steps, and give users confidence at the summary screen that everything works.

**Architecture:** Changes span three files: `skills/vibes/templates/editor.html` (the wizard UI — vanilla JS in a single-file SPA), `scripts/server/handlers/editor-api.js` (server-side credential validation), and `scripts/server/routes.js` (declarative route table). The wizard stays 4 steps but each step gets richer guidance, better validation feedback, and smarter flow logic. Server-side gets a new Clerk key validation endpoint. Tests cover the server-side validation and the wizard flow state transitions.

**Tech Stack:** Vanilla JS (editor.html), Node.js HTTP server (editor-api.js), vitest for tests

**Key files:**
- `skills/vibes/templates/editor.html` — wizard UI (lines ~2378-2527 for HTML, ~2887-3597 for JS)
- `scripts/server/handlers/editor-api.js` — server-side validation and credential storage
- `scripts/server/routes.js` — declarative route table (lines ~91-111)
- `scripts/__tests__/integration/wizard-flow.test.js` — existing integration tests

---

### Task 1: Remove "Skip for now" and add smart step-skipping

**Problem:** The "Skip for now" button on step 1 lets users bypass setup entirely. They hit cryptic errors later when trying to deploy. Meanwhile, `prefillFromStatus` partially handles skipping completed steps but has gaps: if Clerk is done and Cloudflare is done, it sets validation state but never calls `setWizardStep(4)` — the user sees step 1 with green checks and has to click "Get started" even though everything is configured.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Remove the Skip button from wizard step 1 HTML**

Find the setup-actions div in wizardStep1 (around line 2418-2421):

```html
<!-- BEFORE -->
<div class="setup-actions" style="margin-top:1rem;">
  <button class="btn btn-secondary" onclick="skipSetup()">Skip for now</button>
  <button class="btn btn-primary" id="wizardStartBtn" onclick="setWizardStep(2)">Get started</button>
</div>
```

Replace with:

```html
<!-- AFTER -->
<div class="setup-actions" style="margin-top:1rem;">
  <button class="btn btn-primary" id="wizardStartBtn" onclick="setWizardStep(2)">Get started</button>
</div>
```

**Step 2: Remove the `skipSetup()` function**

Find and delete (around line 3257-3259):

```javascript
function skipSetup() {
  goToGenerate();
}
```

**Step 3: Fix `prefillFromStatus` step-skipping logic (bottom of function only)**

In `prefillFromStatus` (around line 3570-3596), find the step-skipping block at the bottom of the function. Leave the top of the function (Clerk/Cloudflare state-setting blocks) unchanged — Task 7 will rewrite the full function.

Find and replace only the step-skipping block at the bottom:

```javascript
// BEFORE (bottom of prefillFromStatus, around line 3590-3596)
  if (status.clerk?.ok && !status.cloudflare?.ok) {
    setWizardStep(3);
  } else if (status.clerk?.ok && status.cloudflare?.ok) {
    // Both configured — skip to verification (validation already set above)
  }
```

Replace with:

```javascript
// AFTER
  // Smart skip: jump to the first incomplete step
  if (status.clerk?.ok && status.cloudflare?.ok) {
    // Both configured — go straight to summary so user sees confirmation
    setWizardStep(4);
  } else if (status.clerk?.ok && !status.cloudflare?.ok) {
    // Clerk done — skip to Cloudflare
    setWizardStep(3);
  } else if (!status.clerk?.ok && status.cloudflare?.ok) {
    // Cloudflare done but Clerk missing — skip to Clerk
    setWizardStep(2);
  }
  // else: both missing — stay on step 1 (welcome)
```

**Note:** Task 7 will later rewrite the entire `prefillFromStatus` function with masked values, OpenRouter pre-population, and this same step-skipping logic. This task establishes the correct step-skipping behavior early so it can be tested independently.

**Step 4: Run tests to verify nothing breaks**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All existing tests pass (wizard flow tests don't test `skipSetup` directly)

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Remove skip button from setup wizard and fix step-skipping logic"
```

---

### Task 2: Enrich Clerk step with detailed account creation guidance

**Problem:** Step 2 says "Create a free account, then copy your keys" but doesn't explain what to do if the user doesn't have a Clerk account yet. Users need to know: sign up, create an application, find the API Keys page. The current "Quick steps" are too terse.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Replace the Clerk step HTML with expanded guidance**

Find the wizardStep2 div (around line 2425-2448). Replace its contents:

```html
<!-- Step 2: Clerk Keys -->
<div class="wizard-step" id="wizardStep2">
  <div class="wizard-section-title">Clerk Authentication</div>
  <div class="wizard-help">
    Clerk handles user sign-in for your apps. You'll need a free Clerk account with an application set up.
  </div>

  <!-- Expandable: "I don't have a Clerk account yet" -->
  <details style="margin-bottom:1rem;">
    <summary style="cursor:pointer;font-size:0.8125rem;font-weight:700;color:var(--vibes-blue);user-select:none;">
      I don't have a Clerk account yet
    </summary>
    <div style="background:rgba(0,154,206,0.06);border-radius:0 0 8px 8px;padding:0.75rem 1rem;font-size:0.8125rem;line-height:1.6;">
      <ol style="margin:0.25rem 0 0 1.25rem;padding:0;">
        <li>Go to <a class="wizard-link" href="https://clerk.com/sign-up" target="_blank">clerk.com/sign-up</a> and create a free account</li>
        <li>When prompted, create a new application &mdash; name it anything (e.g. "My Vibes Apps")</li>
        <li>For sign-in options, keep the defaults (Email + Google is fine)</li>
        <li>Once created, you'll land on the dashboard &mdash; continue below to find your keys</li>
      </ol>
    </div>
  </details>

  <div style="background:rgba(0,154,206,0.06);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.8125rem;line-height:1.5;">
    <strong>Finding your API keys:</strong>
    <ol style="margin:0.5rem 0 0 1.25rem;padding:0;">
      <li>Open <a class="wizard-link" href="https://dashboard.clerk.com" target="_blank">dashboard.clerk.com</a></li>
      <li>Select your application (or create one if you haven't)</li>
      <li>Click <strong>Configure</strong> in the left sidebar, then <strong>API Keys</strong></li>
      <li>Copy the <strong>Publishable key</strong> (starts with <code style="background:rgba(0,0,0,0.06);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.75rem;">pk_test_</code>)</li>
      <li>Click <strong>Show</strong> next to <strong>Secret key</strong> and copy it (starts with <code style="background:rgba(0,0,0,0.06);padding:0.1rem 0.3rem;border-radius:3px;font-size:0.75rem;">sk_test_</code>)</li>
    </ol>
  </div>

  <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;">Publishable Key</label>
  <input class="wizard-input" id="wizardClerkKey" type="text" placeholder="pk_test_..." oninput="validateWizardClerkInputs()" autocomplete="off" />
  <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;margin-top:0.5rem;">Secret Key</label>
  <input class="wizard-input" id="wizardClerkSecret" type="password" placeholder="sk_test_..." oninput="validateWizardClerkInputs()" autocomplete="off" />
  <div class="wizard-help" id="wizardClerkHint" style="color:var(--vibes-red);display:none;"></div>
  <div class="setup-actions" style="margin-top:1rem;">
    <button class="btn btn-secondary" onclick="setWizardStep(1)">Back</button>
    <button class="btn btn-primary" id="wizardClerkNext" onclick="saveClerkAndAdvance()" disabled>Next</button>
  </div>
</div>
```

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Add detailed Clerk account creation guidance to setup wizard"
```

---

### Task 3: Enrich Cloudflare step with permission guidance and account creation

**Problem:** Step 3 says to use the "Edit Cloudflare Workers" template for API tokens, but doesn't explain what permissions are needed, or help users who don't have a Cloudflare account yet.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Replace the Cloudflare step HTML with expanded guidance**

Find the wizardStep3 div (around line 2451-2499). Replace its contents:

```html
<!-- Step 3: Cloudflare -->
<div class="wizard-step" id="wizardStep3">
  <div class="wizard-section-title">Cloudflare Deployment</div>
  <div class="wizard-help">
    Cloudflare Workers hosts your apps globally for free. You'll need a Cloudflare account and an API token.
  </div>

  <!-- Expandable: "I don't have a Cloudflare account yet" -->
  <details style="margin-bottom:1rem;">
    <summary style="cursor:pointer;font-size:0.8125rem;font-weight:700;color:var(--vibes-blue);user-select:none;">
      I don't have a Cloudflare account yet
    </summary>
    <div style="background:rgba(0,154,206,0.06);border-radius:0 0 8px 8px;padding:0.75rem 1rem;font-size:0.8125rem;line-height:1.6;">
      <ol style="margin:0.25rem 0 0 1.25rem;padding:0;">
        <li>Go to <a class="wizard-link" href="https://dash.cloudflare.com/sign-up" target="_blank">dash.cloudflare.com/sign-up</a> and create a free account</li>
        <li>Verify your email address</li>
        <li>You don't need to add a domain &mdash; Workers works without one</li>
        <li>Once your account is created, continue below to create an API token</li>
      </ol>
    </div>
  </details>

  <!-- Auth mode tabs -->
  <div style="display:flex;gap:0;margin-bottom:1rem;border-bottom:2px solid rgba(0,0,0,0.1);">
    <button id="cfTabToken" class="btn" onclick="setCfAuthMode('token')" style="border:none;border-bottom:2px solid var(--vibes-blue);margin-bottom:-2px;border-radius:0;padding:0.5rem 1rem;font-weight:700;font-size:0.8125rem;background:none;color:var(--vibes-blue);cursor:pointer;box-shadow:none;">API Token (recommended)</button>
    <button id="cfTabGlobal" class="btn" onclick="setCfAuthMode('global')" style="border:none;border-bottom:2px solid transparent;margin-bottom:-2px;border-radius:0;padding:0.5rem 1rem;font-weight:700;font-size:0.8125rem;background:none;color:#888;cursor:pointer;box-shadow:none;">Global API Key</button>
  </div>

  <!-- API Token panel -->
  <div id="cfPanelToken">
    <div style="background:rgba(0,154,206,0.06);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.8125rem;line-height:1.5;">
      <strong>Create an API Token:</strong>
      <ol style="margin:0.5rem 0 0 1.25rem;padding:0;">
        <li>Go to <a class="wizard-link" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank">Cloudflare API Tokens</a></li>
        <li>Click <strong>Create Token</strong></li>
        <li>Find <strong>"Edit Cloudflare Workers"</strong> and click <strong>Use template</strong></li>
        <li>Under <strong>Account Resources</strong>, select your account</li>
        <li>Under <strong>Zone Resources</strong>, select <strong>All zones</strong> (or a specific zone)</li>
        <li>Click <strong>Continue to summary</strong>, then <strong>Create Token</strong></li>
        <li>Copy the token &mdash; <em>you won't be able to see it again</em></li>
      </ol>
    </div>
    <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;">API Token</label>
    <input class="wizard-input" id="wizardCfApiToken" type="password" placeholder="Paste your API Token..." oninput="validateWizardCfInputs()" autocomplete="off" />
  </div>

  <!-- Global API Key panel (hidden by default) -->
  <div id="cfPanelGlobal" style="display:none;">
    <div style="background:rgba(0,154,206,0.06);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.8125rem;line-height:1.5;">
      <strong>Find your Global API Key:</strong>
      <ol style="margin:0.5rem 0 0 1.25rem;padding:0;">
        <li>Go to <a class="wizard-link" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank">Cloudflare API Tokens</a></li>
        <li>Scroll down to the <strong>API Keys</strong> section</li>
        <li>Next to <strong>Global API Key</strong>, click <strong>View</strong></li>
        <li>Complete the verification and copy the key</li>
      </ol>
      <div style="margin-top:0.5rem;padding:0.5rem;background:rgba(218,41,28,0.06);border-radius:4px;font-size:0.75rem;color:#666;">
        <strong>Note:</strong> Global API Key grants full account access. API Token (above) is recommended for better security.
      </div>
    </div>
    <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;">Account Email</label>
    <input class="wizard-input" id="wizardCfEmail" type="email" placeholder="you@example.com" oninput="validateWizardCfInputs()" autocomplete="off" />
    <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:0.25rem;margin-top:0.5rem;">Global API Key</label>
    <input class="wizard-input" id="wizardCfKey" type="password" placeholder="Paste your Global API Key..." oninput="validateWizardCfInputs()" autocomplete="off" />
  </div>

  <div class="wizard-help" id="wizardCfHint" style="display:none;"></div>
  <div class="setup-actions" style="margin-top:1rem;">
    <button class="btn btn-secondary" onclick="setWizardStep(2)">Back</button>
    <!-- &amp; is correct here (HTML source); JS restores via textContent which handles & natively -->
    <button class="btn btn-primary" id="wizardCfNext" onclick="validateAndAdvanceCf()" disabled>Verify &amp; Continue</button>
  </div>
</div>
```

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Add detailed Cloudflare guidance with account creation and permission steps"
```

---

### Task 4: Improve validation error messages

**Problem:** When Clerk or Cloudflare validation fails, the error messages are technical and unhelpful. For example, "Invalid Clerk publishable key (must start with pk_test_ or pk_live_)" doesn't tell the user what they likely did wrong — e.g., they may have pasted the secret key in the wrong field, or copied extra whitespace.

**Files:**
- Modify: `skills/vibes/templates/editor.html` (client-side hint text)
- Modify: `scripts/server/handlers/editor-api.js` (server-side error messages)

**Step 1: Rewrite `validateWizardClerkInputs()` with swap detection and already-validated guard**

Find `validateWizardClerkInputs()` (around line 3291-3324). Replace the **entire function** with its final form. This includes both the swap-detection hints and the early-return for already-validated keys (so returning users aren't stuck with a disabled Next button):

```javascript
function validateWizardClerkInputs() {
  const keyInput = document.getElementById('wizardClerkKey');
  const secretInput = document.getElementById('wizardClerkSecret');
  const hint = document.getElementById('wizardClerkHint');
  const nextBtn = document.getElementById('wizardClerkNext');

  const key = keyInput.value.trim();
  const secret = secretInput.value.trim();

  // If keys are already validated and user hasn't typed anything new, allow advancing
  if (!key && !secret && wizardValidation.clerk === 'valid') {
    keyInput.classList.remove('valid', 'invalid');
    secretInput.classList.remove('valid', 'invalid');
    hint.style.display = 'none';
    nextBtn.disabled = false;
    return;
  }

  const keyValid = key.startsWith('pk_test_') || key.startsWith('pk_live_');
  const secretValid = secret.startsWith('sk_test_') || secret.startsWith('sk_live_');

  keyInput.classList.toggle('valid', key && keyValid);
  keyInput.classList.toggle('invalid', key && !keyValid);
  secretInput.classList.toggle('valid', secret && secretValid);
  secretInput.classList.toggle('invalid', secret && !secretValid);

  // Swap detection hints
  if (key && !keyValid) {
    if (key.startsWith('sk_test_') || key.startsWith('sk_live_')) {
      hint.textContent = 'This looks like a secret key — it goes in the field below. The publishable key starts with pk_test_ or pk_live_.';
    } else {
      hint.textContent = 'Publishable key must start with pk_test_ or pk_live_. Find it in Clerk Dashboard > Configure > API Keys.';
    }
    hint.style.display = '';
  } else if (secret && !secretValid) {
    if (secret.startsWith('pk_test_') || secret.startsWith('pk_live_')) {
      hint.textContent = 'This looks like a publishable key — it goes in the field above. The secret key starts with sk_test_ or sk_live_.';
    } else {
      hint.textContent = 'Secret key must start with sk_test_ or sk_live_. In the Clerk Dashboard, click "Show" next to the secret key to reveal it.';
    }
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }

  const valid = keyValid && secretValid;
  nextBtn.disabled = !valid;
  if (valid) {
    wizardData.clerkKey = key;
    wizardData.clerkSecret = secret;
  }
}
```

This is the **final form** of this function. No later task modifies it.

**Step 2: Improve Cloudflare validation error display**

Find the `catch` block in `validateAndAdvanceCf()` (around line 3473-3477):

```javascript
// BEFORE
} catch (err) {
  wizardValidation.cloudflare = 'invalid';
  hint.textContent = err.message;
  hint.style.color = 'var(--vibes-red)';
  hint.style.display = '';
}
```

Replace with:

```javascript
// AFTER
} catch (err) {
  wizardValidation.cloudflare = 'invalid';
  let msg = err.message;
  // Add remediation hints for common errors
  if (msg.includes('Token verification failed') || msg.includes('Authentication failed')) {
    msg += ' Double-check that you copied the full token with no extra spaces.';
  } else if (msg.includes('timed out')) {
    msg += ' Try again — this is usually a temporary network issue.';
  } else if (msg.includes('no accounts accessible') || msg.includes('No accounts found')) {
    msg += ' The token might not have the right permissions. Try creating a new token with the "Edit Cloudflare Workers" template.';
  }
  hint.textContent = msg;
  hint.style.color = 'var(--vibes-red)';
  hint.style.display = '';
}
```

**Step 3: Improve server-side error messages in `saveCredentials`**

In `scripts/server/handlers/editor-api.js`, find the validation block (around line 133-166). Update the error messages:

```javascript
// BEFORE
if (pk && !validateClerkKey(pk)) {
  errors.clerkPublishableKey = 'Invalid Clerk publishable key (must start with pk_test_ or pk_live_)';
}
if (sk && !validateClerkSecretKey(sk)) {
  errors.clerkSecretKey = 'Invalid Clerk secret key (must start with sk_test_ or sk_live_)';
}
```

Replace with:

```javascript
// AFTER
if (pk && !validateClerkKey(pk)) {
  if (validateClerkSecretKey(pk)) {
    errors.clerkPublishableKey = 'This looks like a secret key. The publishable key starts with pk_test_ or pk_live_.';
  } else {
    errors.clerkPublishableKey = 'Publishable key must start with pk_test_ or pk_live_. Copy it from Clerk Dashboard > Configure > API Keys.';
  }
}
if (sk && !validateClerkSecretKey(sk)) {
  if (validateClerkKey(sk)) {
    errors.clerkSecretKey = 'This looks like a publishable key. The secret key starts with sk_test_ or sk_live_.';
  } else {
    errors.clerkSecretKey = 'Secret key must start with sk_test_ or sk_live_. Click "Show" next to the secret key in the Clerk Dashboard.';
  }
}
```

**Step 4: Run tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All existing tests pass

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html scripts/server/handlers/editor-api.js
git commit -m "Improve validation error messages with swap detection and remediation hints"
```

---

### Task 5: Add server-side Clerk key validation endpoint

**Problem:** The wizard saves Clerk keys without verifying they're valid — it only checks the prefix format. The Cloudflare step validates against the real API, but the Clerk step doesn't. This means a user can enter correctly-formatted but invalid keys and not discover the problem until deploy time.

**Files:**
- Modify: `scripts/server/handlers/editor-api.js`
- Modify: `scripts/server/routes.js` (route table registration)
- Modify: `skills/vibes/templates/editor.html`
- Test: `scripts/__tests__/integration/wizard-flow.test.js`

**Step 1: Write the failing test for Clerk validation**

Add to `scripts/__tests__/integration/wizard-flow.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ... existing imports and tests ...

describe('Clerk key validation', () => {
  it('validates Clerk publishable key by decoding the domain', async () => {
    // pk_test_ keys encode a domain in base64: pk_test_<base64(domain + "$")>
    // A valid key should decode to a .clerk.accounts.dev domain
    const { extractClerkDomain } = await import('../../lib/env-utils.js');

    // Valid key (encodes "example.clerk.accounts.dev$")
    const domain = 'example.clerk.accounts.dev';
    const encoded = Buffer.from(domain + '$').toString('base64');
    const validKey = 'pk_test_' + encoded;
    expect(extractClerkDomain(validKey)).toBe(domain);

    // Invalid key (random garbage after prefix)
    const badKey = 'pk_test_notbase64!!!';
    const badDomain = extractClerkDomain(badKey);
    // extractClerkDomain returns decoded string even for garbage — validation is format check
    expect(typeof badDomain).toBe('string');
  });

  it('detects swapped Clerk keys (pk in sk field, sk in pk field)', async () => {
    const { validateClerkKey, validateClerkSecretKey } = await import('../../lib/env-utils.js');

    // Secret key in publishable field
    expect(validateClerkKey('sk_test_abc123')).toBe(false);
    expect(validateClerkSecretKey('sk_test_abc123')).toBe(true);

    // Publishable key in secret field
    expect(validateClerkSecretKey('pk_test_abc123')).toBe(false);
    expect(validateClerkKey('pk_test_abc123')).toBe(true);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npx vitest run __tests__/integration/wizard-flow.test.js`
Expected: PASS (these are testing existing utility functions)

**Step 3: Add a Clerk FAPI validation endpoint to `editor-api.js`**

Clerk publishable keys encode a Frontend API domain. We can verify the key by hitting that domain. First, add `extractClerkDomain` to the existing static import in `editor-api.js`.

Find the import line at the top of the file (line 7):

```javascript
// BEFORE
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, writeEnvFile } from '../../lib/env-utils.js';
```

Replace with:

```javascript
// AFTER
import { loadEnvFile, validateClerkKey, validateClerkSecretKey, extractClerkDomain, writeEnvFile } from '../../lib/env-utils.js';
```

Then add this function and route handler to `scripts/server/handlers/editor-api.js`:

```javascript
/**
 * Validate Clerk credentials by probing the Frontend API.
 * The publishable key encodes a domain (base64). We hit that domain's
 * well-known endpoint to verify the key is real.
 *
 * @param {object} opts
 * @param {string} opts.publishableKey - Clerk publishable key (pk_test_... or pk_live_...)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateClerkCredentials({ publishableKey } = {}) {
  const CLERK_TIMEOUT_MS = 10_000;

  if (!publishableKey) {
    return { valid: false, error: 'No publishable key provided.' };
  }

  // Extract the FAPI domain from the key (uses static import from top of file)
  const domain = extractClerkDomain(publishableKey);
  if (!domain) {
    return { valid: false, error: 'Could not decode domain from publishable key. Make sure you copied the full key.' };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLERK_TIMEOUT_MS);
    const res = await fetch(`https://${domain}/v1/environment`, {
      headers: { 'Authorization': `Bearer ${publishableKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      return { valid: true };
    }

    // 401/403 means the key format decoded but isn't valid
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: 'Key was rejected by Clerk. Make sure you copied the correct publishable key from the API Keys page.' };
    }

    return { valid: false, error: `Clerk API returned status ${res.status}. The key may be invalid or the application may be paused.` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { valid: false, error: 'Clerk API request timed out (10s). Check your network connection.' };
    }
    // DNS resolution failure means the domain encoded in the key doesn't exist
    if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
      return { valid: false, error: 'The domain encoded in this key does not exist. Make sure you copied the correct publishable key.' };
    }
    return { valid: false, error: 'Failed to reach Clerk API: ' + err.message };
  }
}

export async function validateClerk(ctx, req, res) {
  try {
    const body = await parseJsonBody(req);
    const { publishableKey } = body;
    if (!publishableKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ valid: false, error: 'Provide a publishable key.' }));
    }
    const result = await validateClerkCredentials({ publishableKey });
    const statusCode = result.valid ? 200 : 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: err.message }));
  }
}
```

**Step 4: Register the new route in `scripts/server/routes.js`**

The server uses a declarative `routeTable` object (not an if/else chain). Open `scripts/server/routes.js` and find the `routeTable` object (around line 91-111). Add the new route right after the existing `validate-cloudflare` entry:

```javascript
// In the routeTable object, add after the validate-cloudflare line:
'POST /editor/credentials/validate-cloudflare': editorApi.validateCloudflare,
'POST /editor/credentials/validate-clerk':      editorApi.validateClerk,    // <-- add this line
```

**Step 5: Rewrite `saveClerkAndAdvance()` with FAPI validation and already-validated guard**

In `skills/vibes/templates/editor.html`, find `saveClerkAndAdvance()` (around line 3326-3358). Replace it with its **final form** — includes both FAPI validation and the early-return for already-validated keys:

```javascript
async function saveClerkAndAdvance() {
  // If no new keys entered and existing validation is good, just advance
  const keyInput = document.getElementById('wizardClerkKey');
  const secretInput = document.getElementById('wizardClerkSecret');
  if (!keyInput.value.trim() && !secretInput.value.trim() && wizardValidation.clerk === 'valid') {
    setWizardStep(3);
    return;
  }

  const btn = document.getElementById('wizardClerkNext');
  const hint = document.getElementById('wizardClerkHint');
  hint.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<span class="wizard-checking"></span> Verifying...';
  wizardValidation.clerk = 'checking';
  try {
    // Validate the publishable key against Clerk's API
    const valRes = await fetch('/editor/credentials/validate-clerk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishableKey: wizardData.clerkKey }),
    });
    const valData = await valRes.json();
    if (!valData.valid) {
      throw new Error(valData.error || 'Clerk key validation failed');
    }

    // Save both keys
    const res = await fetch('/editor/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clerkPublishableKey: wizardData.clerkKey,
        clerkSecretKey: wizardData.clerkSecret,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.errors ? Object.values(data.errors).join('; ') : 'Failed to save';
      throw new Error(errMsg);
    }
    wizardValidation.clerk = 'valid';
    setWizardStep(3);
  } catch (err) {
    wizardValidation.clerk = 'invalid';
    hint.textContent = err.message;
    hint.style.color = 'var(--vibes-red)';
    hint.style.display = '';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Next';
    validateWizardClerkInputs(); // re-check to reset disabled state
  }
}
```

This is the **final form** of this function. No later task modifies it.

**Step 6: Run tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add scripts/server/handlers/editor-api.js scripts/server/routes.js skills/vibes/templates/editor.html scripts/__tests__/integration/wizard-flow.test.js
git commit -m "Add server-side Clerk key validation via FAPI probe"
```

**Important:** The route was registered in Step 4 above in `scripts/server/routes.js`. Include that file in the git add:

```bash
git add scripts/server/handlers/editor-api.js scripts/server/routes.js skills/vibes/templates/editor.html scripts/__tests__/integration/wizard-flow.test.js
```

---

### Task 6: Improve summary step with live verification and re-entry

**Problem:** Step 4 ("All Set!") shows a static summary but doesn't give users confidence everything actually works. It also doesn't handle the case where a user returns to the wizard with both credentials already configured — the summary should show both as verified. Additionally, there's no way to re-do a step from the summary if the user realizes they entered wrong keys.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Enhance the `renderWizardSummary` function**

Find `renderWizardSummary()` (around line 3485-3497). Replace it:

```javascript
function renderWizardSummary() {
  const table = document.getElementById('wizardSummary');
  const rows = [
    {
      key: 'Clerk',
      value: wizardData.clerkKey ? wizardData.clerkKey.slice(0, 12) + '...' : 'Configured',
      ok: wizardValidation.clerk === 'valid',
      editStep: 2,
    },
    {
      key: 'Cloudflare',
      value: wizardData.cfApiToken
        ? (wizardData.cfApiToken === 'configured' ? 'API Token configured' : 'API Token')
        : (wizardData.cfEmail || 'Configured'),
      ok: wizardValidation.cloudflare === 'valid',
      editStep: 3,
    },
  ];
  table.innerHTML = rows.map(r =>
    `<div class="wizard-summary-row">
      <span class="wizard-summary-key">${r.ok ? '<span style="color:var(--vibes-green);">&#10003;</span> ' : '<span style="color:var(--vibes-red);">&#10007;</span> '}${escapeHtml(r.key)}</span>
      <span style="display:flex;align-items:center;gap:0.5rem;">
        <span class="wizard-summary-value">${escapeHtml(r.value)}</span>
        <button onclick="setWizardStep(${r.editStep})" style="background:none;border:none;color:var(--vibes-blue);cursor:pointer;font-size:0.75rem;font-weight:700;padding:0;">Edit</button>
      </span>
    </div>`
  ).join('');
}
```

**Step 2: Update the summary step header to be more reassuring**

Find the wizardStep4 div (around line 2502-2525). Update the header text:

```html
<!-- Step 4: Verification & Save -->
<div class="wizard-step" id="wizardStep4">
  <div class="wizard-section-title" style="color:var(--vibes-green);">&#10003; Ready to Build!</div>
  <div class="wizard-help">Your credentials have been verified and saved. You're all set to create and deploy apps.</div>
  <div class="wizard-summary-table" id="wizardSummary"></div>
```

The rest of step 4 (OpenRouter section and "Start Building" button) stays the same.

**Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Enhance summary step with edit buttons and verification status"
```

---

### Task 7: Pre-populate input fields when credentials exist

**Problem:** `prefillFromStatus` sets validation state and placeholder text, but when a user navigates to a step that already has valid credentials (e.g., via the "Edit" button on the summary), the input fields are empty. The user might think their credentials are gone. We should show masked versions of existing values.

**Supersession note:** This task writes the **final form** of `prefillFromStatus` only. The other two functions that were previously split across tasks are now written in their final form earlier:
- `validateWizardClerkInputs` — written in final form in Task 4 (swap detection + already-validated guard). Do NOT rewrite here.
- `saveClerkAndAdvance` — written in final form in Task 5 (FAPI validation + already-validated guard). Do NOT rewrite here.
- `prefillFromStatus` — Task 1 patched the step-skipping block; this task rewrites the full function with masked values, OpenRouter pre-population, and the same step-skipping logic.

**Files:**
- Modify: `skills/vibes/templates/editor.html`
- Modify: `scripts/server/handlers/editor-api.js`

**Step 1: Extend the `/editor/status` endpoint to return masked key values**

In `scripts/server/handlers/editor-api.js`, update `checkEditorDeps` to return masked key previews (around line 47-101). Add a `maskedKeys` field to the return value:

After the `return` statement at the end of `checkEditorDeps`, change it to also return masked values. Find the return block and replace:

```javascript
// BEFORE (end of checkEditorDeps)
return {
  clerk: { ok: clerkOk, detail: clerkDetail },
  cloudflare: { ok: cfOk, detail: cfDetail },
  openrouter: {
    ok: openrouterOk,
    detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
  },
};
```

Replace with:

```javascript
// AFTER
// Build masked key previews for pre-population.
// `checkEditorDeps` resolves Clerk keys from three sources (in priority order):
//   1. _default sentinel (line 54-59)
//   2. Most recent real app (line 62-69)
//   3. .env file (line 73-79)
// We need to read from whichever source actually provided the valid key.
// Track the validated pk through the existing logic by hoisting it.

// IMPORTANT: To make masking work, hoist the validated pk value.
// Add `let validatedPk = '';` at the top of checkEditorDeps (after `let clerkOk = false;`),
// and set `validatedPk = <the pk value>` in each of the three branches where clerkOk is set true.
// Then use it here:
const maskedKeys = {};
if (clerkOk) {
  if (validatedPk) maskedKeys.clerkPublishableKey = validatedPk.slice(0, 12) + '...' + validatedPk.slice(-4);
  maskedKeys.clerkSecretKey = 'sk_****_configured';
}

// The three changes needed earlier in the function:
// 1. After `let clerkDetail = 'No Clerk keys configured';` add: `let validatedPk = '';`
// 2. In the _default branch (line 57-58), add: `validatedPk = defaultPk;`
// 3. In the most-recent-app branch (line 68), add: `validatedPk = pk;`
// 4. In the .env branch (line 77), add: `validatedPk = envKey;`
if (cfOk) {
  if (cfConfig.apiToken) {
    maskedKeys.cloudflareApiToken = cfConfig.apiToken.slice(0, 6) + '...' + cfConfig.apiToken.slice(-4);
  }
  if (cfConfig.email) maskedKeys.cloudflareEmail = cfConfig.email;
}
if (openrouterOk) {
  maskedKeys.openRouterKey = 'sk-or-...' + orKey.slice(-6);
}

return {
  clerk: { ok: clerkOk, detail: clerkDetail },
  cloudflare: { ok: cfOk, detail: cfDetail },
  openrouter: {
    ok: openrouterOk,
    detail: openrouterOk ? `sk-or-...${orKey.slice(-6)}` : 'No OPENROUTER_API_KEY in .env',
  },
  maskedKeys,
};
```

**Step 2: Update `prefillFromStatus` to show masked values in inputs**

In `skills/vibes/templates/editor.html`, update the `prefillFromStatus` function to use masked values:

```javascript
function prefillFromStatus(status) {
  if (status.clerk?.ok) {
    wizardValidation.clerk = 'valid';
    const pkInput = document.getElementById('wizardClerkKey');
    const skInput = document.getElementById('wizardClerkSecret');
    if (pkInput && status.maskedKeys?.clerkPublishableKey) {
      pkInput.placeholder = status.maskedKeys.clerkPublishableKey;
    }
    if (skInput) {
      skInput.placeholder = status.maskedKeys?.clerkSecretKey || 'Already configured';
    }
  }
  if (status.cloudflare?.ok) {
    wizardValidation.cloudflare = 'valid';
    cloudflareReady = true;
    const cfDetail = status.cloudflare.detail || 'Configured';
    if (cfDetail === 'API Token configured') {
      wizardData.cfApiToken = 'configured';
      const tokenInput = document.getElementById('wizardCfApiToken');
      if (tokenInput && status.maskedKeys?.cloudflareApiToken) {
        tokenInput.placeholder = status.maskedKeys.cloudflareApiToken;
      }
    } else {
      wizardData.cfEmail = cfDetail;
      const emailInput = document.getElementById('wizardCfEmail');
      if (emailInput && status.maskedKeys?.cloudflareEmail) {
        emailInput.placeholder = status.maskedKeys.cloudflareEmail;
      }
    }
  }

  // Pre-populate OpenRouter if available (independent of Clerk/Cloudflare status)
  if (status.openrouter?.ok) {
    const orInput = document.getElementById('wizardOpenRouterKey');
    if (orInput && status.maskedKeys?.openRouterKey) {
      orInput.placeholder = status.maskedKeys.openRouterKey;
    }
  }

  // Smart skip: jump to the first incomplete step
  if (status.clerk?.ok && status.cloudflare?.ok) {
    setWizardStep(4);
  } else if (status.clerk?.ok && !status.cloudflare?.ok) {
    setWizardStep(3);
  } else if (!status.clerk?.ok && status.cloudflare?.ok) {
    setWizardStep(2);
  }
}
```

**Step 3: Run tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html scripts/server/handlers/editor-api.js
git commit -m "Pre-populate wizard fields with masked values and allow re-entry without re-typing"
```

---

### Task 8: Add "Settings" button to editor header for re-entering wizard

**Problem:** Once the wizard completes, users have no way to get back to it to update their credentials. The deploy dropdown shows "Run setup wizard first" if Cloudflare isn't configured, but there's no explicit entry point.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Add a settings button to the header in generate and edit phases**

Find the `setPhase` function (around line 3005). In the `if (phase === 'generate')` branch, add a settings gear button. Also add it in the `else if (phase === 'edit')` branch.

In the generate phase's headerRight, change the logic to always include a settings button:

```javascript
// In setPhase(), generate branch — replace the headerRight.innerHTML block
if (phase === 'generate') {
  const appsGrid = document.getElementById('appGalleryGrid');
  let buttons = '';
  if (appsGrid && appsGrid.innerHTML.trim()) {
    buttons += `
      <div class="navbar-button-wrapper">
        <button style="background:var(--vibes-yellow)" onclick="toggleAppsPanel()">
          <div class="navbar-button-icon">
            <svg width="35" height="35" viewBox="0 0 35 35" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="17.5" cy="17.5" r="17.5" fill="#231F20"/>
              <rect x="9" y="9" width="7" height="7" rx="1.5" fill="var(--vibes-cream)"/>
              <rect x="19" y="9" width="7" height="7" rx="1.5" fill="var(--vibes-cream)"/>
              <rect x="9" y="19" width="7" height="7" rx="1.5" fill="var(--vibes-cream)"/>
              <rect x="19" y="19" width="7" height="7" rx="1.5" fill="var(--vibes-cream)"/>
            </svg>
          </div>
          <div class="navbar-button-label" style="color:var(--vibes-near-black)">Apps</div>
        </button>
      </div>`;
  }
  buttons += `
    <div class="navbar-button-wrapper">
      <button style="background:var(--vibes-menu-bg)" onclick="openSettings()">
        <div class="navbar-button-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--vibes-near-black)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <div class="navbar-button-label" style="color:var(--vibes-near-black)">Settings</div>
      </button>
    </div>`;
  headerRight.innerHTML = buttons;
}
```

For the edit phase, add the settings button before the deploy button in the `headerRight.innerHTML` template (around line 3052-3111). Add it as the first `navbar-button-wrapper` div, before the Themes button.

**Step 2: Add the `openSettings` function**

Add this function near the other wizard functions.

**Caution:** Do NOT call `renderChecklist(status)` from `openSettings()`. `renderChecklist` contains `if (startBtn && requiredOk) { setTimeout(() => goToGenerate(), 800); }` which auto-redirects away from the wizard when both credentials are configured. That auto-redirect is correct on initial page load (skip the wizard entirely) but wrong when the user explicitly clicks Settings to re-enter. Only call `prefillFromStatus`, which handles step-skipping without the auto-redirect.

```javascript
// Helper: update welcome step icons without the auto-redirect in renderChecklist
function updateWelcomeIcons(status) {
  const clerkIcon = document.getElementById('welcomeClerkIcon');
  const cfIcon = document.getElementById('welcomeCfIcon');
  if (clerkIcon) {
    clerkIcon.style.background = status.clerk?.ok ? 'var(--vibes-green)' : '#999';
    clerkIcon.innerHTML = status.clerk?.ok ? '&#10003;' : '1';
  }
  if (cfIcon) {
    cfIcon.style.background = status.cloudflare?.ok ? 'var(--vibes-green)' : '#999';
    cfIcon.innerHTML = status.cloudflare?.ok ? '&#10003;' : '2';
  }
}

function openSettings() {
  // Re-fetch status and show the wizard — do NOT call renderChecklist()
  // because it auto-redirects to generate when all creds are present.
  // prefillFromStatus() handles smart step-skipping without the redirect.
  // updateWelcomeIcons() updates the step 1 icons (extracted from renderChecklist).
  fetch('/editor/status').then(r => r.json()).then(status => {
    cloudflareReady = status.cloudflare?.ok || false;
    updateWelcomeIcons(status);
    prefillFromStatus(status);
    setPhase('setup');
  }).catch(() => {
    setPhase('setup');
  });
}
```

Also update `renderChecklist` to call the shared `updateWelcomeIcons` helper instead of duplicating the icon logic. Replace the icon-updating block in `renderChecklist` (around lines 3239-3249) with `updateWelcomeIcons(status);`.

**Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Add Settings button to header for re-entering setup wizard"
```

---

### Task 9: Add Cloudflare step skip for pre-validated credentials

**Problem:** When the user navigates to the Cloudflare step via the Edit button on the summary, and credentials are already validated, they see empty fields and a disabled button. They should be able to advance without re-entering credentials (same pattern as Clerk step in Task 7).

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Update `validateWizardCfInputs` to allow skip when already validated**

Add an early return at the top of `validateWizardCfInputs()`:

```javascript
function validateWizardCfInputs() {
  const nextBtn = document.getElementById('wizardCfNext');

  // If already validated and no new input, allow advancing
  if (wizardValidation.cloudflare === 'valid') {
    if (cfAuthMode === 'token') {
      const tokenInput = document.getElementById('wizardCfApiToken');
      if (!tokenInput.value.trim()) { nextBtn.disabled = false; return; }
    } else {
      const emailInput = document.getElementById('wizardCfEmail');
      const keyInput = document.getElementById('wizardCfKey');
      if (!emailInput.value.trim() && !keyInput.value.trim()) { nextBtn.disabled = false; return; }
    }
  }

  // ... rest of existing validation logic unchanged ...
```

**Step 2: Update `validateAndAdvanceCf` to skip when re-using existing credentials**

Add an early return at the top of `validateAndAdvanceCf()`:

```javascript
async function validateAndAdvanceCf() {
  // If no new input and already validated, just advance
  if (wizardValidation.cloudflare === 'valid') {
    const hasNewInput = cfAuthMode === 'token'
      ? document.getElementById('wizardCfApiToken').value.trim()
      : (document.getElementById('wizardCfEmail').value.trim() || document.getElementById('wizardCfKey').value.trim());
    if (!hasNewInput) {
      setWizardStep(4);
      return;
    }
  }

  // ... rest of existing validation logic unchanged ...
```

**Step 3: Fix `setWizardStep` to not clear CF fields when already validated**

The existing `setWizardStep` function (around line 3265-3288) clears CF data on re-entry to step 3. The guard `wizardValidation.cloudflare !== 'valid'` already handles this — verify it works correctly. No change needed here, but verify by reading the code.

**Step 4: Run tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Allow skipping Cloudflare step when credentials already validated"
```

---

### Task 10: Add integration tests for new wizard behaviors

**Problem:** The new behaviors (swap detection, Clerk FAPI validation) need test coverage. In particular, `validateClerkCredentials` (Task 5) is the only new server-side logic with external network calls and multiple error branches, and it currently has zero tests.

**Files:**
- Modify: `scripts/__tests__/integration/wizard-flow.test.js`

**Step 1: Add tests for saveCredentials swap detection**

Append these test cases to `scripts/__tests__/integration/wizard-flow.test.js`:

Note: `scripts/package.json` has `"type": "module"` — all test files use ESM imports, not `require()`.

```javascript
// At the top of the file, add this import alongside the existing ones:
import { Readable } from 'stream';

// Shared mock helpers — place after imports, before describe blocks
function mockReq(body) {
  const req = new Readable({ read() {} });
  req.push(JSON.stringify(body));
  req.push(null);
  return req;
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, h) { res.statusCode = code; res.headers = h; },
    end(data) { res.body = data; },
    get writableEnded() { return !!res.body; },
  };
  return res;
}

describe('editor-api saveCredentials swap detection', () => {
  let editorApi;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    editorApi = await import('../../server/handlers/editor-api.js');
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  it('returns descriptive error when pk and sk keys are swapped', async () => {
    const req = mockReq({
      clerkPublishableKey: 'sk_test_abc123',  // Swapped!
      clerkSecretKey: 'pk_test_xyz789',       // Swapped!
    });
    const res = mockRes();
    const ctx = { projectRoot: TEST_DIR };

    await editorApi.saveCredentials(ctx, req, res);
    const data = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.errors.clerkPublishableKey).toContain('secret key');
    expect(data.errors.clerkSecretKey).toContain('publishable key');
  });
});
```

**Step 2: Run swap detection tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npx vitest run __tests__/integration/wizard-flow.test.js`
Expected: PASS

**Step 3: Add tests for `validateClerkCredentials` with mocked fetch**

This is the only new server-side function with external network calls. Test all error branches by mocking `global.fetch`.

Append to `scripts/__tests__/integration/wizard-flow.test.js`:

```javascript
describe('validateClerkCredentials', () => {
  let editorApi;
  let originalFetch;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(join(TEST_DIR, '.vibes'), { recursive: true });
    process.env.VIBES_HOME = TEST_DIR;
    originalFetch = global.fetch;
    editorApi = await import('../../server/handlers/editor-api.js');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.VIBES_HOME;
  });

  // Helper: encode a domain into a pk_test_ key
  function makePk(domain) {
    return 'pk_test_' + Buffer.from(domain + '$').toString('base64');
  }

  it('returns valid:true when Clerk FAPI responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('example.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledOnce();
    // Verify it hit the correct FAPI domain
    const url = global.fetch.mock.calls[0][0];
    expect(url).toBe('https://example.clerk.accounts.dev/v1/environment');
  });

  it('returns valid:false with helpful message on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('bad.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('rejected by Clerk');
  });

  it('returns valid:false with helpful message on 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('paused.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('rejected by Clerk');
  });

  it('returns valid:false with status code for other HTTP errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('error.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('status 500');
  });

  it('returns valid:false on DNS resolution failure (ENOTFOUND)', async () => {
    const err = new Error('getaddrinfo ENOTFOUND nonexistent.clerk.accounts.dev');
    err.cause = { code: 'ENOTFOUND' };
    global.fetch = vi.fn().mockRejectedValue(err);

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('nonexistent.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('domain encoded in this key does not exist');
  });

  it('returns valid:false on timeout (AbortError)', async () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    global.fetch = vi.fn().mockRejectedValue(err);

    const result = await editorApi.validateClerkCredentials({
      publishableKey: makePk('slow.clerk.accounts.dev'),
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('returns valid:false when no publishable key provided', async () => {
    const result = await editorApi.validateClerkCredentials({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No publishable key');
  });

  it('returns valid:false when key cannot be decoded', async () => {
    // extractClerkDomain returns null for non-pk_ keys
    const result = await editorApi.validateClerkCredentials({
      publishableKey: 'not_a_valid_key',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('decode domain');
  });
});
```

**Step 4: Run all wizard flow tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npx vitest run __tests__/integration/wizard-flow.test.js`
Expected: All tests pass including the new `validateClerkCredentials` tests

**Step 5: Run full test suite**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add scripts/__tests__/integration/wizard-flow.test.js
git commit -m "Add integration tests for swap detection and validateClerkCredentials"
```

---

### Task 11: Update welcome step to show what's needed more clearly

**Problem:** The welcome step lists Clerk and Cloudflare but doesn't set expectations about what information the user will need. Non-technical users should know upfront that they'll be creating accounts and copying API keys.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Update the welcome step content**

Find wizardStep1 (around line 2394-2422). Replace its contents:

```html
<!-- Step 1: Welcome -->
<div class="wizard-step active" id="wizardStep1">
  <div class="wizard-section-title">Welcome to Vibes</div>
  <div class="wizard-help">
    Let's get you set up! Vibes uses two free services to build and deploy your apps. We'll walk you through creating accounts and getting the API keys you need.
  </div>
  <div style="margin: 1rem 0;">
    <div class="setup-item">
      <div class="setup-icon" id="welcomeClerkIcon" style="background:#999;color:white;">1</div>
      <div>
        <div class="setup-label">Clerk <span style="font-size:0.7rem;color:#888;">(authentication)</span></div>
        <div class="setup-detail">Handles user sign-in for your apps &mdash; you'll need a publishable key and secret key</div>
      </div>
    </div>
    <div class="setup-item">
      <div class="setup-icon" id="welcomeCfIcon" style="background:#999;color:white;">2</div>
      <div>
        <div class="setup-label">Cloudflare <span style="font-size:0.7rem;color:#888;">(hosting &amp; sync)</span></div>
        <div class="setup-detail">Deploys your apps globally &mdash; you'll need an API token</div>
      </div>
    </div>
  </div>
  <div class="wizard-help" style="font-size:0.75rem;color:#666;">
    Both services have generous free tiers. Setup takes about 5 minutes. We'll verify each key as you go.
  </div>
  <div class="setup-actions" style="margin-top:1rem;">
    <button class="btn btn-primary" id="wizardStartBtn" onclick="setWizardStep(2)">Get started</button>
  </div>
</div>
```

**Step 2: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Update welcome step with clearer expectations about what users will need"
```

---

### Task 12: Make setup-card scrollable for smaller screens

**Problem:** The enriched Clerk and Cloudflare steps with expandable sections may overflow the viewport on smaller screens. The setup-card should scroll its content.

**Files:**
- Modify: `skills/vibes/templates/editor.html`

**Step 1: Add CSS for scrollable wizard content**

Find the `.setup-card` CSS rule (around line 282-289). Update it:

```css
.setup-card {
  background: var(--vibes-cream);
  border: 3px solid var(--vibes-near-black);
  border-radius: 12px;
  padding: 2rem;
  width: 520px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 8px 10px 0px 0px var(--vibes-blue), 8px 10px 0px 3px var(--vibes-near-black);
}
```

Note: the inline `style="width:520px;"` on the setup-card div (line 2379) should be removed since width is now in the CSS rule. Check and remove it.

**Step 2: Run tests**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add skills/vibes/templates/editor.html
git commit -m "Make setup card scrollable for smaller viewports"
```

---

### Task 13: Final review and manual testing

**Step 1: Run full test suite**

Run: `cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard/scripts && npm test`
Expected: All tests pass

**Step 2: Visual review checklist**

Start the editor server and verify each scenario manually:

1. **Fresh user (no credentials):** Wizard shows step 1 with no skip button. "Get started" goes to step 2. Clerk step has expandable "I don't have a Clerk account" section. Cloudflare step has expandable "I don't have a Cloudflare account" section.

2. **Clerk only configured:** Wizard opens at step 3 (Cloudflare). Clerk inputs show masked placeholders.

3. **Both configured:** Wizard opens at step 4 (summary). Both items show green checkmarks. Edit buttons navigate to the correct step. "Start Building" goes to generate phase.

4. **Swapped keys:** Entering `sk_test_...` in the publishable key field shows "This looks like a secret key" hint.

5. **Settings re-entry:** From generate or edit phase, clicking the gear icon re-opens the wizard at the appropriate step.

6. **Small viewport:** Wizard card scrolls when content exceeds viewport height.

**Step 3: Commit any final adjustments**

```bash
cd /Users/marcusestes/Websites/VibesCLI/vibes-skill/.worktrees/perfect-setup-wizard
git add -A
git commit -m "Final adjustments from manual testing"
```
