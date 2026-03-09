# Vibes Desktop Editor — Design Document

**Date:** 2026-03-08
**Status:** Approved

## Overview

A native macOS desktop app built with ElectroBun (Bun + system webview) that
replicates the full Vibes web editor experience. Claude CLI is the runtime — the
Bun process spawns `claude -p` subprocesses and streams output to a React
webview via typed RPC. No HTTP server except a lightweight localhost preview
server.

## Goals

- Full feature parity with the web editor (setup, generate, edit, deploy, app
  management, themes, animations, skills)
- Native macOS experience: system tray, native menus, file drag-and-drop
- Zero server infrastructure for the user — everything runs locally
- Leverage existing vibes plugin for assembly, templates, themes, and animations

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    ElectroBun App (1280x820)                  │
│                                                               │
│  ┌────────────────┐    Typed RPC     ┌─────────────────────┐ │
│  │    Webview      │◄──────────────►│    Bun Process       │ │
│  │    (React)      │                 │                      │ │
│  │                 │  rpc.request    │  Claude Manager      │ │
│  │  Setup Wizard   │──startTask()──►│  (ported bridge)     │ │
│  │  Generate Phase │──abort()──────►│                      │ │
│  │  Edit Phase     │                 │  App Manager         │ │
│  │  Deploy         │◄─rpc.sendProxy │  (save/load/list)    │ │
│  │                 │  .token()       │                      │ │
│  │                 │  .toolUse()     │  Deploy Manager      │ │
│  │                 │  .done()        │  (assemble + deploy) │ │
│  │                 │  .status()      │                      │ │
│  │                 │  .error()       │  Preview Server      │ │
│  └────────────────┘                 │  (HTTP :3333)        │ │
│                                      └──────────┬──────────┘ │
│                                                  │            │
│                                           stdio  │  HTTP      │
│                                                  ▼            │
│                                          ┌──────────┐         │
│                                          │claude -p │         │
│                                          └──────────┘         │
│                                                               │
│                      Plugin discovered from                   │
│                      ~/.claude/plugins/                       │
└──────────────────────────────────────────────────────────────┘
```

### Communication Split

| Channel          | Handles                                                      |
|------------------|--------------------------------------------------------------|
| **RPC**          | All interactive operations: generate, chat, deploy,          |
|                  | save/load, credentials, theme switching, cancel, app gallery |
| **HTTP (:3333)** | Preview iframe (`/app-frame`), static assets (themes, anims) |

### Why Two Channels

The assembled preview HTML must load external scripts (esm.sh, Babel, Fireproof)
which require real HTTP context — `srcdoc` and data URLs break with external
imports. A single lightweight Bun HTTP server on localhost:3333 serves the
preview and static assets. Everything else uses ElectroBun's typed RPC for
compile-time safety and zero fetch boilerplate.

## Setup Wizard

Three-step wizard. Steps 1-2 required before entering the editor. Step 3
deferred until first deploy.

### Step 1: Claude CLI Check

- Run `resolveClaudePath()` at startup (handles macOS GUI PATH issue)
- Verify with `claude --version`
- If missing: show install instructions with link to claude.ai/download
- If found: show version, green checkmark, proceed

### Step 2: Authenticate with Anthropic

- Spawn a lightweight Claude command to check auth validity
- If not authenticated: show "Sign in with Anthropic" button
- Button triggers `claude login` (opens browser for OAuth)
- Poll until auth succeeds, then proceed
- Show account info on success

### Step 3: Pocket ID (Deferred)

- Not shown during initial setup
- Triggered when user first clicks Deploy
- Opens browser for Pocket ID OAuth flow
- Tokens cached at `~/.vibes/auth.json`
- After auth, deploy proceeds automatically

## Editor Phases

### Generate Phase

Full parity with web editor:

- **Prompt input** — Text area with placeholder suggestions
- **Theme carousel** — Horizontal scrollable row of theme cards with color
  previews. Themes loaded from plugin's `skills/vibes/themes/`
- **Design reference upload** — Drag-and-drop or file picker for image/HTML
  reference. Two intents: mood (colors only) vs match (layout + colors)
- **Animation catalog** — Browsable animation effects from plugin's
  `skills/vibes/animations/`
- **App gallery** — Load previously saved apps from `~/.vibes/apps/`

On submit: RPC `generate` request → Claude Manager spawns `claude -p` with
Write-only tools, 5-8 max turns → streams progress/tokens back via RPC →
app.jsx saved to working directory → preview loads in iframe

### Edit Phase

Split-pane layout:

- **Preview pane (left, ~600px)** — iframe loading `http://localhost:3333/app-frame`
  with assembled HTML. Green border flash on update. Version bar with undo/redo.
