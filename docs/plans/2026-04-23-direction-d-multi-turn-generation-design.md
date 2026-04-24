# Direction D: Prompt-Driven Multi-Turn Generation

**Date:** 2026-04-23
**Status:** Design — pending user review
**Related PR (shipped):** [#68](https://github.com/popmechanic/VibesOS/pull/68) — raise output-token floor and instrument `max_tokens`

---

> ## Status update — post-PR [#73](https://github.com/popmechanic/VibesOS/pull/73) / [#75](https://github.com/popmechanic/VibesOS/pull/75)
>
> This document describes a design where the staged-preview events
> (`generation_stage`, `preview_reload`, `reference_preview`) are emitted from
> `scripts/server/handlers/generate.ts::handleGenerate` via `runOneShot` /
> `dispatchStreamEvent`. **That is not where they live in production.**
>
> After [#73](https://github.com/popmechanic/VibesOS/pull/73), the editor
> generate flow runs through the **persistent bridge**
> (`scripts/server/claude-bridge.ts::createBridge`), dispatched from
> `scripts/server/ws.ts` at `case 'generate':`. The bridge emits the staged
> preview events via `translateStreamEvent`, gated by
> `turnMode === 'generate'`. `handleGenerate` was removed in
> [#75](https://github.com/popmechanic/VibesOS/pull/75); only
> `assembleAppFrame` survives in `handlers/generate.ts`, used by the
> `/app-frame` route.
>
> The rest of this document — the two-step prompt structure, the event
> protocol, the turn-sequencing rationale — is still accurate. Only the
> implementation surface moved. See `CLAUDE.md` "Generate Flow Routing"
> for the current routing note.

---

## Summary

Vibes OS app generation currently asks Claude to produce a complete React app in a single `Write` tool call. For complex apps (4,000+ lines of JSX/CSS with Canvas, SVG, animations), this reliably exceeds per-turn `max_tokens` limits. Users experience this as the generation hanging or producing a broken file.

This spec proposes splitting generation into **two tool calls** via a prompt-level directive, using Claude Code's native tool-loop. Because each `tool_result` triggers a new assistant turn with a fresh `max_tokens` budget, no harness-level orchestration is required. Every change is a UI-layer change — prompt, bridge events, server routes, editor state.

The work also delivers a **live staged preview** UX: the iframe shows the generation progressing in phases (reference asset → skeleton → complete), turning a black-box wait into a watching-it-build-itself experience.

## Goal

Eliminate `max_tokens` truncation during app generation by producing a visible-but-skeletal app in a first `Write` call, then filling in data/interactions/polish with a second `Edit` call. Along the way, improve perceived speed and generation narrative via staged preview updates.

## Non-goals

- **Not adopting the Anthropic Agent SDK** (`resume: sessionId` / `continue: true`). That abstraction is the idiomatic equivalent of the orchestration we explicitly decided not to build. Vibes OS intentionally stays a UI layer over Claude Code's CLI.
- **Not building a server-side turn orchestrator.** We instruct Claude via the prompt and let Claude Code's native tool loop handle turn progression. This decision follows from the project philosophy: Anthropic's team will out-engineer a single developer on harness innovation, so we do not reinvent what Claude Code already does.
- **Not adding per-turn model selection** (e.g., Sonnet for skeleton, Opus for polish). That's a future optimization, not this work.
- **Not modifying the chat flow.** All changes are isolated to generate-path code.
- **Not adding analytics/telemetry infrastructure.** The success metrics are measured from server logs and user feedback, not a data pipeline.

## Architecture decision: prompt-driven, not orchestrated

During design we explored four approaches:

| Option | Summary | Status |
|---|---|---|
| A — Server-orchestrated subprocesses | Spawn three separate `claude -p` processes | Rejected: loses prompt caching across boundaries |
| B — Pure model-driven in one session | Send one prompt, trust Claude to self-split | Rejected: not a documented pattern, hard to debug |
| C — Hybrid staged persistent session | Persistent bridge with server-sent staged prompts | Rejected as premature: reinvents what `resume: sessionId` provides natively |
| **D — Prompt-driven multi-turn** | Tell Claude in the prompt to use Write→Edit; Claude Code's native tool loop handles turn progression | **Selected** |

The decisive insight: **each `tool_result` in Claude Code triggers a new assistant turn with a fresh `max_tokens` budget.** Multiple tool calls in one "generation" are already multi-turn at the harness level. We don't need to orchestrate — we need to ask for the decomposition.

## Turn structure

Claude is instructed to produce the app in **two tool calls**, in order:

### Step 1 — `Write` app.jsx: visible skeleton

Contents:
- The mandatory `window.__VIBES_THEMES__` and `useVibesTheme()` boilerplate.
- A `<style>` tag containing the `:root` tokens, plus the four theme marker sections (`@theme:tokens`, `@theme:surfaces`, `@theme:motion`, `@theme:decoration`) — markers present even when sections are empty.
- Base layout CSS (grid/flex structure, typography, spacing).
- A functioning component tree with visible elements: header, main content area, whatever structural regions fit the app concept. Components render placeholder/empty states but the layout is real.
- Basic `useState` for local UI state. No TinyBase hooks yet.
- `export default App`.

After Step 1 the preview should look like the final app in colors, typography, and layout — just without data or polish.

### Step 2 — `Edit` app.jsx: data, interactions, and polish

Contents:
- TinyBase hooks (`useRowIds`, `useCell`, `useAddRowCallback`, `useSetCellCallback`, `useDelRowCallback`, `useValue`).
- React event handlers, effects, refs.
- `useApp()` integration, optional `useAI` wiring.
- Canvas 2D or WebGL backgrounds where appropriate.
- Animated SVG illustrations.
- Content inside `@theme:surfaces`, `@theme:motion`, `@theme:decoration` markers (shadows, gradients, `@keyframes`, hover effects, scroll reveals).

After Step 2 the app is complete.

### Why two steps, not three

Three steps (skeleton / data / polish) was initially proposed but rejected for this iteration on token-economy and speed grounds:

- Two steps adds ~15% to wall time over single-Write. Three steps would add ~30%.
- The `max_tokens` budget (64K floor shipped in PR #68, per-turn) is ample for Step 2 even combining data + polish. A full Vibes app is typically 3,000–6,000 output tokens; Step 2's Edit diffs are well within budget.
- A simpler prompt means higher compliance. The drift risk identified during research is minimized with fewer handoffs.
- Claude may naturally split Step 2 into multiple `Edit` tool calls anyway. Each of those fires a `preview_reload` event (see Section on Bridge plumbing), so the user may see 3–5 preview refreshes even though we only prescribe 2 steps.

### Why the theme markers live in Step 1

Drift on colors/typography between turns is the highest-quality risk. Locking the `:root` tokens and marker scaffold in Step 1 means Step 2's `Edit` tool can only modify the content *inside* marker sections — it cannot accidentally rewrite the color palette.

This reuses proven infrastructure: the existing multi-pass theme switcher (`buildThemePromptMultiPass` in `scripts/server/prompt-builders.ts`) already uses `@theme:*` markers for scoped edits.

## Prompt rewrite

### Structural shape

The existing single-Write prompt ends with `=== WRITE app.jsx ===` followed by rules. That section is replaced with an explicit two-step protocol:

```
=== BUILD app.jsx IN TWO TOOL CALLS ===

Build this app in two separate tool calls, in order. Each step has a
specific purpose; do not try to do everything in one call.

STEP 1 — Write app.jsx: the visible skeleton.
  (Step 1 content per the Turn Structure section above)

STEP 2 — Edit app.jsx: data, interactions, and polish.
  (Step 2 content per the Turn Structure section above)

=== RULES THAT APPLY TO ALL STEPS ===
  (The existing cross-cutting rules: no imports, no TypeScript,
   no CSS unicode escapes, Tailwind mobile-first, `className="btn"`,
   `className="grid-background"` on root, TinyBase hooks as globals,
   `export default App`.)
```

### What moves and what stays

- **The `<design>` preamble is removed** for the non-reference path (already trimmed in PR #68). Design decisions now live inside CSS comments in Step 1's `<style>` tag.
- **Reference-path image/HTML extraction stays in Step 1**. Claude reads the reference once, extracts tokens, applies them in the Write.
- **`useAI` instructions** stay appended at the global level (unchanged). Claude places them naturally in Step 2's data-layer work.
- **`THEME_SECTION_MARKERS`** stays in the overall prompt context — all steps need to understand markers.

### DRY refactor

The reference and non-reference prompt templates currently duplicate ~60–70% of their content. This work extracts the identical blocks as named constants to eliminate drift risk:

- `USE_VIBES_THEME_TEMPLATE(themeId, themeName)` — returns the `useVibesTheme` JSX block for a given theme id/name.
- `TWO_STEP_INSTRUCTIONS` — the `=== BUILD app.jsx IN TWO TOOL CALLS ===` section.
- `GLOBAL_STEP_RULES` — the `=== RULES THAT APPLY TO ALL STEPS ===` block.
- `DESIGN_REASONING_SECTION(isReference)` — the bullets, parameterized by path.

Both templates then compose as: header + theme-source-section + `${USE_VIBES_THEME_TEMPLATE(...)}` + `${TWO_STEP_INSTRUCTIONS}` + `${GLOBAL_STEP_RULES}` + tail.

Full composition (rebuilding prompts from building-block functions) was considered and rejected — the theme-source sections genuinely differ (file-derived vs. reference-derived) and forcing unified composition there is harder to read than two literal templates that share constants.

Acceptance criterion: a unit test asserts both built prompts contain `TWO_STEP_INSTRUCTIONS` and `GLOBAL_STEP_RULES`, guarding against future re-duplication.

## Bridge + UI plumbing

Three new bridge event types, one new server route, a simple UI state machine. No stream-json protocol changes; everything rides on the existing `onEvent` channel.

### New bridge events

**1. `reference_preview`** — emitted once at the start of a reference-path generation, before any tool calls.

```ts
{ type: 'reference_preview', src: '/reference-frame?name=<filename>&kind=html|image' }
```

Emitted from `handleGenerate` when `result.isReference` is known, right before `runOneShot` is called. The UI swaps the iframe src to the provided URL.

**2. `preview_reload`** — emitted after each successful `Write` or `Edit` `tool_result`.

```ts
{ type: 'preview_reload' }
```

Emitted from inside `runOneShot`'s stream parser, in the existing `event.type === 'tool_result'` branch, when `!event.is_error` and the corresponding `pendingTools` entry was `Write` or `Edit`. Emission is gated by the JSX validator (below) — a failed validation emits `preview_reload_failed` instead.

**3. `preview_reload_failed`** — emitted when the post-write JSX syntax check fails.

```ts
{ type: 'preview_reload_failed', stage: 'foundation' | 'interactions', error: string }
```

Uses `Bun.Transpiler` in JSX mode as a parse-only syntax check:

```ts
function validateAppJsx(path: string): { ok: true } | { ok: false; error: string } {
  try {
    new Bun.Transpiler({ loader: 'jsx' }).transformSync(readFileSync(path, 'utf-8'));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 500) };
  }
}
```

On failure: the UI does not cache-bust the iframe (last-known-good render stays visible). Overlay flips to a non-fatal error state. Generation continues; a subsequent successful `preview_reload` is treated as recovery.

**4. `generation_stage`** — emitted on stage transitions, drives the overlay copy.

```ts
{ type: 'generation_stage', stage: 'reading_reference' | 'foundation' | 'interactions' | 'complete' }
```

Emission points:

- `handleGenerate` → emits `reading_reference` for reference paths, or `foundation` for non-reference paths, right before `runOneShot`.
- `runOneShot` → tracks a `toolUseSeen` counter. On the first `tool_use` with name `Write` or `Edit`, if the current stage is still `reading_reference`, advance to `foundation`. On the second such `tool_use`, advance to `interactions`. Tool uses for `Read` do not advance the counter — they are setup for the upcoming edit, not a step boundary.
- `complete` is signaled by the existing `complete` event (no separate stage event).

### Complete event gains a field

```ts
{ type: 'complete', ..., appJsxValid: boolean }
```

If `false`, the UI shows a persistent error with a Retry action. Today's silent-hang mode becomes a clean failure signal.

### New server route: `/reference-frame`

Serves the reference asset inside an iframe-friendly wrapper.

- `GET /reference-frame?name=<filename>&kind=html` — reads the file from the known reference upload location (`.vibes-tmp/` or the app dir), returns it with `Content-Type: text/html`.
- `GET /reference-frame?name=<filename>&kind=image` — wraps the image in a minimal HTML shell (black background, image centered with `max-width:100%; max-height:100vh; object-fit:contain`).

Security: `name` is validated to match a file inside the known reference directory — no path traversal.

### UI state contract

The editor holds two pieces of state during generation:

- `currentStage` — drives the overlay text.
- `iframeSrc` — `/app-frame` by default, `/reference-frame?...` when a reference preview is active.

Event handlers:

- `reference_preview` → set `iframeSrc` to the provided src.
- First `preview_reload` after a reference preview → set `iframeSrc` back to `/app-frame`.
- Every `preview_reload` → cache-bust the iframe (`?t=${Date.now()}`).
- `generation_stage` → set `currentStage`.
- `preview_reload_failed` → do not cache-bust; overlay flips to non-fatal error state.
- `complete` → clear overlay; check `appJsxValid` and surface persistent error if false.

### Overlay spec

Positioned over the preview iframe, semi-transparent so the preview is still visible. Copy:

| Stage | Copy |
|---|---|
| `reading_reference` | Analyzing reference — extracting design... |
| `foundation` | Step 1 of 2 — Foundation |
| `interactions` | Step 2 of 2 — Building interactions and polish |
| (complete) | (overlay dismisses) |
| `preview_reload_failed` during `foundation` | Step 1 produced a syntax error — waiting for retry... |
| `preview_reload_failed` during `interactions` | Step 2 produced a syntax error — continuing... |

The overlay has `pointer-events: auto` until `complete`, absorbing clicks so users cannot interact with a partially-wired skeleton and mistake broken state for a bug.

## Config changes

All changes to the two `runOneShot` call sites in `scripts/server/handlers/generate.ts`.

### Tools allowlist

All three paths converge to the same allowlist. Read is load-bearing — Claude Code requires the file be read in the conversation before it can be edited.

| Path | Current | New |
|---|---|---|
| Non-reference | `'Write'` | `'Write,Edit,Read'` |
| HTML ref | `'Write'` | `'Write,Edit,Read'` |
| Image ref | `'Write,Read'` | `'Write,Edit,Read'` |

Because all paths converge, the conditional in `handleGenerate` simplifies to a single `tools` value.

### max-turns

Calibrated to absorb multiple Edits within Step 2:

| Path | Current | New |
|---|---|---|
| Non-reference | 5 | 10 |
| HTML ref | 5 | 10 |
| Image ref | 8 | 12 |

### Unchanged

- Model selection — still chosen once, applies across the session.
- Permission mode — `buildClaudeArgs` defaults to `bypassPermissions` when `tools` is set.
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` — the 64K floor from PR #68 applies per turn. Each step gets its own ceiling.
- Extended thinking — Claude Code's adaptive default stays. Tuning this is out of scope.

## Reference-path compatibility

Most reference-path UX is handled by the bridge + UI plumbing. Remaining clarifications:

### Where extraction happens

Image and HTML analysis happens **inside Step 1**, not as a separate phase. The prompt tells Claude to apply extraction directly to the written code rather than producing narrative prose (this directive shipped in PR #68). Step 1 takes ~2–3 extra seconds for reference paths, but produces the same kind of artifact — a visible skeleton with correct theme tokens.

### Step 2 does not re-read the reference

Step 2's prompt for reference paths is identical to the non-reference Step 2 prompt. The reference's visual language is already baked into Step 1's Write; re-reading the image would be a token drain for no design benefit. Tools allowlist includes Read, so Claude *could* re-read if needed, but we do not prompt for it.

### Text-file references with `intent=seed`

The row-seeding logic belongs in Step 2 (data layer), not Step 1. The text content is in the initial prompt (amortized by cache after turn 1), so Step 2 sees it without a re-Read. If testing shows Claude placing seeding logic in Step 1, we add a short line to Step 2's instructions.

### Theme event emissions unchanged

`theme_selected` still fires before generation starts, carrying `themeId: 'custom-ref'` for reference paths. No downstream changes needed.

### Parallel prompts handled by DRY extraction

The two prompt templates (reference and non-reference) share `TWO_STEP_INSTRUCTIONS` and `GLOBAL_STEP_RULES` via constants — guarded by a regression test.

## Rollout

### Release approach

**Hard cutover with `git revert` as the back-out story.**

- Ship the 2-step prompt as the only path. No opt-in flag.
- Version bump to **0.3.0** (currently 0.2.15). Per `CLAUDE.md`, bump both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- The shipped instrumentation (`[OneShot] hit max_tokens` log, `maxTokensHit` on complete events) gives us telemetry without needing a flag.
- If the release is problematic, `git revert` the PR. The old single-Write prompt stays in history.

### Success metrics

Vibes OS does not currently have aggregated telemetry, so "rate" here is judged from two sources: (1) grepping the developer's own server log bucket for the relevant log lines and tallying hits against total generations during the window, and (2) user feedback cadence (number of "stuck generating" reports per week compared to the pre-release baseline). This is adequate for a single-developer project; an analytics layer is out of scope for this work.

Signal watched for two weeks post-release:

| Signal | Source | Target |
|---|---|---|
| `[OneShot] hit max_tokens` log lines | server logs | <5% of generations |
| `preview_reload_failed` emissions | bridge event log | <10% of generations |
| Two-phase reveal completes (≥2 `preview_reload` events per generation) | bridge event log | >90% of generations — compliance check on the 2-step prompt |
| Generation wall-time (median) | client-side timing, eyeballed | within ±20% of pre-release baseline |
| Quality regressions | user reports | none or minor |
| "Stuck generating" user reports | informal feedback | drops relative to baseline |

The compliance check is the primary leading indicator. If <90% of generations show ≥2 `preview_reload` events, Claude is ignoring the step structure and the prompt needs tightening.

### Back-out criteria

Revert the PR if:

- `preview_reload_failed` rate >25%
- Median generation wall-time grows >40%
- User reports of noticeably worse design quality

The shipped `max_tokens` floor and instrumentation stay regardless — independent improvements.

## Testing

### Unit tests (`scripts/__tests__/unit/`)

- Prompt builder emits `TWO_STEP_INSTRUCTIONS` and `GLOBAL_STEP_RULES` in both reference and non-reference paths (regression guard).
- `buildClaudeArgs` for generate: `--tools Write,Edit,Read` and `--max-turns` at 10/10/12 per path.
- `validateAppJsx` helper: returns `ok: true` for valid JSX, `ok: false` with error for broken JSX.
- Stream parser emits `preview_reload` / `preview_reload_failed` / `generation_stage` events in correct order given a synthetic stream-json fixture.

### Integration

Using existing `scripts/__tests__/integration` plumbing, a mocked multi-turn generation (fake stream-json events) verifies the full event sequence:

```
generation_stage: foundation
 → preview_reload
 → generation_stage: interactions
 → preview_reload
 → complete (appJsxValid: true)
```

### Manual checklist

- Non-reference simple app: verify preview updates twice, overlay progresses correctly.
- Image-reference generation: verify `reference_preview` shows image first, then transitions.
- HTML-reference generation: same but with HTML.
- Text-reference with `intent=seed`: verify seeding logic ends up in Step 2.
- Force a broken Edit (contrived prompt): verify `preview_reload_failed` fires, overlay shows error, next Edit recovers.
- Run `/vibes:test` end-to-end.

## Effort estimate

- Prompt rewrite + DRY refactor: 1–2 hours
- Bridge event additions + JSX validator: 2–3 hours
- UI (reference-frame route, overlay, iframe swap/reload logic): 3–4 hours
- Test updates: 1–2 hours
- Manual test pass: 1–2 hours

**Total: ~10–13 hours** — a focused day or spread across two evenings.

## Open questions / future work

- **Per-turn model selection.** Could ship as a follow-up: Sonnet for skeleton (speed), Opus for polish (richness). Out of scope for this work; needs its own design conversation.
- **Extended thinking tuning.** The adaptive default applies per turn. If `max_tokens` still pressure-tests after this ships, disabling thinking on Step 2 (where the work is mechanical) could reclaim budget.
- **Step 2 truncation mitigation.** If Step 2 itself starts hitting `max_tokens` for the largest apps, the natural next step is to prescribe three steps (splitting data from polish). The instrumentation will tell us.
- **Analytics.** Vibes OS currently lacks aggregated telemetry. Success metrics are measured from logs and feedback. Adding a thin analytics layer is a separate, future project.
