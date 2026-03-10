// vibes-desktop/src/bun/setup-html.ts
// Inline HTML for the first-launch setup screen.
// Loaded via BrowserWindow({ html: ... }) — no external assets.
//
// Renders the editor chrome (cream toolbar + gray grid background) with a
// floating terminal window centered on top. Setup steps appear as terminal
// output lines; buttons are drawn in ASCII. Matches the design reference
// from terminal.html.

export const SETUP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibesOS Setup</title>
<style>
  :root {
    /* Editor chrome tokens */
    --vibes-cream: #fffff0;
    --vibes-menu-bg: #CCCDC8;
    --vibes-menu-grid: rgba(255, 255, 255, 0.5);
    --grid-size: 32px;

    /* Terminal tokens (from design reference) */
    --term-base: #141211;
    --term-surface: #1E1B1A;
    --term-border: #2E2927;
    --text-main: #EAE3E0;
    --text-muted: #8A7E79;
    --accent-teal: #5EEAD4;
    --accent-teal-dim: rgba(94, 234, 212, 0.15);
    --accent-pink: #DDBFBF;
    --btn-close: #FF7B72;
    --btn-min: #F2CC60;
    --btn-max: #73D077;
    --font-mono: 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-mono);
    background: var(--vibes-menu-bg);
    color: var(--text-main);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }

  /* === EDITOR TOOLBAR (matches editor.html header) === */
  .editor-toolbar {
    display: flex;
    align-items: center;
    padding: 0 20px;
    background: var(--vibes-cream);
    border-bottom: 1px solid #1a1a1a;
    height: 64px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .toolbar-title {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 15px;
    font-weight: 600;
    color: #1a1a1a;
    letter-spacing: -0.3px;
  }

  .toolbar-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #1a1a1a;
    opacity: 0.3;
  }

  .toolbar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .toolbar-pill {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 11px;
    color: #555;
    background: rgba(0,0,0,0.06);
    padding: 4px 10px;
    border-radius: 10px;
    border: 1px solid rgba(0,0,0,0.08);
  }

  /* === GRID BACKGROUND === */
  .grid-area {
    flex: 1;
    background-color: var(--vibes-menu-bg);
    background-image:
      linear-gradient(var(--vibes-menu-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--vibes-menu-grid) 1px, transparent 1px);
    background-size: var(--grid-size) var(--grid-size);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  /* === FLOATING TERMINAL === */
  .terminal-wrapper {
    position: relative;
    width: 100%;
    max-width: 680px;
    animation: float 6s ease-in-out infinite;
  }

  .terminal {
    background: linear-gradient(145deg, var(--term-base), #0C0B0A);
    border-radius: 24px;
    border: 1px solid var(--term-border);
    box-shadow:
      inset 0 1px 1px rgba(255, 255, 255, 0.06),
      inset 0 0 0 1px rgba(255, 255, 255, 0.02),
      0 30px 60px rgba(0, 0, 0, 0.8),
      0 0 100px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    z-index: 10;
  }

  /* Terminal header */
  .term-header {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(0,0,0,0.5);
    box-shadow: 0 1px 0 rgba(255,255,255,0.02);
  }

  .traffic-lights {
    display: flex;
    gap: 8px;
  }

  .light {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow:
      inset -2px -2px 4px rgba(0, 0, 0, 0.4),
      inset 1px 1px 3px rgba(255, 255, 255, 0.4),
      0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .light.close { background-color: var(--btn-close); }
  .light.min { background-color: var(--btn-min); }
  .light.max { background-color: var(--btn-max); }

  .term-title {
    flex-grow: 1;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-left: -44px;
  }

  /* Terminal body */
  .term-body {
    padding: 24px;
    font-size: 13px;
    line-height: 1.7;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 320px;
  }

  /* Output lines */
  .term-line {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    opacity: 0;
    animation: lineIn 0.3s ease forwards;
  }

  .term-line.visible { opacity: 1; }

  .line-prefix {
    color: var(--text-muted);
    font-size: 11px;
    min-width: 16px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .line-content {
    flex: 1;
  }

  /* Step states */
  .step-line { color: var(--text-muted); }
  .step-line.active { color: var(--text-main); }
  .step-line.done .line-content { color: var(--btn-max); }
  .step-line.error .line-content { color: var(--btn-close); }

  .step-line .prefix-pending { color: var(--text-muted); }
  .step-line.active .line-prefix { color: var(--accent-teal); text-shadow: 0 0 8px rgba(94, 234, 212, 0.4); }
  .step-line.done .line-prefix { color: var(--btn-max); }
  .step-line.error .line-prefix { color: var(--btn-close); }

  /* Spinner for active steps */
  .term-spinner {
    display: inline-block;
    animation: spin-chars 0.6s steps(4) infinite;
    color: var(--accent-teal);
    text-shadow: 0 0 8px rgba(94, 234, 212, 0.4);
    width: 1ch;
  }

  /* Blinking cursor */
  .cursor {
    display: inline-block;
    width: 8px;
    height: 14px;
    background-color: var(--accent-teal);
    margin-left: 2px;
    box-shadow: 0 0 8px rgba(94, 234, 212, 0.4);
    animation: blink 1s step-end infinite;
    vertical-align: text-bottom;
  }

  /* Prompt line */
  .prompt-line {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-top: 12px;
  }

  .prompt-arrow {
    color: var(--accent-teal);
    font-weight: 700;
    text-shadow: 0 0 8px rgba(94, 234, 212, 0.4);
  }

  .prompt-text {
    color: var(--text-main);
  }

  /* ASCII buttons */
  .ascii-buttons {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
    padding-left: 26px;
  }

  .ascii-btn {
    -webkit-app-region: no-drag;
    font-family: var(--font-mono);
    font-size: 13px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    transition: color 0.15s, text-shadow 0.15s;
    display: none;
    line-height: 1.5;
  }

  .ascii-btn:hover {
    color: var(--accent-teal);
    text-shadow: 0 0 12px rgba(94, 234, 212, 0.5);
  }

  .ascii-btn:active {
    color: var(--text-main);
  }

  .ascii-btn .btn-highlight {
    color: var(--accent-teal);
  }

  .ascii-btn:hover .btn-highlight {
    color: var(--accent-teal);
    text-shadow: 0 0 12px rgba(94, 234, 212, 0.5);
  }

  /* Error detail */
  .error-detail {
    color: var(--btn-close);
    font-size: 12px;
    padding-left: 26px;
    margin-top: 4px;
    display: none;
  }

  /* Auth waiting message */
  .auth-waiting {
    display: none;
    padding-left: 26px;
    margin-top: 8px;
  }

  .auth-waiting .waiting-text {
    color: var(--text-muted);
    font-size: 12px;
  }

  .auth-waiting .waiting-hint {
    color: var(--text-muted);
    opacity: 0.5;
    font-size: 11px;
    margin-top: 2px;
  }

  /* Auth email */
  .auth-email {
    display: none;
    padding-left: 26px;
    margin-top: 4px;
    color: var(--accent-pink);
    font-size: 12px;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 24px;
    background: var(--term-surface);
    border-top: 1px solid var(--term-border);
    font-size: 11px;
    color: var(--text-muted);
    border-bottom-left-radius: 23px;
    border-bottom-right-radius: 23px;
  }

  .status-left, .status-right {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--accent-teal);
    box-shadow: 0 0 6px var(--accent-teal);
    transition: background-color 0.3s, box-shadow 0.3s;
  }

  .status-indicator.ready {
    background-color: var(--btn-max);
    box-shadow: 0 0 6px var(--btn-max);
  }

  .status-indicator.error {
    background-color: var(--btn-close);
    box-shadow: 0 0 6px var(--btn-close);
  }

  /* Animations */
  @keyframes blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  @keyframes spin-chars {
    0%   { content: '|'; }
    25%  { content: '/'; }
    50%  { content: '-'; }
    75%  { content: '\\\\'; }
  }

  @keyframes lineIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Syntax colors (matching design reference) */
  .cmd { color: var(--accent-teal); }
  .arg { color: #A7C080; }
  .str { color: #E69875; }
  .dim { opacity: 0.5; }
</style>
</head>
<body>

<!-- Editor toolbar -->
<div class="editor-toolbar">
  <div class="toolbar-left">
    <div class="toolbar-title">vibes.diy</div>
    <div class="toolbar-dot"></div>
  </div>
  <div class="toolbar-right">
    <span class="toolbar-pill">setup</span>
  </div>
</div>

<!-- Grid background with centered terminal -->
<div class="grid-area">
  <div class="terminal-wrapper">
    <div class="terminal">

      <!-- Terminal header with traffic lights -->
      <div class="term-header">
        <div class="traffic-lights">
          <div class="light close"></div>
          <div class="light min"></div>
          <div class="light max"></div>
        </div>
        <div class="term-title">vibes — setup</div>
      </div>

      <!-- Terminal body -->
      <div class="term-body">
        <!-- Welcome banner -->
        <div class="term-line visible" style="animation-delay: 0s">
          <span class="line-content" style="color: var(--accent-pink); font-weight: 500;">
            VibesOS — first launch setup
          </span>
        </div>
        <div class="term-line visible" style="animation-delay: 0.1s">
          <span class="line-content dim" style="font-size: 11px;">
            ─────────────────────────────────────
          </span>
        </div>

        <!-- Step: Claude -->
        <div class="term-line step-line visible" id="step-claude" style="animation-delay: 0.2s; margin-top: 8px;">
          <span class="line-prefix" id="icon-claude">○</span>
          <span class="line-content" id="label-claude">Checking for Claude Code...</span>
        </div>

        <!-- Step: Plugin -->
        <div class="term-line step-line visible" id="step-plugin" style="animation-delay: 0.3s">
          <span class="line-prefix" id="icon-plugin">○</span>
          <span class="line-content" id="label-plugin">Setting up Vibes plugin...</span>
        </div>

        <!-- Step: Auth -->
        <div class="term-line step-line visible" id="step-auth" style="animation-delay: 0.4s">
          <span class="line-prefix" id="icon-auth">○</span>
          <span class="line-content" id="label-auth">Authentication</span>
        </div>

        <!-- ASCII Buttons -->
        <div class="ascii-buttons">
          <button class="ascii-btn" id="auth-btn" onclick="fetch('http://localhost:3335/auth').catch(function(){})">
            <span class="btn-highlight">┌──────────────────────────────┐</span>
            <br>
            <span class="btn-highlight">│</span>  ▸ Sign in with Anthropic    <span class="btn-highlight">│</span>
            <br>
            <span class="btn-highlight">└──────────────────────────────┘</span>
          </button>
          <span id="auth-hint" style="display:none; font-size:11px; color:var(--text-muted); opacity:0.5; padding-left: 4px;">↑ opens your browser</span>
          <button class="ascii-btn" id="retry-btn" onclick="fetch('http://localhost:3335/retry').catch(function(){})">
            <span class="btn-highlight">┌─────────────┐</span>
            <br>
            <span class="btn-highlight">│</span>  ▸ Retry    <span class="btn-highlight">│</span>
            <br>
            <span class="btn-highlight">└─────────────┘</span>
          </button>
        </div>

        <div class="error-detail" id="error-detail"></div>
        <div class="auth-waiting" id="auth-waiting">
          <div class="waiting-text"><span class="term-spinner">|</span> Complete sign-in in your browser</div>
          <div class="waiting-hint">then return here</div>
        </div>
        <div class="auth-email" id="auth-email"></div>

        <!-- Prompt line (shows after completion) -->
        <div class="prompt-line" id="ready-prompt" style="display: none;">
          <span class="prompt-arrow">❯</span>
          <span class="prompt-text"><span class="cmd">vibes</span> <span class="arg">start</span></span><span class="cursor"></span>
        </div>
      </div>

      <!-- Status bar -->
      <div class="status-bar">
        <div class="status-left">
          <div class="status-item">
            <div class="status-indicator" id="status-dot"></div>
            <span id="status-label">Setting up</span>
          </div>
        </div>
        <div class="status-right">
          <div class="status-item" style="opacity: 0.5;">vibes.diy</div>
        </div>
      </div>

    </div>
  </div>
</div>

<script>
// Spinner animation via JS (CSS content animation isn't reliable)
var spinChars = ['|', '/', '-', '\\\\'];
var spinIdx = 0;
setInterval(function() {
  spinIdx = (spinIdx + 1) % spinChars.length;
  var spinners = document.querySelectorAll('.term-spinner');
  for (var i = 0; i < spinners.length; i++) {
    spinners[i].textContent = spinChars[spinIdx];
  }
}, 150);

function updateStep(id, state, label) {
  var step = document.getElementById('step-' + id);
  var icon = document.getElementById('icon-' + id);
  if (!step || !icon) return;

  // Reset classes
  step.className = 'term-line step-line visible ' + state;

  if (state === 'done') {
    icon.innerHTML = '✓';
  } else if (state === 'active') {
    icon.innerHTML = '<span class="term-spinner">' + spinChars[spinIdx] + '</span>';
  } else if (state === 'error') {
    icon.innerHTML = '✗';
  } else {
    icon.innerHTML = '○';
  }

  if (label) document.getElementById('label-' + id).textContent = label;
}

function showAuthButton(show) {
  document.getElementById('auth-btn').style.display = show ? 'inline-block' : 'none';
  document.getElementById('auth-hint').style.display = show ? 'inline-block' : 'none';
}

function showRetryButton(show) {
  document.getElementById('retry-btn').style.display = show ? 'inline-block' : 'none';
}

function showError(msg) {
  var el = document.getElementById('error-detail');
  if (msg) {
    el.textContent = '  error: ' + msg;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function showReady() {
  document.getElementById('status-dot').className = 'status-indicator ready';
  document.getElementById('status-label').textContent = 'Ready';
  document.getElementById('ready-prompt').style.display = 'flex';
}

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
  el.textContent = '  logged in as ' + (email || 'authenticated');
  el.style.display = 'block';
}

function showAuthError(msg) {
  document.getElementById('auth-waiting').style.display = 'none';
  document.getElementById('auth-btn').style.display = 'none';
  showError(msg);
  showRetryButton(true);
}

function showLoginScreen(subtitle) {
  // Hide steps, show just the auth button (re-login flow)
  document.getElementById('step-claude').style.display = 'none';
  document.getElementById('step-plugin').style.display = 'none';
  document.getElementById('step-auth').style.display = 'none';

  // Update banner text
  var banner = document.querySelector('.term-line.visible .line-content');
  if (banner) banner.textContent = subtitle || 'VibesOS — sign in';

  document.getElementById('auth-btn').style.display = 'inline-block';
  document.getElementById('auth-hint').style.display = 'inline-block';
}
</script>
</body>
</html>`;
