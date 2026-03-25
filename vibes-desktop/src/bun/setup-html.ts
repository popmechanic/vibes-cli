// vibes-desktop/src/bun/setup-html.ts
// Inline HTML for the first-launch setup screen.
// Loaded via BrowserWindow({ html: ... }) — no external assets.
//
// Renders the editor chrome (black border wrapper, cream header with SVG logo,
// window controls, audio toggle, gray grid background) with a floating terminal
// window centered on top. Setup steps appear as terminal output lines; buttons
// are drawn in ASCII. Chrome matches skills/vibes/templates/editor.html exactly.

import { VIBES_OS_HEADER_SVG, VIBES_OS_LOADING_SVG } from './brand-assets.ts';

export function makeSetupHtml(ipcToken: string): string {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>var IPC_BASE='http://127.0.0.1:3335';var IPC_TOKEN='${ipcToken}';function ipc(a){return fetch(IPC_BASE+'/'+a+'?token='+IPC_TOKEN).catch(function(){});}</script>
<title>VibesOS Setup</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    /* Editor chrome tokens (from editor.html) */
    --vibes-black: #0f172a;
    --vibes-near-black: #1a1a1a;
    --vibes-cream: #fffff0;
    --vibes-menu-bg: #CCCDC8;
    --vibes-blue: #009ACE;
    --vibes-red: #DA291C;
    --vibes-yellow: #fedd00;
    --vibes-green: #22c55e;
    --vibes-white: #fff;
    --grid-size: 32px;
    --grid-color: rgba(255, 255, 255, 0.5);

    /* Terminal tokens */
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

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: black;
    color: var(--vibes-near-black);
    height: 100vh;
    overflow: hidden;
    margin: 0;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }

  /* === BLACK BORDER WRAPPER (from editor.html) === */
  .black-border-wrapper {
    position: fixed;
    inset: 0;
    background: black;
  }
  .black-border-inner {
    height: calc(100% - 20px);
    width: calc(100% - 20px);
    margin: 10px;
    border-radius: 10px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--vibes-menu-bg);
  }

  /* === HEADER (from editor.html) === */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0;
    background: var(--vibes-cream);
    border-bottom: 1px solid black;
    height: 64px;
    flex-shrink: 0;
    font-family: 'Alte Haas Grotesk', 'Inter', sans-serif;
    box-shadow: 0px 1px 0px 0px var(--vibes-cream);
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
  }
  .header-left { display: flex; align-items: center; height: 100%; }
  .header-drag {
    flex: 1; height: 100%; cursor: default;
    display: flex; align-items: center; justify-content: center;
    -webkit-app-region: drag;
  }
  .header-right { display: flex; align-items: center; height: 100%; }

  /* Desktop window controls (traffic lights) */
  .window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px 0 16px;
    height: 100%;
    -webkit-app-region: no-drag;
  }
  .window-dot {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  .window-dot:hover { filter: brightness(1.15); }
  .window-dot:active { filter: brightness(0.85); }
  .window-dot--close { background: #ED6A5E; }
  .window-dot--minimize { background: #F5BF4F; }
  .window-dot--zoom { background: #62C554; }

  /* Logo pill */
  .vibes-pill-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 63px;
  }
  .vibes-pill { height: 32px; padding: 0 8px; }

  /* === VIBES AUDIO TOGGLE (from editor.html) === */
  .vibes-audio-toggle {
    display: flex;
    align-items: center;
    height: 63px;
    border-left: 1px solid rgba(0,0,0,0.08);
  }
  .vibes-audio-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 63px;
    padding: 0 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.3s ease, box-shadow 0.4s ease;
    position: relative;
    font-family: 'Alte Haas Grotesk', 'Inter', sans-serif;
  }
  .vibes-audio-btn:hover {
    background: rgba(0,154,206,0.06);
  }
  .vibes-audio-emoji {
    font-size: 22px;
    display: inline-block;
    transition: transform 0.3s ease;
    line-height: 1;
  }
  .vibes-audio-btn:not(.active) .vibes-audio-emoji {
    opacity: 0.5;
  }
  .vibes-waves {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 24px;
    position: relative;
  }
  .vibes-wave-bar {
    width: 3px;
    border-radius: 1.5px;
    background: var(--vibes-blue);
    transform-origin: center;
    transition: height 0.4s ease, opacity 0.3s ease;
  }
  .vibes-audio-btn:not(.active) .vibes-wave-bar {
    height: 4px !important;
    opacity: 0.25;
    animation: none !important;
  }
  .vibes-audio-label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    opacity: 0;
    max-width: 0;
    overflow: hidden;
    white-space: nowrap;
    transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
    color: var(--vibes-near-black);
  }
  .vibes-audio-btn:hover .vibes-audio-label {
    opacity: 0.6;
    max-width: 40px;
    margin-left: 4px;
  }

  /* === GRID BACKGROUND === */
  .grid-area {
    flex: 1;
    background-color: var(--vibes-menu-bg);
    background-image:
      linear-gradient(var(--grid-color) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
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
    font-family: var(--font-mono);
    color: var(--text-main);
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

  .term-title {
    flex-grow: 1;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-muted);
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

  /* Welcome screen (phase 2) */
  .welcome-screen {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 12px 0 8px 0;
  }

  .welcome-screen.visible { display: flex; }

  .welcome-ascii {
    font-size: 11px;
    line-height: 1.4;
    text-align: center;
    white-space: pre;
    margin-bottom: 8px;
    font-family: Menlo, Monaco, 'SF Mono', 'Courier New', monospace;
    background: linear-gradient(to right,
      #009ACE 0% 14.3%,
      #7A7A7A 14.3% 28.6%,
      #FFFFF0 28.6% 42.9%,
      #CCCDC8 42.9% 57.2%,
      #DA291C 57.2% 71.5%,
      #FEDD00 71.5% 85.8%,
      #009ACE 85.8% 100%
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .welcome-tagline {
    color: var(--text-main);
    font-size: 12px;
    line-height: 1.8;
    text-align: center;
    max-width: 440px;
  }

  .welcome-tagline em {
    font-style: normal;
    color: var(--accent-teal);
  }

  .welcome-hint {
    color: var(--text-muted);
    opacity: 0.6;
    font-size: 11px;
    text-align: center;
  }

  .welcome-buttons {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .welcome-buttons .ascii-btn {
    white-space: pre;
    text-align: left;
    line-height: 1.4;
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

  /* Progress bar */
  .progress-container {
    display: none;
    padding-left: 26px;
    margin: 4px 0 6px 0;
    animation: lineIn 0.3s ease forwards;
  }

  .progress-container.visible { display: block; }

  .progress-track {
    height: 6px;
    background: var(--term-border);
    border-radius: 3px;
    overflow: hidden;
    margin: 4px 0;
  }

  .progress-fill {
    height: 100%;
    width: 0%;
    background: var(--accent-teal);
    border-radius: 3px;
    box-shadow: 0 0 8px rgba(94, 234, 212, 0.3);
    transition: width 0.15s ease-out;
  }

  .progress-stats {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  /* Syntax colors */
  .cmd { color: var(--accent-teal); }
  .arg { color: #A7C080; }
  .str { color: #E69875; }
  .dim { opacity: 0.5; }
</style>
</head>
<body>

<div class="black-border-wrapper">
<div class="black-border-inner">

  <!-- Header (matches editor.html) -->
  <div class="header">
    <div class="header-left">
      <div class="window-controls">
        <button class="window-dot window-dot--close" onclick="windowControl('close')" title="Close"></button>
        <button class="window-dot window-dot--minimize" onclick="windowControl('minimize')" title="Minimize"></button>
        <button class="window-dot window-dot--zoom" onclick="windowControl('zoom')" title="Zoom"></button>
      </div>
      <div class="vibes-pill-wrap">
        ${VIBES_OS_HEADER_SVG}
      </div>
      <div class="vibes-audio-toggle">
        <button class="vibes-audio-btn" title="Toggle vibes">
          <span class="vibes-audio-emoji"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg></span>
          <div class="vibes-waves">
            <div class="vibes-wave-bar" style="height:10px"></div>
            <div class="vibes-wave-bar" style="height:16px"></div>
            <div class="vibes-wave-bar" style="height:22px"></div>
            <div class="vibes-wave-bar" style="height:18px"></div>
            <div class="vibes-wave-bar" style="height:12px"></div>
          </div>
          <span class="vibes-audio-label">OFF</span>
        </button>
      </div>
    </div>
    <div class="header-drag"></div>
    <div class="header-right"></div>
  </div>

  <!-- Grid background with centered terminal -->
  <div class="grid-area">
    <div class="terminal-wrapper">
      <div class="terminal">

        <!-- Terminal header -->
        <div class="term-header">
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

          <!-- Progress bar (shown during Claude download) -->
          <div class="progress-container" id="progress-container">
            <div class="progress-stats">
              <span id="progress-label">Downloading...</span>
              <span id="progress-pct">0%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" id="progress-fill"></div>
            </div>
            <div class="progress-stats">
              <span id="progress-size"></span>
              <span id="progress-speed"></span>
            </div>
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
            <button class="ascii-btn" id="auth-btn" onclick="ipc('auth')">
              <span class="btn-highlight">┌──────────────────────────────┐</span>
              <br>
              <span class="btn-highlight">│</span>  ▸ Sign in with Anthropic    <span class="btn-highlight">│</span>
              <br>
              <span class="btn-highlight">└──────────────────────────────┘</span>
            </button>
            <span id="auth-hint" style="display:none; font-size:11px; color:var(--text-muted); opacity:0.5; padding-left: 4px;">↑ opens your browser</span>
            <button class="ascii-btn" id="continue-btn" onclick="onContinueClick()"
              style="margin-top: 8px;">
              <span class="btn-highlight">┌──────────────────────────────┐</span>
              <br>
              <span class="btn-highlight">│</span>  ▸ Continue                   <span class="btn-highlight">│</span>
              <br>
              <span class="btn-highlight">└──────────────────────────────┘</span>
            </button>
            <div class="term-line step-line active" id="starting-line" style="display: none; margin-top: 12px;">
              <span class="line-prefix"><span class="term-spinner">|</span></span>
              <span class="line-content">Starting editor...</span>
            </div>
            <button class="ascii-btn" id="retry-btn" onclick="ipc('retry')">
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

          <!-- Welcome screen (phase 2: after Claude installed) -->
          <div class="welcome-screen" id="welcome-screen">
            <pre class="welcome-ascii">▄   ▄ ▄ ▗▖   ▗▞▀▚▖ ▄▄▄  ▗▄▖  ▗▄▄▖
█   █ ▄ ▐▌   ▐▛▀▀▘▀▄▄  ▐▌ ▐▌▐▌
 ▀▄▀  █ ▐▛▀▚▖▝▚▄▄▖▄▄▄▀ ▐▌ ▐▌ ▝▀▚▖
      █ ▐▙▄▞▘          ▝▚▄▞▘▗▄▄▞▘</pre>
            <div class="welcome-tagline">
              The fastest and easiest way to turn your ideas
              into 100% secure multiplayer and AI apps —
              without a web server. <em>It's magic.</em>
            </div>
            <div class="welcome-buttons">
              <button class="ascii-btn" id="welcome-auth-btn" onclick="ipc('auth')" style="display: inline-block;"><span class="btn-highlight">┌────────────────────┐</span>
<span class="btn-highlight">│</span>  ▸ Sign in          <span class="btn-highlight">│</span>
<span class="btn-highlight">└────────────────────┘</span></button>
            </div>
            <div class="welcome-hint">Don't have an account? You'll be able to create one.</div>
          </div>

          <!-- Update screen (shown when update available) -->
          <div class="update-screen" id="update-screen" style="display: none;">
            <div class="term-line visible">
              <span class="line-prefix" style="color: var(--accent-teal);">↑</span>
              <span class="line-content">Update available</span>
            </div>
            <div style="padding-left: 26px; margin-top: 8px;">
              <div style="color: var(--text-muted); font-size: 12px;">
                Current: <span id="update-current-version" style="color: var(--text-main);">—</span>
              </div>
              <div style="color: var(--text-muted); font-size: 12px; margin-top: 2px;">
                Available: <span id="update-new-version" style="color: var(--accent-teal);">—</span>
              </div>
            </div>
            <div class="ascii-buttons" style="margin-top: 12px;">
              <button class="ascii-btn" id="update-now-btn" style="display: inline-block;" onclick="ipc('update-now')">
                <span class="btn-highlight">┌──────────────────────────────┐</span>
                <br>
                <span class="btn-highlight">│</span>  ▸ Update Now                 <span class="btn-highlight">│</span>
                <br>
                <span class="btn-highlight">└──────────────────────────────┘</span>
              </button>
              <button class="ascii-btn" id="update-skip-btn" style="display: inline-block;" onclick="ipc('update-skip')">
                <span class="btn-highlight">┌─────────────┐</span>
                <br>
                <span class="btn-highlight">│</span>  ▸ Skip     <span class="btn-highlight">│</span>
                <br>
                <span class="btn-highlight">└─────────────┘</span>
              </button>
            </div>
          </div>

          <!-- Update progress (shown during download) -->
          <div class="update-progress" id="update-progress" style="display: none;">
            <div class="term-line visible">
              <span class="line-prefix"><span class="term-spinner">|</span></span>
              <span class="line-content" id="update-status-text">Downloading update...</span>
            </div>
            <div class="progress-container visible" style="display: block;">
              <div class="progress-stats">
                <span id="update-progress-label">Downloading...</span>
                <span id="update-progress-pct">0%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" id="update-progress-fill"></div>
              </div>
            </div>
          </div>

          <!-- Update error -->
          <div class="update-error" id="update-error" style="display: none;">
            <div class="term-line step-line error visible">
              <span class="line-prefix" style="color: var(--btn-close);">✗</span>
              <span class="line-content" id="update-error-text" style="color: var(--btn-close);">Download failed</span>
            </div>
            <div class="ascii-buttons" style="margin-top: 8px;">
              <button class="ascii-btn" id="update-error-skip-btn" style="display: inline-block;" onclick="ipc('update-skip')">
                <span class="btn-highlight">┌──────────────────────────────┐</span>
                <br>
                <span class="btn-highlight">│</span>  ▸ Continue without updating  <span class="btn-highlight">│</span>
                <br>
                <span class="btn-highlight">└──────────────────────────────┘</span>
              </button>
            </div>
          </div>

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

</div>
</div>

<script>
// No-op window control (setup loads via loadHTML, IPC not available)
function windowControl(action) {}

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
  document.getElementById('continue-btn').style.display = 'inline-block';
}

function onContinueClick() {
  document.getElementById('continue-btn').style.display = 'none';
  document.getElementById('ready-prompt').style.display = 'none';
  document.getElementById('starting-line').style.display = 'flex';
  ipc('continue');
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

var progressStart = 0;
function showProgress(show) {
  var el = document.getElementById('progress-container');
  if (show) {
    el.className = 'progress-container visible';
    progressStart = Date.now();
    document.getElementById('progress-label').textContent = 'Downloading...';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-pct').textContent = '0%';
    document.getElementById('progress-size').textContent = '';
    document.getElementById('progress-speed').textContent = '';
  } else {
    el.className = 'progress-container';
  }
}

function updateProgress(downloaded, total) {
  var pct = Math.min(Math.round((downloaded / total) * 100), 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';

  var elapsed = (Date.now() - progressStart) / 1000;
  if (elapsed > 1) {
    document.getElementById('progress-size').textContent = Math.round(elapsed) + 's elapsed';
  }

  if (pct >= 100) {
    document.getElementById('progress-label').textContent = 'Verifying...';
  }
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

function showWelcomeScreen() {
  // Hide setup steps and banner
  document.getElementById('step-claude').style.display = 'none';
  document.getElementById('step-plugin').style.display = 'none';
  document.getElementById('step-auth').style.display = 'none';
  var bannerLines = document.querySelectorAll('.term-body > .term-line');
  for (var i = 0; i < bannerLines.length; i++) bannerLines[i].style.display = 'none';
  document.querySelector('.ascii-buttons').style.display = 'none';

  // Show the welcome screen
  document.getElementById('welcome-screen').className = 'welcome-screen visible';
}

function hideWelcomeScreen() {
  document.getElementById('welcome-screen').className = 'welcome-screen';
  // Restore step-auth and ascii-buttons (hidden by showWelcomeScreen)
  document.getElementById('step-auth').style.display = '';
  document.querySelector('.ascii-buttons').style.display = '';
}

function showUpdateScreen(currentVersion, newVersion) {
  // Hide setup steps and other screens
  document.getElementById('step-claude').style.display = 'none';
  document.getElementById('step-plugin').style.display = 'none';
  document.getElementById('step-auth').style.display = 'none';
  document.querySelector('.ascii-buttons').style.display = 'none';
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('ready-prompt').style.display = 'none';

  // Update banner text
  var banner = document.querySelector('.term-body > .term-line.visible .line-content');
  if (banner) banner.textContent = 'VibesOS — update available';

  // Update title
  var termTitle = document.querySelector('.term-title');
  if (termTitle) termTitle.textContent = 'vibes — update';

  // Set version numbers
  document.getElementById('update-current-version').textContent = 'v' + currentVersion;
  document.getElementById('update-new-version').textContent = 'v' + newVersion;

  // Show update screen
  document.getElementById('update-screen').style.display = 'block';
}

function showUpdateProgress(statusText) {
  document.getElementById('update-screen').style.display = 'none';
  document.getElementById('update-progress').style.display = 'block';
  if (statusText) {
    document.getElementById('update-status-text').textContent = statusText;
  }
}

function updateUpdateProgress(progress) {
  var pct = Math.min(Math.round(progress), 100);
  document.getElementById('update-progress-fill').style.width = pct + '%';
  document.getElementById('update-progress-pct').textContent = pct + '%';
  if (pct >= 100) {
    document.getElementById('update-progress-label').textContent = 'Applying...';
  }
}

function showUpdateError(errorMsg) {
  document.getElementById('update-screen').style.display = 'none';
  document.getElementById('update-progress').style.display = 'none';
  document.getElementById('update-error').style.display = 'block';
  document.getElementById('update-error-text').textContent = errorMsg || 'Download failed — try again later';
}
</script>
</body>
</html>`;
}

// Legacy export for callers that haven't migrated to makeSetupHtml()
export const SETUP_HTML = makeSetupHtml('');

// Splash screen shown to returning users while auth check, update check,
// and server boot run. Matches the editor chrome (gray grid, cream header).
export const LOADING_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibesOS</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', 'Menlo', monospace;
    background: black;
    height: 100vh;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    user-select: none;
  }
  .border-wrap {
    position: fixed; inset: 0; background: black;
  }
  .border-inner {
    height: calc(100% - 20px); width: calc(100% - 20px);
    margin: 10px; border-radius: 10px;
    position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    background: #CCCDC8;
  }
  .header {
    display: flex; align-items: center; justify-content: center;
    background: #fffff0; border-bottom: 1px solid black;
    height: 64px; flex-shrink: 0;
    border-top-left-radius: 10px; border-top-right-radius: 10px;
    box-shadow: 0px 1px 0px 0px #fffff0;
    -webkit-app-region: drag;
  }
  .grid-area {
    flex: 1;
    background-color: #CCCDC8;
    background-image:
      linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px);
    background-size: 32px 32px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 24px;
  }
  .pill-svg {
    width: 120px; opacity: 0.5;
    animation: pillPulse 2s ease-in-out infinite;
  }
  @keyframes pillPulse {
    0%, 100% { opacity: 0.3; transform: scale(0.97); }
    50% { opacity: 0.6; transform: scale(1.03); }
  }
  .loading-text {
    font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
    color: #1a1a1a; opacity: 0.35;
  }
</style>
</head>
<body>
<div class="border-wrap">
<div class="border-inner">
  <div class="header"></div>
  <div class="grid-area">
    ${VIBES_OS_LOADING_SVG}
    <div class="loading-text">Booting Up</div>
  </div>
</div>
</div>
</body>
</html>`;
