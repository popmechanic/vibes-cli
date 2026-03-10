// vibes-desktop/src/bun/setup-html.ts
// Inline HTML for the first-launch setup screen.
// Loaded via BrowserWindow({ html: ... }) — no external assets.
//
// Renders the editor chrome (black border wrapper, cream header with SVG logo,
// window controls, audio toggle, gray grid background) with a floating terminal
// window centered on top. Setup steps appear as terminal output lines; buttons
// are drawn in ASCII. Chrome matches skills/vibes/templates/editor.html exactly.

export const SETUP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibesOS Setup</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
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
  .vibes-pill { height: 36px; padding: 0 12px; }

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
    font-family: 'Courier New', 'Courier', monospace;
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
        <svg class="vibes-pill" xmlns="http://www.w3.org/2000/svg" viewBox="0 118 600 185" fill="currentColor">
          <path fill-rule="evenodd" clip-rule="evenodd" fill="#000" d="M293.353,298.09c-41.038,0-82.078,0.125-123.115-0.077c-11.993-0.06-24.011-0.701-35.964-1.703c-15.871-1.331-29.73-7.937-41.948-17.946c-16.769-13.736-27.207-31.417-30.983-52.7c-4.424-24.93,1.404-47.685,16.506-67.913c11.502-15.407,26.564-26.1,45.258-30.884c7.615-1.949,15.631-2.91,23.501-3.165c20.08-0.652,40.179-0.853,60.271-0.879c69.503-0.094,139.007-0.106,208.51,0.02c14.765,0.026,29.583,0.097,44.28,1.313c36.984,3.059,61.78,23.095,74.653,57.301c17.011,45.199-8.414,96.835-54.29,111.864c-7.919,2.595-16.165,3.721-24.434,3.871c-25.614,0.467-51.234,0.742-76.853,0.867C350.282,298.197,321.817,298.09,293.353,298.09z"/>
          <path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M165.866,285.985c-7.999-0.416-19.597-0.733-31.141-1.687c-15.692-1.297-28.809-8.481-40.105-19.104c-12.77-12.008-20.478-26.828-22.714-44.177c-3.048-23.644,3.384-44.558,19.646-62.143c9.174-9.92,20.248-17.25,33.444-20.363c7.786-1.837,15.944-2.399,23.973-2.828c9.988-0.535,121.023-0.666,131.021-0.371c10.191,0.301,20.433,0.806,30.521,2.175c12.493,1.696,23.132,7.919,32.552,16.091c14.221,12.337,22.777,27.953,25.184,46.594c2.822,21.859-2.605,41.617-16.777,58.695c-9.494,11.441-21.349,19.648-35.722,23.502c-6.656,1.785-13.724,2.278-20.647,2.77C286.914,285.721,177.682,285.667,165.866,285.985z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="var(--vibes-black)" d="M181.891,205.861c0-5.043-0.001-10.086,0-15.129c0.001-5.046,1.679-7.539,6.606-7.695c9.292-0.294,18.653-1.051,27.888,0.707c7.614,1.449,11.523,5.954,11.902,13.446c0.066,1.312-0.313,2.752-0.857,3.966c-1.401,3.123-1.399,6.266-0.673,9.507c0.301,1.342,0.443,2.723,0.787,4.053c1.274,4.925-1.78,10.114-6.085,11.937c-3.111,1.318-6.561,2.327-9.909,2.497c-7.303,0.37-14.639,0.136-21.96,0.101c-1.165-0.005-2.345-0.181-3.488-0.422c-2.657-0.56-4.162-2.962-4.197-6.801C181.854,216.639,181.891,211.25,181.891,205.861z M204.442,192.385c-2.757,0-5.514,0-8.271,0c-3.695,0-5.151,1.669-4.712,5.403c0.369,3.14,1.05,3.735,4.225,3.737c5.024,0.004,10.05,0.109,15.07-0.014c2.028-0.05,4.167-0.27,6.04-0.98c3.182-1.207,3.639-4.256,1.008-6.455c-1.073-0.896-2.659-1.509-4.06-1.618C210.659,192.22,207.544,192.385,204.442,192.385z M204.334,211.104c0,0.045,0,0.091,0,0.137c-3.101,0-6.203-0.055-9.302,0.037c-0.823,0.024-2.257,0.373-2.344,0.794c-0.447,2.154-0.959,4.444-0.639,6.563c0.276,1.822,2.447,1.451,3.882,1.441c5.989-0.042,11.98-0.118,17.961-0.385c1.416-0.063,2.859-0.79,4.176-1.441c1.79-0.886,1.833-2.475,1.029-4.046c-1.166-2.276-3.297-3.024-5.677-3.081C210.394,211.049,207.363,211.104,204.334,211.104z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="var(--vibes-black)" d="M291.409,229.748c-3.621-0.394-7.838-0.587-11.94-1.379c-3.577-0.69-6.343-2.991-8.213-6.163c-1.763-2.99-0.301-5.6,3.139-5.292c2.287,0.205,4.512,1.129,6.758,1.755c6.281,1.751,12.643,1.892,19.053,0.951c0.667-0.098,1.31-0.416,1.941-0.686c1.502-0.644,2.55-1.682,2.581-3.415c0.031-1.74-1.195-2.749-2.579-3.132c-2.298-0.637-4.688-1.021-7.065-1.273c-5.062-0.536-10.252-0.401-15.187-1.475c-9.677-2.105-11.678-10.53-10.101-16.009c1.62-5.625,5.911-8.92,11.318-9.73c8.388-1.257,16.925-1.491,25.279,0.654c3.702,0.951,6.615,3.072,7.883,6.931c0.918,2.792-0.332,4.6-3.268,4.357c-1.684-0.139-3.367-0.676-4.974-1.248c-6.711-2.387-13.572-2.897-20.569-1.783c-1.001,0.159-2.146,0.414-2.875,1.034c-0.901,0.766-2.016,1.981-1.98,2.964c0.041,1.128,0.995,2.733,1.991,3.206c1.81,0.857,3.925,1.279,5.948,1.441c5.152,0.41,10.356,0.296,15.479,0.905c7.98,0.949,13.779,9.833,11.241,17.125c-1.959,5.628-6.44,8.489-12.143,9.322C299.455,229.344,295.715,229.419,291.409,229.748z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="var(--vibes-black)" d="M235.786,208.14c0-6.905-0.01-13.809,0.004-20.714c0.007-3.474,0.948-4.428,4.415-3.758c6.62,1.279,13.232,2.651,19.759,4.331c1.7,0.438,3.404,1.896,4.515,3.341c1.777,2.31,0.433,5.367-2.463,5.745c-1.86,0.243-3.819-0.138-5.717-0.368c-2.183-0.264-4.339-0.783-6.525-0.976c-1.572-0.138-3.065,0.375-3.8,1.959c-0.76,1.638-0.319,3.329,0.942,4.34c1.619,1.296,3.522,2.327,5.447,3.128c2.146,0.894,4.539,1.207,6.66,2.145c1.446,0.64,2.982,1.687,3.786,2.981c0.689,1.11,0.928,3.094,0.378,4.202c-0.492,0.991-2.32,1.795-3.579,1.825c-2.238,0.052-4.483-0.652-6.741-0.832c-1.614-0.127-3.333-0.203-4.865,0.212c-2.574,0.699-3.225,3.013-1.719,5.218c1.396,2.044,3.431,3.141,5.757,3.761c2.791,0.744,5.637,1.315,8.373,2.222c3.19,1.058,4.791,3.496,4.801,6.723c0.011,3.365-1.759,5.021-5.138,4.424c-4.402-0.778-8.759-1.81-13.134-2.735c-2.357-0.499-4.718-0.981-7.069-1.511c-3.263-0.737-4.132-1.805-4.141-5.154c-0.019-6.836-0.006-13.672-0.006-20.508C235.747,208.141,235.766,208.14,235.786,208.14z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="var(--vibes-black)" d="M135.138,229.842c-2.941-0.084-5.296-1.462-6.684-3.9c-1.827-3.21-3.328-6.618-4.81-10.011c-3.55-8.128-7.021-16.291-10.486-24.455c-0.48-1.132-0.902-2.329-1.087-3.536c-0.417-2.72,1.238-4.585,3.938-4.119c1.591,0.275,3.569,0.98,4.45,2.173c2.226,3.015,4.175,6.299,5.784,9.69c2.208,4.654,3.898,9.552,6.032,14.244c0.628,1.379,2.009,2.416,3.045,3.609c0.892-1.159,2.042-2.201,2.63-3.498c2.697-5.953,5.22-11.985,7.841-17.974c1.423-3.252,3.089-6.418,6.532-7.905c1.238-0.535,3.012-0.712,4.184-0.214c0.81,0.344,1.377,2.126,1.385,3.271c0.009,1.458-0.479,2.997-1.059,4.371c-4.227,10.013-8.504,20.005-12.833,29.974c-0.79,1.819-1.762,3.589-2.875,5.229C139.73,228.848,137.671,229.894,135.138,229.842z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="var(--vibes-black)" d="M164.636,206.263c0-6.691,0.054-13.383-0.036-20.073c-0.024-1.851,0.716-2.67,2.449-2.81c0.274-0.022,0.549-0.054,0.823-0.076c5.488-0.445,6.091,0.105,6.091,5.562c0,12.348,0,24.695,0,37.043c0,2.887-0.354,3.405-3.222,3.618c-1.628,0.121-3.338-0.001-4.91-0.408c-0.593-0.153-1.265-1.408-1.278-2.171c-0.096-5.584-0.034-11.172-0.022-16.759c0.002-1.308,0-2.617,0-3.926C164.566,206.263,164.601,206.263,164.636,206.263z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="#fff" d="M388.313,210.147c0-6.356,0.034-12.713-0.023-19.069c-0.015-1.61,0.359-2.472,2.19-2.346c2.887,0.198,5.809,0.045,8.671,0.398c4.396,0.542,8.019,4.294,8.144,8.904c0.223,8.142,0.265,16.304-0.074,24.439c-0.248,5.945-4.552,9.662-10.491,9.831c-1.999,0.057-4.003-0.081-6.006-0.09c-1.746-0.008-2.439-0.853-2.428-2.584C388.34,223.136,388.313,216.642,388.313,210.147z M393.418,210.324c-0.037,0-0.075,0-0.114,0c0,4.55-0.038,9.101,0.015,13.65c0.031,2.688,0.926,3.439,3.56,3.239c3.273-0.248,5.493-2.511,5.534-6.04c0.082-7.099,0.054-14.2-0.033-21.299c-0.041-3.268-1.739-5.241-4.87-6.092c-2.68-0.728-4.025,0.161-4.07,2.896C393.364,201.226,393.418,205.775,393.418,210.324z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="#fff" d="M478.079,200.8c0.674-1.566,1.121-2.53,1.506-3.519c0.673-1.73,1.252-3.5,1.981-5.205c0.315-0.737,0.766-1.654,1.407-1.961c1.094-0.523,2.388-0.63,3.598-0.912c0.205,1.142,0.798,2.381,0.537,3.404c-0.606,2.388-1.448,4.756-2.507,6.984c-3.981,8.389-4.352,17.254-3.78,26.282c0.091,1.438,0.031,2.899-0.105,4.335c-0.14,1.473-0.989,2.428-2.542,2.497c-1.514,0.067-2.311-0.903-2.54-2.23c-0.232-1.348-0.394-2.754-0.277-4.108c0.94-10.972-1.116-21.38-5.626-31.375c-0.586-1.298-0.899-2.762-1.093-4.183c-0.233-1.712,0.825-2.592,2.379-1.843c1.164,0.561,2.345,1.55,2.973,2.657c1.078,1.897,1.712,4.043,2.568,6.07C476.918,198.547,477.37,199.361,478.079,200.8z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="#fff" d="M440.516,210.627c0,6.281,0.007,12.563-0.004,18.844c-0.004,2.067-0.805,3.038-2.531,3.015c-1.877-0.025-2.365-1.136-2.359-2.876c0.046-12.631,0.019-25.263,0.029-37.895c0.002-2.592,0.525-3.205,2.419-3.148c1.856,0.057,2.479,1.03,2.466,2.803C440.484,197.788,440.515,204.208,440.516,210.627z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="#fff" d="M416.875,210.721c0.068-3.305,1.849-5.306,4.727-5.309c2.765-0.003,4.924,2.404,4.816,5.371c-0.106,2.956-2.355,5.212-5.12,5.138C418.626,215.849,416.813,213.718,416.875,210.721z"/>
          <path fill-rule="evenodd" clip-rule="evenodd" fill="#fff" d="M449.933,210.636c0.102-3.331,1.886-5.279,4.778-5.22c2.67,0.055,4.829,2.432,4.762,5.243c-0.073,3.021-2.404,5.36-5.242,5.261C451.606,215.829,449.84,213.657,449.933,210.636z"/>
        </svg>
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
            <button class="ascii-btn" id="continue-btn" onclick="fetch('http://localhost:3335/continue').catch(function(){})"
              style="margin-top: 8px;">
              <span class="btn-highlight">┌──────────────────────────────┐</span>
              <br>
              <span class="btn-highlight">│</span>  ▸ Continue                   <span class="btn-highlight">│</span>
              <br>
              <span class="btn-highlight">└──────────────────────────────┘</span>
            </button>
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
              <button class="ascii-btn" id="welcome-auth-btn" onclick="fetch('http://localhost:3335/auth').catch(function(){})" style="display: inline-block;"><span class="btn-highlight">┌────────────────────┐</span>
<span class="btn-highlight">│</span>  ▸ Sign in          <span class="btn-highlight">│</span>
<span class="btn-highlight">└────────────────────┘</span></button>
            </div>
            <div class="welcome-hint">Don't have an account? You'll be able to create one.</div>
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
</script>
</body>
</html>`;
