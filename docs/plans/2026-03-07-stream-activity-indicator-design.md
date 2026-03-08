# Stream-Based Activity Indicator

**Date:** 2026-03-07
**Status:** Approved

## Problem

During generation, Claude can be silent on stdout for 60-120s while the model thinks server-side. The current silence-based timer shows alarming "No activity for Xs — click Cancel to retry" messages that prompt users to cancel prematurely.

## Solution

Track token output from stream-json events and display a live count in the stage text, proving Claude is alive even during long operations.

## Changes

### 1. `scripts/lib/claude-subprocess.js`

Add `--include-partial-messages` flag when using `stream-json` format. This produces more granular events during thinking/generation.

### 2. `scripts/server/claude-bridge.js`

Three changes:

- Add a `tokenChars` counter that accumulates character count from all `text_delta` events
- Format as `~Xk tokens` (estimate ~4 chars/token, round to 0.1k)
- Replace silence-based stage overrides with token-aware messages:
  - During silence WITH accumulated tokens: `"Designing layout • ~1.2k tokens"` (keeps last tool-based stage, appends token count)
  - During silence with ZERO tokens and zero tools: `"Starting up…"` (early startup)
  - Hard kill at 300s unchanged (genuine safety net)

### 3. Stage text format

`"{phase} • ~{N}k tokens"` where phase comes from the existing `calcProgress()` stage logic. The `•` separator and token count only appear once `tokenChars > 0`.

## What doesn't change

- Progress bar percentage (exponential time curve + tool milestones)
- Cancel button (always available)
- Elapsed timer
- Hard kill at 300s
- Tool detail events forwarded to client

## Edge case: truly zero events

If no stream events arrive at all for 120s (network issue, stuck process), fall back to `"Waiting for response…"` — without alarming "click Cancel" language.