- **Chat pane (right, ~640px)** — Message history with streaming token display,
  tool use indicators, stage labels. Input composer at bottom.
- **Draggable splitter** — Resize panes by dragging

Chat messages → RPC `chat` request → Claude Manager with Read/Edit/Write/Glob/Grep
tools, 8-16 max turns → streams tokens + tool events → preview auto-refreshes on
file change

### Theme Switching

- Theme carousel accessible from edit phase
- Two modes ported from web editor:
  - Multi-pass (markers): surgical replacements within `/* @theme:tokens */` blocks
  - Legacy (full-file): complete CSS rewrite for apps without markers
- Status broadcast via RPC `themeSelected` message

### Deploy

- Assemble via plugin's `assemble.js` (discovered at plugin path)
- Push assembled HTML to Deploy API with OIDC token
- Pocket ID auth gate: if not authenticated, trigger Step 3 flow inline
- Progress streamed via RPC: assembling → authenticating → deploying → live URL

### App Management

- **Save** — Copy current app.jsx + metadata to `~/.vibes/apps/{name}/`
- **Load** — Browse gallery, select app, copy to working directory
- **Screenshots** — Capture preview for gallery thumbnails
- **Backups** — Throttled (30s cooldown) timestamp-based versions before edits

## Claude Subprocess Management

Ported from `claude-bridge.ts` with RPC adaptation:

- **Operation lock** — Global mutex prevents concurrent Claude runs
- **Progress tracking** — Percentage calculation + stage labels
  ("Thinking...", "Writing code...", "Editing file...")
- **Silence timeout** — Kill subprocess if no stdout for 5 minutes
- **Cancel** — SIGTERM on abort, immediate RPC error message
- **Stream parsing** — `createStreamParser()` with `TextDecoder({ stream: true })`
  for UTF-8 safety across chunk boundaries
- **Post-processing** — CSS unicode escape fixes, redeclared global cleanup

### Event Mapping

| Claude Stream Event        | RPC Message   | UI Effect                    |
|---------------------------|---------------|------------------------------|
| `system` (init)           | `status`      | "Running" indicator          |
| `assistant` (text)        | `token`       | Streaming text in chat       |
| `stream_event` (delta)    | `token`       | Incremental text             |
| `assistant` (tool_use)    | `toolUse`     | Tool indicator in chat       |
| `tool_result`             | `toolResult`  | Tool output summary          |
| `result` (success)        | `done`        | Completion with cost         |
| process crash             | `error`       | Error display                |

### Heartbeat

Status RPC message every 2 seconds with:
- Current state: `spawning | running | thinking | tool_use | idle`
- Elapsed time
- Last activity timestamp

## Plugin Discovery

At startup, the Bun process discovers the vibes plugin:

1. Check `~/.claude/plugins/installed_plugins.json` for vibes plugin entry
2. Resolve plugin path from cache: `~/.claude/plugins/cache/{marketplace}/vibes/`
3. Verify plugin has required files: `skills/vibes/themes/`, `scripts/assemble.js`,
   `source-templates/`, `bundles/`
4. If not found: show "Install Vibes Plugin" screen in setup wizard
5. Cache resolved path for session

Used for:
- Assembly pipeline (`scripts/assemble.js`)
- Theme catalog (`skills/vibes/themes/catalog.txt` + theme files)
- Animation catalog (`skills/vibes/animations/catalog.txt` + anim files)
- Design tokens (`build/design-tokens.css`)
- Template base (`source-templates/base/template.html`)
- Fireproof bundles (`bundles/`)
- Skills discovery (all `skills/*/SKILL.md` frontmatter)

## Window Configuration

- **Default size:** 1280x820
- **Minimum size:** 960x600
- **Resizable:** Yes
- **Title bar:** Native macOS title bar with app name

## Desktop Features

### Native Menu Bar

- **File:** New App, Save, Save As, Load App
- **Edit:** Undo, Redo, Cut, Copy, Paste
- **View:** Toggle Preview, Toggle Chat, Reset Layout
- **App:** Deploy, Change Theme, Settings
- **Model:** Haiku, Sonnet, Opus (radio selection)

### System Tray

- App icon in menu bar during long operations (generate, deploy)
- Tooltip shows current status ("Generating app...", "Deploying...")
- Click to bring window to front
- Native notification when background task completes

### File Drag-and-Drop

- Drop images/HTML onto the generate phase for design reference
- Uses `FileReader.readAsText()` in webview (not `File.path` — doesn't exist
  in system webviews)
- Content sent via RPC to Bun process

## RPC Schema

