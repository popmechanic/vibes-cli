# Immediate Edit Transition with Live Preview

## Problem

When a user submits a prompt to generate an app, they wait 2-3 minutes staring at the generate screen. The recent addition of theme thumbnails has pushed content below the fold, clipping the headline. The progress bar sits at the bottom of a crowded page. The experience is boring and broken.

## Design

Two changes that work together:

1. **Immediate transition** — switch to the edit view the moment the user submits, rather than waiting for generation to complete
2. **Live preview** — show the app taking shape progressively as Claude writes code, using the existing (but unwired) HMR infrastructure

### Phase Transition on Submit

When the user clicks Generate, the editor immediately calls `setPhase('edit')` and shows the edit layout (chat + preview split). The chat area displays the user's prompt as the first message with a compact progress indicator below it (stage text + progress bar). The generate screen (prompt field, themes carousel, ideas grid) is no longer visible during generation.

This eliminates the layout clipping problem and puts the user in the environment where they'll spend the rest of their session.

**State tracking:** Introduce an `isGenerating` boolean flag (separate from `currentPhase`) to distinguish "first generation in edit phase" from "normal chat edit in edit phase." This flag is set `true` at submit time and `false` when `app_updated` fires. The WebSocket `status` handler uses `isGenerating` (not `currentPhase`) to route progress messages to both the preview overlay and the chat thinking indicator.

**`app_updated` handler changes:** After the early transition, `currentPhase` is already `'edit'` when `app_updated` fires. The handler's `if (currentPhase === 'generate')` branch no longer triggers, so `autoSaveApp()` and `loadPreview()` must move. On `app_updated`: clear `isGenerating`, call `autoSaveApp()`, call `reloadPreview()` for the final post-processed version (after `sanitizeAppJsx`), and remove the progress overlay.

**Error handling:** If generation fails while in edit phase, show the error as a chat message and dismiss the progress overlay. The `isGenerating` flag resets to `false`. If the user cancels, same behavior — clear overlay, reset flag, show cancellation notice in chat.

### Preview Area States

The preview iframe transitions through three states:

**State 1: Placeholder (before first valid code)**

If a named theme is selected: apply the theme's `:root` CSS variables and grid pattern to the preview area with a centered progress bar overlay. Theme color data is already available in `ctx.themeRootCss` and `ctx.themeColors` server-side. Include the selected theme's `:root` CSS block in the `theme_selected` WebSocket event (or a new `generate_started` event) so the client can render the placeholder without an extra fetch.

If auto/custom theme (no preview data available): show the Vibes DIY logo animation with a progress bar overlay. This is the same loader used elsewhere in the app.

**State 2: Live preview (after first valid write)**

Once Claude writes valid JSX to `app.jsx`, the preview updates to show the partial app. A small "LIVE" badge and subtle progress overlay remain visible so the user knows generation is in progress. Each subsequent valid write updates the preview immediately.

**State 3: Complete (generation done)**

Overlay removed. Preview shows the finished app via a final `reloadPreview()` call (using `frame.src`, not `srcdoc`) to ensure full post-processing.

### Live Preview via HMR

The existing `scripts/server/hmr.ts` module has the complete infrastructure for live preview — Babel validation, debounced file checking, and `broadcast()` integration — but was never wired up. This design connects it.

**Flow:**
1. Claude subprocess writes to `app.jsx` via Write/Edit tool
2. `claude-bridge.ts` emits a `tool_result` event with `_toolName` and `_filePath`
3. The HMR watcher's `onToolResult()` filters for Write/Edit to `app.jsx`
4. `scheduleCheck()` debounces (500ms), then reads `app.jsx` and validates with Babel
5. If valid, assembles HTML via `assembleAppFrame(ctx)` (reads from disk — same file Claude just wrote)
6. Broadcasts `{ type: 'hmr_update', html }` to all WebSocket clients
7. Editor receives the message and updates the preview iframe

**Iframe update strategy:** Use `frame.src` with a blob URL (`URL.createObjectURL(new Blob([html], {type: 'text/html'}))`) rather than `srcdoc`. This preserves the iframe's same-origin access to `localStorage`, which generated apps depend on (e.g., `useVibesTheme()` stores theme in `localStorage`). Revoke previous blob URLs to prevent memory leaks.

Updates happen on every valid write (typically 2-5 during a generation). Invalid or partial JSX is silently skipped — the preview holds its last valid state.

**`assembleAppFrame` note:** The existing function reads `app.jsx` from disk internally (no code parameter). The HMR watcher validates the file then calls `assembleAppFrame(ctx)` which re-reads from disk. This double-read is acceptable — the file is stable on disk between the two reads (Claude's next write is gated by a tool_result response). If this proves problematic, `assembleAppFrame` can be extended with an optional `code` parameter.

**Event interception:** The `onEvent` callback passed to `runOneShot()` in generate.ts and chat.ts is the interception point. Wrap `onEvent` before passing it to `runOneShot()` to intercept `tool_result` events and forward them to `hmrWatcher.onToolResult(event)`. This must happen before `translateEvent()` strips `_toolName` and `_filePath` fields.

**Watcher lifecycle:** Call `watcher.start()` when a generate or chat request begins. Call `watcher.stop()` when the request completes, errors, or is cancelled. Do not leave the watcher polling when idle.

### Progress Display

Progress appears in **two places** during generation:

1. **Preview overlay** — centered progress bar + stage text on top of the placeholder/live preview
2. **Chat area** — compact status line below the user's prompt message ("Writing changes... 45%")

The WebSocket `status` handler checks `isGenerating` to route progress to both locations simultaneously. When `isGenerating` is false, progress routes only to the chat thinking indicator (existing behavior for chat edits).

## Files to Modify

| File | Change |
|------|--------|
| `skills/vibes/templates/editor.html` | Add `isGenerating` flag; move `setPhase('edit')` to `startGenerate()`; add preview placeholder (themed or logo); add `hmr_update` WebSocket handler with blob URL iframe update; add progress overlay in preview; route progress via `isGenerating`; update `app_updated`/error/cancel handlers for early transition; add compact progress in chat during generation |
| `scripts/server/hmr.ts` | Export watcher factory; verify `isRenderable()` handles typical generation output; ensure start/stop lifecycle works |
| `scripts/server/handlers/generate.ts` | Wrap `onEvent` to intercept `tool_result` events and forward to HMR watcher; include theme CSS in generate response or new event; call `watcher.start()` at request start, `watcher.stop()` at completion |
| `scripts/server/handlers/chat.ts` | Same `onEvent` wrapper pattern for chat edits |
| `scripts/server.ts` or `scripts/server/ws.ts` | Instantiate HMR watcher (editor mode only); expose watcher reference for handlers |

## Out of Scope

- Streaming Claude's text response into the preview (rejected during brainstorming)
- Full HMR with React state preservation (this is iframe replacement, not true HMR)
- Changes to the generate screen layout itself (it's no longer visible during generation)
- Theme carousel or ideas grid modifications
