# Error Screen Redesign + Deep Link Repair Flow

**Date:** 2026-03-22
**Status:** Approved

## Summary

Redesign the app error boundary to use Vibes design language (editor grid background, chat bubble button styling) and create a one-click repair flow: user clicks "Fix in VibesOS" → desktop app launches → editor opens the app → chat is pre-filled with structured error context for the agent to fix.

## Background

The current `AppErrorBoundary` renders unstyled HTML with a raw stack trace on a black background. End users of deployed apps see this and have no way to act on it. The error screen should guide them back to the editor with enough context for the agent to diagnose and fix the crash.

## Components

### 1. Console Capture (base template)

Inject a ring buffer in `source-templates/base/template.html` as an early `<script>` block (before any other code):

- `window.__VIBES_CONSOLE_LOG__` — array, max 20 entries
- Override `console.log`, `console.warn`, `console.error` — push `{ level, message: String(args), timestamp }` to buffer, call originals
- Skip `console.debug` (too noisy)
- Stringify args with `String(arg)` to keep entries compact

### 2. Error Screen UI (delta templates)

Redesign `AppErrorBoundary.render()` in both `skills/vibes/template.delta.html` and `skills/riff/template.delta.html`.

**Visual design:**
- Full-viewport background: editor grid (`#CCCDC8`, 32px grid, `rgba(255, 255, 255, 0.5)` lines) — "back to the workshop"
- Centered card: cream background, 2px border, 4px brutalist shadow (BrutalistCard pattern)
- Title: "Something went wrong" — `font-size: clamp(2rem, 5vw, 3.5rem)`, `font-weight: 800` (matches `.generate-title`)
- Subtitle: "Don't worry, we can fix it." — lighter weight, muted color
- Error message: monospace pill (compact, readable)
- Primary button: "Fix in VibesOS" — cream bg, 12px radius, blue shadow (chat bubble user style: `4px 4px 0px 0px #009ACE, 4px 4px 0px 2px #1a1a1a`)
- Secondary button: "Try Again" — cream bg, yellow shadow (chat bubble assistant style)
- Tertiary: "or copy error to clipboard" — text link
- Collapsed `<details>`: JS stack trace + React component stack + recent console logs

**Error payload captured:**
- `error.message` — the error string
- `error.stack` — first 5 lines of JS stack trace
- `info.componentStack` — React component tree (from `componentDidCatch`)
- `window.__VIBES_CONSOLE_LOG__` — last 10 entries
- `window.__APP_CONFIG__.appName` — which app crashed

**"Fix in VibesOS" button behavior:**
1. Constructs `vibes://fix?app={name}&error={msg}&stack={stack}&componentStack={cstack}&console={logs}`
2. Each field URL-encoded, total kept under 2KB
3. `window.location.href = url` triggers OS to launch VibesOS
4. Falls back gracefully if no handler registered (OS shows "can't open" dialog — clipboard fallback covers this)

**"Copy to clipboard" fallback:**
Copies a formatted text block with all the error context for manual pasting into the editor chat.

### 3. URL Scheme Registration (ElectroBun)

In `vibes-desktop/electrobun.config.ts`:

```typescript
app: {
  name: "VibesOS",
  identifier: "com.vibes.os",
  version: "0.1.98",
  urlSchemes: ["vibes"],
}
```

ElectroBun generates `CFBundleURLTypes` in `Info.plist` automatically. The scheme is registered when the app is installed/first launched.

### 4. Protocol Handler (desktop app)

In `vibes-desktop/src/bun/index.ts`, listen for incoming URLs:

```typescript
Electrobun.events.on("open-url", (e) => {
  const url = new URL(e.data.url);
  if (url.protocol === "vibes:" && url.hostname === "fix") {
    const payload = {
      app: url.searchParams.get("app"),
      error: url.searchParams.get("error"),
      stack: url.searchParams.get("stack"),
      componentStack: url.searchParams.get("componentStack"),
      console: url.searchParams.get("console"),
    };
    // Send to editor via WebSocket
    sendToEditor({ type: "fix_error", ...payload });
  }
});
```

If the editor isn't open, launch it first, then send the payload once connected.

### 5. Editor Integration

In `skills/vibes/templates/editor.html`, handle the `fix_error` WebSocket message:

1. Switch to the app: `switch_app` with the app name
2. Set phase to edit (not generate)
3. Pre-fill chat input with structured repair prompt:

```
My app crashed with this error:

Error: useStore is not defined

Component: at ResetGame > at App > at AppErrorBoundary

Recent console:
[vibes] App error: ReferenceError: useStore is not defined

Please fix this.
```

4. Do NOT auto-send — let the user review and optionally add context before hitting enter

### 6. Routing

The path is explicit and unambiguous:

1. **Error screen** (deployed app in any browser) → constructs `vibes://fix?...` URL
2. **macOS** → routes to VibesOS desktop app (registered via `CFBundleURLTypes`)
3. **Desktop app** → `open-url` event handler parses payload
4. **Desktop app** → checks `~/.vibes/apps/{appName}/app.jsx` exists, shows error if not
5. **Desktop app** → sends `fix_error` to editor WebSocket
6. **Editor** → switches to app, pre-fills chat

For users without the desktop app: clipboard fallback.

## Files Modified

| File | Change |
|------|--------|
| `source-templates/base/template.html` | Console capture ring buffer |
| `skills/vibes/template.delta.html` | Redesigned AppErrorBoundary render |
| `skills/riff/template.delta.html` | Same AppErrorBoundary changes |
| `vibes-desktop/electrobun.config.ts` | Add `urlSchemes: ["vibes"]` |
| `vibes-desktop/src/bun/index.ts` | Handle `open-url` event, parse payload, send to editor |
| `skills/vibes/templates/editor.html` | Handle `fix_error` message: switch app, pre-fill chat |
| `build/vibes-menu.js` | Regenerated |
| `skills/*/templates/index.html` | Regenerated |

## Mockup

Visual mockup at `.superpowers/brainstorm/81398-1774223012/error-screen-v2.html`
