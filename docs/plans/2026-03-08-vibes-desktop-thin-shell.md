# Vibes Desktop — Thin Native Shell Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current vibes-desktop (parallel UI reimplementation) with a thin ElectroBun shell that embeds the existing web editor, sharing the server and all UI code.

**Architecture:** The desktop app starts `scripts/server.ts` programmatically, opens a BrowserWindow pointing to `http://localhost:3333`, and adds a thin RPC layer for native-only features (menus, tray, file dialogs, notifications). The editor.html, WebSocket protocol, Claude bridge, and all handlers are reused — zero duplication.

**Tech Stack:** ElectroBun (Bun + system webview), existing `scripts/server.ts`, existing `skills/vibes/templates/editor.html`

**Branch:** `desktop` (inside the `vibes-skill` repo, subdirectory `vibes-desktop/`)

---

## Context: Why This Replaces the Previous Approach

The previous implementation built a parallel React/TypeScript UI with 10 components, a full RPC schema (17 requests, 11 messages), 4 handler files, a second Claude bridge, and a second preview server — all reimplementing what `scripts/server.ts` + `editor.html` already do.

The new approach: **embed the existing editor in a native window**. The desktop app becomes ~200 lines of ElectroBun shell code. Both platforms share one codebase.

What the desktop RPC handles (native-only):
- `openFileDialog` — native file picker (returns paths)
- `showNotification` — OS notification when background task completes
- `setTrayStatus` — update system tray tooltip
- `menuAction` — forward native menu clicks to the webview

What the desktop RPC does NOT handle (WebSocket handles these):
- generate, chat, theme switch, deploy, cancel, save app, load app, etc.

---

## Task 1: Refactor `scripts/server.ts` — Export `startServer()`

**Files:**
- Modify: `scripts/server.ts`

**Context:** Currently `server.ts` calls `start()` at module scope (line 97), making it impossible to import without side effects. We need a programmatic API that ElectroBun can call, while keeping CLI behavior when run directly.

**Step 1: Extract `startServer()` as a named export**

Replace the current structure with:

```typescript
/**
 * Live Preview Server — Bun-native
 *
 * HTTP server serves preview.html, app.jsx, and theme catalog.
 * WebSocket server bridges chat messages and theme switches to claude.
 *
 * Modes:
 *   --mode=preview  (default) Serves preview.html for terminal-based iteration
 *   --mode=editor   Serves editor.html with setup wizard, generation, and deploy
 *
 * Usage: bun scripts/server.ts [--port 3333] [--mode=editor]
 *
 * Programmatic: import { startServer } from './server.ts';
 *               const { server, ctx } = await startServer({ mode: 'editor', port: 3333 });
 */

if (typeof Bun === 'undefined') { console.error('This server requires Bun. Install from https://bun.sh'); process.exit(1); }

import { loadConfig, type ServerContext } from './server/config.ts';
import { createRouter } from './server/router.ts';
import { createWsHandler, type WsData } from './server/ws.ts';
import { killProcessOnPort, waitForPort } from './server/lifecycle.ts';
import { cancelCurrent } from './server/claude-bridge.ts';

export interface StartServerOptions {
  port?: number;
  mode?: 'preview' | 'editor';
  prompt?: string;
  /** If true, skip process-level signal handlers (caller manages lifecycle) */
  managed?: boolean;
}

export interface StartServerResult {
  server: ReturnType<typeof Bun.serve>;
  ctx: ServerContext;
  shutdown: () => void;
}

export async function startServer(options?: StartServerOptions): Promise<StartServerResult> {
  // Inject options into process.argv so loadConfig() picks them up
  // (loadConfig reads from process.argv — we prepend our overrides)
  const origArgv = [...process.argv];
  if (options?.port) {
    process.argv.push('--port', String(options.port));
  }
  if (options?.mode) {
    process.argv.push(`--mode=${options.mode}`);
  }
  if (options?.prompt) {
    process.argv.push('--prompt', options.prompt);
  }

  const ctx = loadConfig();

  // Restore original argv
  process.argv = origArgv;

  const router = createRouter(ctx);
  const wsHandler = createWsHandler(ctx);

  if (await killProcessOnPort(ctx.port)) {
    console.log(`Port ${ctx.port} in use — taking over from previous server...`);
    await waitForPort(ctx.port);
  }

  const server = Bun.serve<WsData>({
    port: ctx.port,
    idleTimeout: 255,

    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/ws' || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const upgraded = srv.upgrade(req, { data: { ctx, onEvent: () => {} } });
        if (upgraded) return undefined as any;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return router(req, url);
    },

    websocket: wsHandler,
  });

  let shuttingDown = false;
  const shutdownFn = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cancelCurrent();
    server.stop(true);
  };

  // Only install signal handlers if not managed by caller
  if (!options?.managed) {
    process.on('uncaughtException', (err) => {
      console.error('[Process] Uncaught exception:', err);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      console.error('[Process] Unhandled rejection:', reason);
    });
    process.on('SIGINT', () => { shutdownFn(); setTimeout(() => process.exit(0), 1000); });
    process.on('SIGTERM', () => { shutdownFn(); setTimeout(() => process.exit(0), 1000); });
  }

  const modeLabel = ctx.mode === 'editor' ? 'Editor' : 'Preview';
  console.log(`\nVibes ${modeLabel} Server`);
  console.log(`  Open:   http://localhost:${ctx.port}`);
  console.log(`  Mode:   ${modeLabel}`);
  console.log(`  Themes: ${ctx.themes.length} loaded`);
  console.log(`  Anims:  ${ctx.animations.length} loaded`);
  if (!options?.managed) console.log(`  Press Ctrl+C to stop\n`);

  return { server, ctx, shutdown: shutdownFn };
}

