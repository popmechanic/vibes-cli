// vibes-desktop/src/bun/setup-html.ts
// Inline HTML for the first-launch setup screen.
// Loaded via BrowserWindow({ html: ... }) — no external assets.

export const SETUP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibesOS Setup</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
  }
  .card {
    text-align: center;
    max-width: 420px;
    padding: 48px 40px;
  }
  .logo {
    font-size: 48px;
    margin-bottom: 8px;
    letter-spacing: -1px;
    font-weight: 700;
    background: linear-gradient(135deg, #a78bfa, #60a5fa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 40px;
  }
  .steps {
    text-align: left;
    margin-bottom: 32px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    font-size: 15px;
    color: #666;
    transition: color 0.3s;
  }
  .step.active { color: #e0e0e0; }
  .step.done { color: #4ade80; }
  .step.error { color: #f87171; }
  .step-icon {
    width: 20px;
    text-align: center;
    font-size: 14px;
  }
  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid #444;
    border-top-color: #a78bfa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .auth-btn {
    -webkit-app-region: no-drag;
    background: linear-gradient(135deg, #7c3aed, #3b82f6);
    color: white;
    border: none;
    padding: 12px 32px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: none;
    margin: 0 auto;
    transition: opacity 0.2s;
  }
  .auth-btn:hover { opacity: 0.9; }
  .retry-btn {
    -webkit-app-region: no-drag;
    background: #333;
    color: #e0e0e0;
    border: 1px solid #555;
    padding: 10px 24px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    display: none;
    margin: 8px auto 0;
  }
  .retry-btn:hover { background: #444; }
  .error-detail {
    font-size: 13px;
    color: #f87171;
    margin-top: 12px;
    display: none;
    text-align: center;
  }
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
</style>
</head>
<body>
<div class="card">
  <div class="logo">VibesOS</div>
  <div class="subtitle">Setting up your environment</div>
  <div class="steps">
    <div class="step" id="step-claude">
      <span class="step-icon" id="icon-claude">○</span>
      <span id="label-claude">Checking for Claude Code...</span>
    </div>
    <div class="step" id="step-plugin">
      <span class="step-icon" id="icon-plugin">○</span>
      <span id="label-plugin">Setting up Vibes plugin...</span>
    </div>
    <div class="step" id="step-auth">
      <span class="step-icon" id="icon-auth">○</span>
      <span id="label-auth">Authentication</span>
    </div>
  </div>
  <button class="auth-btn" id="auth-btn" onclick="fetch('http://localhost:3335/auth').catch(function(){})">
    Sign in with Anthropic
  </button>
  <button class="retry-btn" id="retry-btn" onclick="fetch('http://localhost:3335/retry').catch(function(){})">
    Retry
  </button>
  <div class="error-detail" id="error-detail"></div>
  <div style="font-size:11px;color:#555;margin-top:6px;text-align:center;display:none" id="auth-hint">Opens your browser</div>
  <div class="auth-waiting" id="auth-waiting">
    Complete sign-in in your browser
    <div class="hint">then return here</div>
  </div>
  <div class="auth-email" id="auth-email"></div>
</div>
<script>
function updateStep(id, state, label) {
  var step = document.getElementById('step-' + id);
  var icon = document.getElementById('icon-' + id);
  if (!step || !icon) return;
  step.className = 'step ' + state;
  if (state === 'done') icon.innerHTML = '✓';
  else if (state === 'active') icon.innerHTML = '<span class="spinner"></span>';
  else if (state === 'error') icon.innerHTML = '✗';
  else icon.innerHTML = '○';
  if (label) document.getElementById('label-' + id).textContent = label;
}
function showAuthButton(show) {
  document.getElementById('auth-btn').style.display = show ? 'block' : 'none';
  document.getElementById('auth-hint').style.display = show ? 'block' : 'none';
}
function showRetryButton(show) {
  document.getElementById('retry-btn').style.display = show ? 'block' : 'none';
}
function showError(msg) {
  var el = document.getElementById('error-detail');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}
function showReady() {
  document.querySelector('.subtitle').textContent = 'Ready!';
  document.querySelector('.subtitle').style.color = '#4ade80';
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
  document.getElementById('auth-hint').style.display = 'block';
}
</script>
</body>
</html>`;