```typescript
type VibesDesktopRPC = {
  requests: {
    // Setup
    checkClaude: () => { installed: boolean; version?: string; path?: string }
    checkAuth: () => { authenticated: boolean; account?: string }
    triggerLogin: () => { success: boolean }
    checkPocketId: () => { authenticated: boolean }
    triggerPocketIdLogin: () => { success: boolean }

    // Generate
    generate: (prompt: string, theme?: string, designRef?: string,
               animation?: string) => { taskId: string }
    abort: (taskId: string) => { success: boolean }

    // Chat
    chat: (message: string, designRef?: string, animation?: string,
           skill?: string) => { taskId: string }

    // Theme
    switchTheme: (themeId: string) => { taskId: string }
    getThemes: () => ThemeCatalog
    getAnimations: () => AnimationCatalog

    // App Management
    saveApp: (name: string) => { success: boolean }
    loadApp: (name: string) => { success: boolean }
    listApps: () => AppEntry[]
    deleteApp: (name: string) => { success: boolean }
    saveScreenshot: (name: string, dataUrl: string) => { success: boolean }

    // Deploy
    deploy: (name: string) => { taskId: string }

    // Config
    getSkills: () => SkillEntry[]
    getConfig: () => EditorConfig
  }

  messages: {
    // Streaming
    token: { taskId: string; text: string }
    toolUse: { taskId: string; tool: string; input: string }
    toolResult: { taskId: string; tool: string; output: string; success: boolean }
    status: { taskId: string; state: string; elapsed: number; progress?: number;
              stage?: string }
    done: { taskId: string; text: string; cost?: number; hasEdited?: boolean }
    error: { taskId: string; message: string }

    // Events
    appUpdated: { path: string }
    themeSelected: { themeId: string }
    authRequired: { service: "anthropic" | "pocketid" }
    authComplete: { service: "anthropic" | "pocketid" }
    deployProgress: { stage: string; url?: string }
  }
}
```

## File Structure

```
vibes-desktop/
├── electrobun.config.ts          # App config (name, identifier, build)
├── src/
│   ├── bun/
│   │   ├── index.ts              # Entry: CLI check, window, menus, tray
│   │   ├── claude-manager.ts     # Subprocess spawn, stream parse, progress
│   │   ├── rpc.ts                # RPC schema + request handlers
│   │   ├── preview-server.ts     # HTTP server for /app-frame + static assets
│   │   ├── app-manager.ts        # Save/load/list apps, backups, screenshots
│   │   ├── deploy-manager.ts     # Assembly + Deploy API integration
│   │   ├── plugin-discovery.ts   # Find vibes plugin, resolve paths
│   │   └── auth.ts               # Claude auth check, Pocket ID flow
│   └── mainview/
│       ├── index.html            # HTML shell
│       ├── index.ts              # Electroview RPC setup + callbacks
│       ├── App.tsx               # Root component with phase routing
│       ├── components/
│       │   ├── SetupWizard.tsx    # Steps 1-2 (+ deferred step 3)
│       │   ├── GeneratePhase.tsx  # Prompt, themes, design ref, gallery
│       │   ├── EditPhase.tsx      # Split pane: preview + chat
│       │   ├── PreviewPane.tsx    # iframe + version bar
│       │   ├── ChatPane.tsx       # Message history + composer
│       │   ├── ThemeCarousel.tsx  # Theme selection cards
│       │   ├── AnimationPicker.tsx # Animation catalog browser
│       │   ├── AppGallery.tsx     # Saved apps browser
│       │   ├── DeployPanel.tsx    # Deploy progress + URL display
│       │   └── SettingsPanel.tsx  # Model selection, preferences
│       └── styles/
│           └── editor.css        # Editor layout styles
└── package.json
```

## Dependencies

- **ElectroBun** v1.15.1+ — Native app framework
- **Bun** v1.1+ — Runtime
- **Claude CLI** — External dependency (not bundled)
- **React** — Webview UI (bundled by ElectroBun's Vite pipeline)
- **Vibes Plugin** — Discovered at runtime from `~/.claude/plugins/`

## Key Gotchas to Handle

1. **macOS PATH** — GUI apps don't inherit shell PATH. Use `resolveClaudePath()`
   with `zsh -lic` fallback at startup.
2. **Env cleaning** — Remove `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` but keep
   `CLAUDE_CODE_OAUTH_TOKEN` when spawning Claude subprocesses.
3. **Stream buffering** — Use `createStreamParser()` with
   `TextDecoder({ stream: true })`. Never raw `split("\n")`.
4. **File.path** — Doesn't exist in system webviews. Use `FileReader` + RPC.
5. **Extended thinking models** — Handle both `assistant` text blocks and
   `stream_event` deltas.
6. **User hooks** — Use `--setting-sources ""` to skip user hooks in spawned
   Claude (avoids prompt bloat and latency).
7. **stderr** — ReadableStream, read once into buffer proactively.