// --- CLI entry point ---
if (import.meta.main) {
  startServer();
}
```

Key changes:
- `startServer(options?)` is a named export returning `{ server, ctx, shutdown }`
- Options override process.argv temporarily so `loadConfig()` picks them up
- `managed: true` skips signal handlers (ElectroBun manages lifecycle)
- `import.meta.main` guard keeps CLI behavior when run directly
- Existing behavior is 100% preserved for CLI usage

**Step 2: Verify CLI still works**

```bash
bun scripts/server.ts --mode=editor
```

Expected: Server starts on port 3333 exactly as before.

**Step 3: Verify import works**

```bash
bun -e "import { startServer } from './scripts/server.ts'; const { server, ctx } = await startServer({ mode: 'editor', port: 3334, managed: true }); console.log('OK', ctx.port); server.stop();"
```

Expected: Prints `OK 3334` and exits cleanly.

**Step 4: Run existing tests**

```bash
cd scripts && npm test
```

Expected: All tests pass (this change doesn't affect test-covered code).

**Step 5: Commit**

```bash
git add scripts/server.ts
git commit -m "refactor: export startServer() from server.ts for programmatic use"
```

---

## Task 2: Delete the Parallel UI — Clean Slate

**Files:**
- Delete: `vibes-desktop/src/mainview/components/*.tsx` (all 10 components)
- Delete: `vibes-desktop/src/mainview/hooks/useRPC.ts`
- Delete: `vibes-desktop/src/mainview/App.tsx`
- Delete: `vibes-desktop/src/mainview/main.tsx`
- Delete: `vibes-desktop/src/mainview/rpc.ts`
- Delete: `vibes-desktop/src/mainview/index.css`
- Delete: `vibes-desktop/src/mainview/index.html`
- Delete: `vibes-desktop/src/bun/handlers/*.ts` (all 4 handlers)
- Delete: `vibes-desktop/src/bun/claude-manager.ts`
- Delete: `vibes-desktop/src/bun/config.ts`
- Delete: `vibes-desktop/src/bun/preview-server.ts`
- Delete: `vibes-desktop/src/bun/__tests__/*.ts` (all 3 test files)
- Delete: `vibes-desktop/src/shared/rpc-types.ts`
- Delete: `vibes-desktop/vite.config.ts`
- Delete: `vibes-desktop/tailwind.config.js`
- Delete: `vibes-desktop/postcss.config.js`

**Context:** All of this code reimplements what `scripts/server.ts` + `editor.html` already do. Delete it all. We'll replace it with ~200 lines.

**Step 1: Delete all parallel UI and bridge code**

```bash
cd vibes-desktop
rm -rf src/mainview src/bun/handlers src/bun/__tests__
rm -f src/bun/claude-manager.ts src/bun/config.ts src/bun/preview-server.ts
rm -f src/shared/rpc-types.ts
rm -f vite.config.ts tailwind.config.js postcss.config.js
```

**Step 2: Remove React/Vite/Tailwind dependencies from package.json**

Edit `vibes-desktop/package.json` — remove these devDependencies:
- `react`, `react-dom`, `@types/react`, `@types/react-dom`
- `vite`, `@vitejs/plugin-react`
- `tailwindcss`, `postcss`, `autoprefixer`

Keep: `electrobun`, `typescript`, `@types/bun`

Also remove the `dev:hmr` script (Vite dev server) and the `test` script if it references deleted files. Simplify scripts to just:

```json
{
  "scripts": {
    "dev": "bunx electrobun dev",
    "build": "bunx electrobun build --env=stable"
  }
}
```

**Step 3: Simplify `electrobun.config.ts`**

Remove the Vite dist copy and watchIgnore. The app no longer needs to build a local webview — it loads an HTTP URL:

```typescript
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Vibes Editor",
    identifier: "com.vibes.desktop-editor",
    version: "0.1.0",
  },
  build: {
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
```

**Step 4: Commit**

```bash
cd /path/to/vibes-skill
git add -A vibes-desktop/
git commit -m "chore: delete parallel UI, keep only ElectroBun shell scaffolding"
```

---

## Task 3: Rewrite `index.ts` as Thin Native Shell

**Files:**
- Rewrite: `vibes-desktop/src/bun/index.ts`
- Keep: `vibes-desktop/src/bun/auth.ts` (cleanup only)
- Keep: `vibes-desktop/src/bun/plugin-discovery.ts` (cleanup only)

**Context:** The new `index.ts` is ~200 lines. It does three things: (1) find the Vibes plugin and start its server, (2) open a BrowserWindow pointing to the server, (3) set up native menus, tray, and notifications.

**Step 1: Rewrite `src/bun/index.ts`**

```typescript
/**
 * Vibes Desktop — Thin native shell
 *
 * Starts the existing Vibes server (scripts/server.ts) and opens it
 * in a native ElectroBun window. RPC is reserved for native-only
 * features: menus, tray, file dialogs, notifications.
 */
