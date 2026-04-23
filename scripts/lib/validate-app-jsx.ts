/**
 * Parse-check app.jsx using esbuild's transform in JSX mode.
 *
 * Called from the generate flow after each successful Write/Edit tool_result
 * to decide whether to emit preview_reload (file is parseable, iframe can
 * safely refresh) or preview_reload_failed (last-known-good render should
 * stay on screen).
 *
 * Note: this is a syntax-only check. It does not catch React runtime errors,
 * missing globals, or broken prop shapes — the in-browser Babel load in the
 * preview iframe is the final arbiter for those.
 *
 * Uses esbuild (already a dep) rather than Bun.Transpiler so the same code
 * works under Node (tests) and Bun (runtime).
 */

import { readFileSync } from 'fs';
import { transformSync } from 'esbuild';

export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateAppJsx(path: string): ValidateResult {
  try {
    const code = readFileSync(path, 'utf-8');
    transformSync(code, { loader: 'jsx' });
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { ok: false, error: msg.slice(0, 500) };
  }
}
