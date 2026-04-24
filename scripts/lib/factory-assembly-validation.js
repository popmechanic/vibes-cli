/**
 * Factory-assembly validation primitives.
 *
 * Shared between scripts/assemble-factory.js (CLI) and
 * scripts/__tests__/unit/assemble-validation.test.js (unit tests) so
 * the test's assertions stay in lockstep with the real validator's
 * behavior. Previously these were duplicated inline in both files,
 * which let the test's allow-list drift behind the real one.
 *
 * Background: the factory assembler rejects unreplaced `__UPPER_CASE__`
 * placeholders to catch missed substitutions before a broken HTML
 * reaches the Deploy API. Some `__XXX__` patterns are legitimately
 * present post-assembly (runtime globals, user-owned code,
 * deploy-time substitutions applied by deploy-api-factory) and must
 * be allow-listed.
 */

// Placeholders that are legitimately present AFTER assembly. Each entry
// below is accompanied by a note on WHY it's exempt, so future audits
// don't try to prune items that are actually live.
//
// Categories:
// - Build-tool globals (never substituted): __PURE__, __esModule
// - Assembly-time substitutions (listed defensively in case a path misses
//   the replace): __APP_NAME__, __APP_CONFIG__, __WS_URL__, __APP_PUBLIC__,
//   __DEPLOY_API_URL__, __AI_PROXY_URL__, __FACTORY_MODE__, __FACTORY_API_URL__
// - Deploy-time substitutions (filled in by deploy-api-factory, not by
//   assemble-factory.js): __CHECKOUT_URL__, __BILLING_MODE__
// - Runtime window globals the template/app sets itself: __VIBES_CONFIG__,
//   __VIBES_OIDC_TOKEN__, __VIBES_SYNC_STATUS__, __VIBES_SYNC_ERROR__,
//   __VIBES_THEMES__, __VIBES_THEME_PRESETS__, __VIBES_REGISTRY_URL__,
//   __VIBES_CONSOLE_LOG__, __OIDC_LOAD_ERROR__
// - Fireproof-era sharing globals still referenced by the factory template's
//   pre-TinyBase sharing code path (skills/factory/templates/unified.html):
//   __VIBES_SHARED_LEDGER__, __VIBES_LEDGER_MAP__, __VIBES_INVITE_ID__,
//   __VIBES_JOINED__. These exist because the factory skill hasn't migrated
//   to the TinyBase sync model yet. Per .claude/rules/sharing-architecture.md
//   the pre-TinyBase sharing system is deprecated; removing these entries
//   should follow (not precede) removing the factory template code that
//   reads them.
// - Injection markers consumed by the assembler before validation, but
//   listed defensively: __VIBES_APP_CODE__, __ADMIN_CODE__
export const SAFE_PLACEHOLDER_PATTERNS = [
  '__PURE__',
  '__esModule',
  '__APP_CONFIG__',
  '__APP_NAME__',
  '__WS_URL__',
  '__APP_PUBLIC__',
  '__DEPLOY_API_URL__',
  '__AI_PROXY_URL__',
  '__VIBES_CONFIG__',
  '__VIBES_OIDC_TOKEN__',
  '__OIDC_LOAD_ERROR__',
  '__VIBES_SYNC_STATUS__',
  '__VIBES_SYNC_ERROR__',
  '__VIBES_THEMES__',
  '__VIBES_SHARED_LEDGER__',   // factory: Fireproof-era, still referenced by unified.html
  '__VIBES_LEDGER_MAP__',      // factory: Fireproof-era, still referenced by unified.html
  '__VIBES_INVITE_ID__',       // factory: Fireproof-era, still referenced by unified.html
  '__VIBES_THEME_PRESETS__',   // set by source-templates/base/template.html
  '__VIBES_APP_CODE__',
  '__ADMIN_CODE__',
  '__VIBES_REGISTRY_URL__',
  '__VIBES_JOINED__',          // factory + riff template; read by bundles/oidc-bridge.js
  '__VIBES_CONSOLE_LOG__',
  '__FACTORY_MODE__',
  '__FACTORY_API_URL__',
  '__CHECKOUT_URL__',
  '__BILLING_MODE__'
];

/**
 * Validate a factory template BEFORE app/admin code injection.
 * Returns an array of error strings; empty array means valid.
 */
export function validateFactoryTemplate(html) {
  const errors = [];

  const allMatches = html.match(/__[A-Z_]+__/g) || [];
  const unreplaced = allMatches.filter(m => !SAFE_PLACEHOLDER_PATTERNS.includes(m));
  if (unreplaced.length > 0) {
    errors.push(`Unreplaced placeholders: ${[...new Set(unreplaced)].join(', ')}`);
  }

  return errors;
}

/**
 * Validate an assembled factory output (post-injection).
 * Returns an array of error strings; empty array means valid.
 */
export function validateFactoryAssembly(html, app) {
  const errors = [];

  if (!app || app.trim().length === 0) {
    errors.push('App code is empty');
  }

  if (!html.includes('export default function') && !html.includes('function App')) {
    errors.push('No App component found');
  }

  return errors;
}
