/**
 * Shared assembly constants and validation utilities.
 *
 * Used by assemble.js, assemble-all.js, assemble-factory.js, and their tests.
 */

export const APP_PLACEHOLDER = '// __VIBES_APP_CODE__';
export const AUTH_INJECT_MARKER = '// <!-- AUTH:INJECT -->';

/**
 * Inject code into a template at a placeholder.
 *
 * Uses a function callback so `$` sequences in code aren't interpreted as
 * String.prototype.replace special patterns ($', $&, $`, $1–$9). Passing the
 * code as a raw string causes currency literals like `prefix: '$'` to expand
 * `$'` into the template tail, duplicating output.
 */
export function injectCode(template, placeholder, code) {
  return template.replace(placeholder, () => code);
}

/**
 * Load a template file and validate it contains the placeholder.
 * @param {string} templatePath - Path to template file
 * @param {Function} readFileFn - Function to read a file (default: fs.readFileSync)
 * @param {string} [placeholder=APP_PLACEHOLDER] - Placeholder to check for
 * @returns {string} Template content
 * @throws {Error} If file missing or no placeholder found
 */
export function loadAndValidateTemplate(templatePath, readFileFn, placeholder = APP_PLACEHOLDER) {
  let content;
  try {
    content = readFileFn(templatePath, 'utf8');
  } catch (err) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  if (!content.includes(placeholder)) {
    throw new Error(`Template missing placeholder: ${placeholder}`);
  }

  return content;
}

/**
 * Validate assembled HTML output.
 * Returns array of error strings (empty = valid).
 * Checks: app code present, no remaining placeholder, App component found, script tags balanced.
 *
 * @param {string} html - Assembled HTML output
 * @param {string} code - App code that was inserted
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateAssembly(html, code) {
  const errors = [];

  if (!code || code.trim().length === 0) {
    errors.push('App code is empty');
  }

  if (html.includes(APP_PLACEHOLDER)) {
    errors.push('Placeholder was not replaced');
  }

  if (!html.includes('export default function') && !html.includes('function App')) {
    errors.push('No App component found');
  }

  const scriptOpens = (html.match(/<script/gi) || []).length;
  const scriptCloses = (html.match(/<\/script>/gi) || []).length;
  if (scriptOpens !== scriptCloses) {
    errors.push(`Mismatched script tags: ${scriptOpens} opens, ${scriptCloses} closes`);
  }

  return errors;
}

const FORBIDDEN_PATTERNS = [
  { pattern: /\bimport\s+.+from\s+['"]/, message: 'Generated code contains import statements — all modules are globals provided by the template' },
  { pattern: /\bcreateStore\b|\bcreateMergeableStore\b/, message: 'Generated code creates its own store — the template manages the store' },
  { pattern: /\bstore\.set[A-Z]|\bstore\.add[A-Z]|\bstore\.del[A-Z]/, message: 'Generated code calls store methods directly — use callback hooks instead' },
];

export function checkForbiddenPatterns(code) {
  const warnings = [];
  for (const { pattern, message } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      warnings.push(message);
    }
  }
  return warnings;
}

/**
 * Extract the app's background color from its `:root` CSS custom property
 * or `body` block, and inject two inline `<style>` blocks into the
 * assembled HTML so the template frame and the floating overlay show the
 * app's background instead of the template's default.
 *
 * Also injects cache-control meta tags so users always get the latest
 * deploy rather than a CDN-cached copy.
 *
 * Previously ran at deploy time in handlers/deploy.ts — moved here so the
 * same treatment applies to every assembly path (editor deploy, CLI
 * deploy, terminal reassemble) without the deploy handler needing to
 * re-read and re-write the HTML.
 *
 * @param {string} html - Assembled HTML output
 * @param {string} appCode - The original app.jsx source (for color extraction)
 * @returns {string} Patched HTML
 */
export function patchAppBackground(html, appCode) {
  const rootMatch = appCode.match(/:root\s*\{([^}]+)\}/);
  let bgColor = '';
  if (rootMatch) {
    const bgMatch = rootMatch[1].match(/--color-background\s*:\s*([^;]+)/);
    if (bgMatch) bgColor = bgMatch[1].trim();
  }
  if (!bgColor) {
    const bodyBgMatch = appCode.match(/body\s*\{[^}]*background\s*:\s*([^;]+)/);
    if (bodyBgMatch) bgColor = bodyBgMatch[1].trim();
  }

  // Reject characters that could break out of CSS value or HTML context.
  if (bgColor && /[;{}<>"']/.test(bgColor)) {
    console.warn(`[assembly] Rejected suspicious bgColor value: ${bgColor.slice(0, 50)}`);
    bgColor = '';
  }
  const bg = bgColor || 'inherit';

  const headPatch = `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <style>
      #container { padding: 10px !important; }
      body::before { background-color: ${bg} !important; }
    </style>`;
  html = html.replace('</head>', headPatch + '\n</head>');

  const bodyPatch = `<style>
      div[style*="z-index: 10"][style*="position: fixed"] { background: ${bg} !important; }
    </style>`;
  html = html.replace('</body>', bodyPatch + '\n</body>');

  return html;
}

/**
 * Strip the OIDC dynamic import block from assembled HTML for eval-mode.
 * Removes the `if (hasOidc && !config.public) { try { ... } catch { ... } }` block
 * inside initApp() to prevent network requests to the OIDC authority.
 * The eval-shim.js sets window.useUser before initApp() runs, so the
 * fallback `if (!window.useUser)` becomes a safe no-op.
 *
 * This regex is coupled to the current template structure in template.delta.html (lines 432-453).
 * If the template's OIDC block is refactored, this regex must be updated.
 * The regex anchors on __OIDC_LOAD_ERROR__ which is unique to the OIDC catch block.
 */
export function stripOidcImportBlock(html) {
  const oidcBlockPattern = /if\s*\(hasOidc\s*&&\s*!config\.public\)\s*\{[\s\S]*?window\.__OIDC_LOAD_ERROR__[\s\S]*?\}\s*\}/;
  return html.replace(oidcBlockPattern, '// [eval-mode] OIDC import stripped');
}