import Electrobun, {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  Tray,
  Utils,
} from "electrobun/bun";
import { join } from "path";
import { discoverVibesPlugin } from "./plugin-discovery.ts";
import { resolveClaudePath, CLAUDE_BIN } from "./auth.ts";

// --- Constants ---
const PORT = 3333;
const SERVER_URL = `http://localhost:${PORT}`;

// --- Startup ---
async function main() {
  // 1. Check Claude CLI
  const claudeOk = checkClaude();
  if (!claudeOk) {
    await Utils.showMessageBox({
      type: "error",
      title: "Claude CLI Not Found",
      message: "Vibes Editor requires the Claude CLI.",
      detail: "Install it with: npm install -g @anthropic-ai/claude-code\n\nThen relaunch the app.",
      buttons: ["Quit"],
    });
    Utils.quit();
    return;
  }

  // 2. Find plugin
  const pluginPaths = await discoverVibesPlugin();
  if (!pluginPaths) {
    await Utils.showMessageBox({
      type: "error",
      title: "Vibes Plugin Not Found",
      message: "Could not locate the Vibes plugin.",
      detail: "Make sure the vibes-skill plugin is installed in Claude Code.",
      buttons: ["Quit"],
    });
    Utils.quit();
    return;
  }

  // 3. Start the existing server
  const serverModule = await import(join(pluginPaths.root, "scripts", "server.ts"));
  const { server, ctx, shutdown } = await serverModule.startServer({
    mode: "editor",
    port: PORT,
    managed: true, // We handle lifecycle
  });

  console.log(`[vibes-desktop] Server started at ${SERVER_URL}`);

  // 4. Create window pointing to the server
  const mainWindow = new BrowserWindow({
    title: "Vibes Editor",
    url: SERVER_URL,
    frame: { width: 1280, height: 820 },
  });

  // 5. Native menu
  ApplicationMenu.setApplicationMenu([
    {
      label: "Vibes Editor",
      submenu: [
        { label: "About Vibes Editor", role: "about" },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", role: "undo" },
        { label: "Redo", role: "redo" },
        { type: "separator" },
        { label: "Cut", role: "cut" },
        { label: "Copy", role: "copy" },
        { label: "Paste", role: "paste" },
        { label: "Select All", role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", action: "reload", accelerator: "r" },
        { label: "Developer Tools", action: "devtools", accelerator: "Option+Command+I" },
      ],
    },
  ]);

  // 6. System tray
  const tray = new Tray({ title: "Vibes", template: true, width: 16, height: 16 });
  tray.setMenu([
    { label: "Vibes Editor", enabled: false },
    { type: "separator" },
    { label: "Show Window", action: "show-window" },
    { type: "separator" },
    { label: "Quit", action: "quit-app" },
  ]);
  tray.on("tray-clicked", () => mainWindow.focus());

  // 7. Menu event handler
  Electrobun.events.on("application-menu-clicked", (e) => {
    switch (e.data.action) {
      case "show-window":
        mainWindow.focus();
        break;
      case "quit-app":
        shutdown();
        Utils.quit();
        break;
      case "reload":
        // Reload the webview
        mainWindow.loadURL(SERVER_URL);
        break;
      case "devtools":
        // Toggle dev tools (BrowserView method)
        break;
    }
  });

  // 8. Graceful shutdown
  Electrobun.events.on("before-quit", () => {
    shutdown();
  });

  console.log("[vibes-desktop] App started");
}

function checkClaude(): boolean {
  try {
    const result = Bun.spawnSync([CLAUDE_BIN, "--version"], { timeout: 5000 });
    return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error("[vibes-desktop] Fatal error:", err);
  process.exit(1);
});
```

That's it. ~120 lines. No RPC schema, no handlers, no React, no Claude bridge, no second UI.

**Step 2: Simplify `auth.ts`**

Keep only `resolveClaudePath()` and `CLAUDE_BIN`. Delete `checkClaudeInstalled()`, `checkClaudeAuth()`, `triggerClaudeLogin()`, `checkPocketIdAuth()`, `cleanEnv()` — the server handles all of that.

```typescript
import { existsSync } from "fs";

export function resolveClaudePath(): string {
  for (const flags of ["-lic", "-lc", "-ic"] as const) {
    try {
      const result = Bun.spawnSync(["zsh", flags, "which claude"], { timeout: 5000 });
      const resolved = result.stdout.toString().trim();
      if (resolved && result.exitCode === 0 && !resolved.includes("not found")) {
        return resolved;
      }
    } catch {}
  }

  const home = process.env.HOME || "";
  const candidates = [
    `${home}/.claude/local/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    `${home}/.local/bin/claude`,
    `${home}/.npm-global/bin/claude`,
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return "claude";
}

export const CLAUDE_BIN = resolveClaudePath();
```

**Step 3: Keep `plugin-discovery.ts` as-is**

It already works — finds the plugin root so we can import `scripts/server.ts` from it.

**Step 4: Verify**

```bash
cd vibes-desktop && bunx electrobun dev
```

Expected: App window opens showing the Vibes editor at `http://localhost:3333`. Same editor.html UI as the web version. Theme carousel, gallery, prompt box — all there.

**Step 5: Commit**

```bash
git add vibes-desktop/src/
git commit -m "feat: rewrite desktop as thin native shell embedding existing editor"
```

---

## Task 4: Update `electrobun.config.ts` and `tsconfig.json`

**Files:**
- Modify: `vibes-desktop/electrobun.config.ts` (already done in Task 2 Step 3)
- Modify: `vibes-desktop/tsconfig.json`

**Step 1: Simplify `tsconfig.json`**

Remove React JSX settings and mainview paths:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/bun/**/*.ts"]
}
```

**Step 2: Commit**

```bash
git add vibes-desktop/tsconfig.json vibes-desktop/electrobun.config.ts
git commit -m "chore: simplify config for shell-only architecture"
```

---

## Task 5: Add Desktop Mode Detection to `editor.html` (Optional Enhancement)

**Files:**
- Modify: `skills/vibes/templates/editor.html` (or the delta file)

**Context:** This is optional but enables native file dialogs for drag-and-drop (File.path doesn't exist in system webviews — see gotcha #12 in the Loom Desktop reference). The editor can detect it's running in a native webview and show subtle differences.

**Step 1: Add desktop detection**

Near the top of the editor's `<script>` section, add:

```javascript
// Desktop mode: detect ElectroBun webview
const IS_DESKTOP = typeof window.__electrobun !== 'undefined';
```

This requires no changes to ElectroBun — `window.__electrobun` is set by the Electroview runtime automatically when the page loads in an ElectroBun webview.

**Step 2: (Future) Use detection for native features**

No immediate changes needed. The editor works identically in both contexts because it uses `FileReader` (not `File.path`) and `location.host` for WebSocket discovery. The `IS_DESKTOP` flag is a hook for future enhancements like:
- Native file dialogs instead of `<input type="file">`
- OS notifications when generation completes in background
- Drag-and-drop with native file paths

**Step 3: Commit (if any changes made)**

```bash
git add skills/vibes/templates/editor.html
git commit -m "feat: add desktop mode detection flag to editor.html"
```

---

## Task 6: End-to-End Verification

**Step 1: Clean build**

```bash
cd vibes-desktop
bun install
bunx electrobun dev
```

**Step 2: Verify these work identically to the web editor:**

- [ ] Editor loads with correct theme (cream/beige neo-brutalist aesthetic)
- [ ] Theme carousel shows all themes
- [ ] Gallery section shows category icons
- [ ] Prompt textarea accepts input
- [ ] Cmd+Enter submits prompt
- [ ] Generate creates an app (Claude streams tokens in real-time)
- [ ] Preview iframe shows the generated app
- [ ] Chat editing works (send message, Claude edits, preview refreshes)
- [ ] Theme switching works
- [ ] Save/load apps works
- [ ] Deploy works (Pocket ID auth flow, Cloudflare Workers deploy)
- [ ] Native menus work (Edit > Copy/Paste, View > Reload)
- [ ] System tray icon appears
- [ ] Window close behavior is clean (server stops, process exits)

**Step 3: Test distribution build**

```bash
cd vibes-desktop && bunx electrobun build --env=stable
```

Verify: DMG produced in `artifacts/`. App launches from DMG. Server starts, editor loads.

**Step 4: Final commit**

```bash
git add -A vibes-desktop/
git commit -m "verify: desktop thin shell passes end-to-end testing"
```

---

## Summary: What Changed

| Aspect | Before (parallel UI) | After (thin shell) |
|--------|---------------------|--------------------|
| Lines of code in vibes-desktop | ~6,500 | ~300 |
| React components | 10 | 0 |
| RPC methods | 28 (17 requests + 11 messages) | 0 (native menus only) |
| Claude bridge | Reimplemented | Shared (server.ts) |
| Handler files | 4 | 0 |
| UI codebase | Separate React/Vite | Shared editor.html |
| Feature parity | Partial (dark generic UI) | Complete (same editor) |
| Maintenance burden | Every feature duplicated | One codebase |

## Files Touched Outside vibes-desktop

Only one: `scripts/server.ts` — adding the `startServer()` export. All existing behavior preserved via `import.meta.main` guard.

---

## Appendix: Install Script (`install.sh`)

One idempotent script handles both new users and existing Claude Code users. Host at `https://vibes.diy/install.sh` so the install command is:

```bash
curl -fsSL https://vibes.diy/install.sh | sh
```

### What it does

| User type | Steps executed |
|-----------|---------------|
| No Claude Code | Install Claude Code → authenticate (browser) → add marketplace → install + enable plugin |
| Has Claude Code, not authenticated | Skip install → authenticate (browser) → add marketplace → install + enable plugin |
| Has Claude Code, authenticated | Skip install → skip auth → add marketplace → install + enable plugin |
| Already has plugin installed | Skip everything → confirm ready |

### Script

```bash
#!/bin/bash
set -e

MARKETPLACE_REPO="vibes-diy/vibes-skill"
MARKETPLACE_NAME="vibes-skill"
PLUGIN_NAME="vibes"
PLUGIN_ID="${PLUGIN_NAME}@${MARKETPLACE_NAME}"

echo ""
echo "  Vibes Editor — Install Script"
echo "  =============================="
echo ""

# --- 1. Claude Code ---
if command -v claude &>/dev/null; then
  echo "  [✓] Claude Code already installed ($(claude --version 2>/dev/null || echo 'unknown version'))"
else
  echo "  [ ] Installing Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
  echo "  [✓] Claude Code installed"
fi

# --- 2. Authentication ---
# Check auth by running a trivial command — if it fails, user needs to log in
if claude -p "echo ok" --max-turns 1 &>/dev/null 2>&1; then
  echo "  [✓] Claude Code authenticated"
else
  echo ""
  echo "  Claude Code needs to be authenticated."
  echo "  A browser window will open — sign in with your Anthropic account."
  echo ""
  read -p "  Press Enter to open the browser... "
  claude
  echo ""
  echo "  [✓] Claude Code authenticated"
fi

# --- 3. Marketplace ---
if claude plugin marketplace list 2>/dev/null | grep -q "${MARKETPLACE_NAME}"; then
  echo "  [✓] Vibes marketplace already added"
else
  echo "  [ ] Adding Vibes marketplace..."
  claude plugin marketplace add "${MARKETPLACE_REPO}"
  echo "  [✓] Vibes marketplace added"
fi

# --- 4. Plugin ---
if claude plugin list 2>/dev/null | grep -q "${PLUGIN_ID}"; then
  echo "  [✓] Vibes plugin already installed"
else
  echo "  [ ] Installing Vibes plugin..."
  claude plugin install "${PLUGIN_ID}" --scope user
  echo "  [✓] Vibes plugin installed"
fi

# --- 5. Enable ---
claude plugin enable "${PLUGIN_ID}" --scope user 2>/dev/null || true
echo "  [✓] Vibes plugin enabled"

# --- Done ---
echo ""
echo "  =============================="
echo "  Vibes Editor is ready!"
echo ""
echo "  To use the plugin:    claude"
echo "  To use the desktop app: download from https://vibes.diy/download"
echo ""
```

### Notes

- **Idempotent**: every step checks before acting, safe to run multiple times
- **No sudo required**: Claude Code installs to `~/.claude/`, plugin system is user-scoped
- **One interactive moment**: browser auth (skipped if already authenticated)
- **Auth check**: uses `claude -p "echo ok"` as a lightweight auth probe — fails fast if not logged in
- **The desktop app DMG is separate**: the script sets up the runtime dependencies, the app is a separate download. A future enhancement could auto-download and mount the DMG at the end.
