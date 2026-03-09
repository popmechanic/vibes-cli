# Vibes Desktop Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a native macOS desktop app (ElectroBun) that replicates the full Vibes web editor experience — setup wizard, generate, edit, deploy, themes, animations, app gallery, skills — with Claude CLI as the runtime.

**Architecture:** ElectroBun app with a Bun process (Claude subprocess manager, preview HTTP server, plugin discovery) and a React webview (editor UI). Communication via typed RPC for interactive operations, localhost HTTP for preview iframe. Vibes plugin discovered at runtime from `~/.claude/plugins/`.

**Tech Stack:** ElectroBun v1.15.1+, Bun, React, TypeScript, Claude CLI (`claude -p`)

**Design doc:** `docs/plans/2026-03-08-vibes-desktop-editor-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `vibes-desktop/electrobun.config.ts`
- Create: `vibes-desktop/package.json`
- Create: `vibes-desktop/tsconfig.json`
- Create: `vibes-desktop/src/bun/index.ts`
- Create: `vibes-desktop/src/mainview/index.html`
- Create: `vibes-desktop/src/mainview/index.ts`
- Create: `vibes-desktop/src/mainview/App.tsx`

**Context:** ElectroBun requires manual `index.html` creation (it does NOT auto-generate it). The `build.copy` config must map it to `views/mainview/index.html`. The project lives as a sibling to vibes-skill, not inside it.

**Step 1: Scaffold with ElectroBun**

```bash
cd /Users/marcusestes/Websites/VibesCLI
bunx electrobun init react-tailwind-vite vibes-desktop
cd vibes-desktop
bun install
```

**Step 2: Configure electrobun.config.ts**

```typescript
import type { ElectrobunConfig } from "electrobun/config";

export default {
  app: {
    name: "Vibes Editor",
    identifier: "com.vibes.desktop-editor",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
    },
  },
} satisfies ElectrobunConfig;
```

**Step 3: Create minimal index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vibes Editor</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

**Step 4: Create minimal Bun entry (src/bun/index.ts)**

```typescript
import { BrowserWindow } from "electrobun/bun";

const mainWindow = new BrowserWindow({
  title: "Vibes Editor",
  width: 1280,
  height: 820,
  minWidth: 960,
  minHeight: 600,
  url: "electrobun://mainview/index.html",
});

console.log("[vibes-desktop] App started");
```

**Step 5: Create minimal webview entry (src/mainview/index.ts)**

```typescript
import { Electroview } from "electrobun/view";

const electrobun = new Electroview({});

document.getElementById("root")!.innerHTML = "<h1>Vibes Editor</h1><p>Shell loaded.</p>";
```

**Step 6: Verify app launches**

```bash
bunx electrobun dev
```

Expected: A 1280x820 window opens with "Vibes Editor" title and "Shell loaded." text.

**Step 7: Commit**

```bash
git add vibes-desktop/
git commit -m "scaffold: ElectroBun desktop editor project"
```

---

## Task 2: RPC Schema Definition

**Files:**
- Create: `vibes-desktop/src/shared/rpc-types.ts`
- Modify: `vibes-desktop/src/bun/index.ts`
- Modify: `vibes-desktop/src/mainview/index.ts`

**Context:** The RPC schema is the typed contract between Bun and webview. ElectroBun uses `BrowserView.defineRPC<T>()` on the Bun side and `Electroview.defineRPC<T>()` on the webview side. Define it once in a shared file.

**Step 1: Define the RPC schema**

Create `src/shared/rpc-types.ts`:

```typescript
export type VibesDesktopRPC = {
  bun: {
    requests: {
      // Setup
      checkClaude: {
        params: {};
        response: { installed: boolean; version?: string; path?: string };
      };
      checkAuth: {
        params: {};
        response: { authenticated: boolean; account?: string };
      };
      triggerLogin: {
        params: {};
        response: { success: boolean; error?: string };
      };
      checkPocketId: {
        params: {};
        response: { authenticated: boolean };
      };
      triggerPocketIdLogin: {
        params: {};
        response: { success: boolean };
      };

      // Generate
      generate: {
        params: {
          prompt: string;
          themeId?: string;
          model?: string;
          designRef?: { type: "image" | "html"; content: string; intent?: string };
          animationId?: string;
        };
        response: { taskId: string };
      };

      // Chat
      chat: {
        params: {
          message: string;
          model?: string;
          designRef?: { type: "image" | "html"; content: string; intent?: string };
          animationId?: string;
          effects?: string[];
          skillId?: string;
        };
        response: { taskId: string };
      };

      // Abort
      abort: {
        params: { taskId: string };
        response: { success: boolean };
      };

      // Theme
      switchTheme: {
        params: { themeId: string };
        response: { taskId: string };
      };
      getThemes: {
        params: {};
        response: { themes: ThemeEntry[] };
      };
      getAnimations: {
        params: {};
        response: { animations: AnimationEntry[] };
      };

      // App Management
      saveApp: {
        params: { name: string };
        response: { success: boolean };
      };
      loadApp: {
        params: { name: string };
        response: { success: boolean };
      };
      listApps: {
        params: {};
        response: { apps: AppEntry[] };
      };
      deleteApp: {
        params: { name: string };
        response: { success: boolean };
      };
      saveScreenshot: {
        params: { name: string; dataUrl: string };
        response: { success: boolean };
      };

      // Deploy
      deploy: {
        params: { name: string };
        response: { taskId: string };
      };

      // Config
      getSkills: {
        params: {};
        response: { skills: SkillEntry[] };
      };
      getConfig: {
        params: {};
        response: EditorConfig;
      };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {
      token: { taskId: string; text: string };
      toolUse: { taskId: string; tool: string; input: string };
      toolResult: {
        taskId: string;
        tool: string;
        output: string;
        isError: boolean;
      };
      status: {
        taskId: string;
        state: "spawning" | "running" | "thinking" | "tool_use" | "idle";
        detail?: string;
        elapsedMs: number;
        lastActivityMs: number;
        progress?: number;
        stage?: string;
      };
      done: {
        taskId: string;
        text: string;
        cost: number;
        duration: number;
        hasEdited?: boolean;
      };
      error: { taskId: string; message: string };
      appUpdated: { path: string };
      themeSelected: { themeId: string };
      authRequired: { service: "anthropic" | "pocketid" };
      authComplete: { service: "anthropic" | "pocketid" };
      deployProgress: { stage: string; url?: string; error?: string };
    };
  };
};

export type ThemeEntry = {
  id: string;
  name: string;
  mood: string;
  bestFor: string;
  colors: { bg: string; text: string; accent: string; muted: string; border: string };
};

export type AnimationEntry = {
  id: string;
  name: string;
  description: string;
};

export type AppEntry = {
  name: string;
  slug: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type SkillEntry = {
  id: string;
  name: string;
  description: string;
  pluginName: string;
};

export type EditorConfig = {
  pluginPath: string;
  appsDir: string;
  currentApp: string | null;
};
```

**Step 2: Wire RPC into Bun entry**

Update `src/bun/index.ts`:

```typescript
import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { VibesDesktopRPC } from "../shared/rpc-types.ts";

const rpc = BrowserView.defineRPC<VibesDesktopRPC>({
  handlers: {
    requests: {
      checkClaude: async () => ({ installed: false }),
      checkAuth: async () => ({ authenticated: false }),
      triggerLogin: async () => ({ success: false, error: "Not implemented" }),
      checkPocketId: async () => ({ authenticated: false }),
      triggerPocketIdLogin: async () => ({ success: false }),
      generate: async () => ({ taskId: "stub" }),
      chat: async () => ({ taskId: "stub" }),
      abort: async () => ({ success: false }),
      switchTheme: async () => ({ taskId: "stub" }),
      getThemes: async () => ({ themes: [] }),
      getAnimations: async () => ({ animations: [] }),
      saveApp: async () => ({ success: false }),
      loadApp: async () => ({ success: false }),
      listApps: async () => ({ apps: [] }),
      deleteApp: async () => ({ success: false }),
      saveScreenshot: async () => ({ success: false }),
      deploy: async () => ({ taskId: "stub" }),
      getSkills: async () => ({ skills: [] }),
      getConfig: async () => ({ pluginPath: "", appsDir: "", currentApp: null }),
    },
    messages: {},
  },
});

const mainWindow = new BrowserWindow({
  title: "Vibes Editor",
  width: 1280,
  height: 820,
  minWidth: 960,
  minHeight: 600,
  url: "electrobun://mainview/index.html",
  rpc,
});

console.log("[vibes-desktop] App started with RPC");
```

**Step 3: Wire RPC into webview entry**

Update `src/mainview/index.ts`:

```typescript
import { Electroview } from "electrobun/view";
import type { VibesDesktopRPC } from "../shared/rpc-types.ts";

// Module-level callbacks for React to subscribe to
export const callbacks = {
  onToken: null as ((data: VibesDesktopRPC["webview"]["messages"]["token"]) => void) | null,
  onToolUse: null as ((data: VibesDesktopRPC["webview"]["messages"]["toolUse"]) => void) | null,
  onToolResult: null as ((data: VibesDesktopRPC["webview"]["messages"]["toolResult"]) => void) | null,
  onStatus: null as ((data: VibesDesktopRPC["webview"]["messages"]["status"]) => void) | null,
  onDone: null as ((data: VibesDesktopRPC["webview"]["messages"]["done"]) => void) | null,
  onError: null as ((data: VibesDesktopRPC["webview"]["messages"]["error"]) => void) | null,
  onAppUpdated: null as ((data: VibesDesktopRPC["webview"]["messages"]["appUpdated"]) => void) | null,
  onThemeSelected: null as ((data: VibesDesktopRPC["webview"]["messages"]["themeSelected"]) => void) | null,
  onAuthRequired: null as ((data: VibesDesktopRPC["webview"]["messages"]["authRequired"]) => void) | null,
  onAuthComplete: null as ((data: VibesDesktopRPC["webview"]["messages"]["authComplete"]) => void) | null,
  onDeployProgress: null as ((data: VibesDesktopRPC["webview"]["messages"]["deployProgress"]) => void) | null,
};

const rpc = Electroview.defineRPC<VibesDesktopRPC>({
  handlers: {
    messages: {
      token: (data) => callbacks.onToken?.(data),
      toolUse: (data) => callbacks.onToolUse?.(data),
      toolResult: (data) => callbacks.onToolResult?.(data),
      status: (data) => callbacks.onStatus?.(data),
      done: (data) => callbacks.onDone?.(data),
      error: (data) => callbacks.onError?.(data),
      appUpdated: (data) => callbacks.onAppUpdated?.(data),
      themeSelected: (data) => callbacks.onThemeSelected?.(data),
      authRequired: (data) => callbacks.onAuthRequired?.(data),
      authComplete: (data) => callbacks.onAuthComplete?.(data),
      deployProgress: (data) => callbacks.onDeployProgress?.(data),
    },
  },
});

export const electrobun = new Electroview({ rpc });
```

**Step 4: Verify compilation**

```bash
bunx electrobun dev
```

Expected: App launches, no TypeScript errors. Still shows "Shell loaded." (React not wired yet).

**Step 5: Commit**

```bash
git add vibes-desktop/src/shared/ vibes-desktop/src/bun/index.ts vibes-desktop/src/mainview/index.ts
git commit -m "feat: define typed RPC schema for Bun↔webview communication"
```

---

## Task 3: Plugin Discovery

**Files:**
- Create: `vibes-desktop/src/bun/plugin-discovery.ts`
- Create: `vibes-desktop/src/bun/__tests__/plugin-discovery.test.ts`

**Context:** The desktop app discovers the vibes plugin from `~/.claude/plugins/`. It needs the plugin path to access assembly scripts, templates, themes, animations, and bundles. Read `installed_plugins.json` to find the plugin, then verify required files exist.

**Step 1: Write the failing test**

Create `src/bun/__tests__/plugin-discovery.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { discoverVibesPlugin, resolvePluginPaths } from "../plugin-discovery.ts";

describe("discoverVibesPlugin", () => {
  test("returns null when installed_plugins.json does not exist", async () => {
    const result = await discoverVibesPlugin("/nonexistent/home");
    expect(result).toBeNull();
  });

  test("resolvePluginPaths returns expected paths", () => {
    const paths = resolvePluginPaths("/fake/plugin/root");
    expect(paths.assembleScript).toBe("/fake/plugin/root/scripts/assemble.js");
    expect(paths.themeDir).toBe("/fake/plugin/root/skills/vibes/themes");
    expect(paths.animationDir).toBe("/fake/plugin/root/skills/vibes/animations");
    expect(paths.baseTemplate).toBe("/fake/plugin/root/source-templates/base/template.html");
    expect(paths.bundlesDir).toBe("/fake/plugin/root/bundles");
    expect(paths.stylePrompt).toBe("/fake/plugin/root/skills/vibes/defaults/style-prompt.txt");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd vibes-desktop && bun test src/bun/__tests__/plugin-discovery.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement plugin discovery**

Create `src/bun/plugin-discovery.ts`:

```typescript
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface PluginPaths {
  root: string;
  assembleScript: string;
  themeDir: string;
  animationDir: string;
  baseTemplate: string;
  bundlesDir: string;
  stylePrompt: string;
  skillsDir: string;
}

export function resolvePluginPaths(pluginRoot: string): PluginPaths {
  return {
    root: pluginRoot,
    assembleScript: join(pluginRoot, "scripts", "assemble.js"),
    themeDir: join(pluginRoot, "skills", "vibes", "themes"),
    animationDir: join(pluginRoot, "skills", "vibes", "animations"),
    baseTemplate: join(pluginRoot, "source-templates", "base", "template.html"),
    bundlesDir: join(pluginRoot, "bundles"),
    stylePrompt: join(pluginRoot, "skills", "vibes", "defaults", "style-prompt.txt"),
    skillsDir: join(pluginRoot, "skills"),
  };
}

export async function discoverVibesPlugin(
  home?: string
): Promise<PluginPaths | null> {
  const h = home || homedir();
  const installedPath = join(h, ".claude", "plugins", "installed_plugins.json");

  if (!existsSync(installedPath)) return null;

  try {
    const data = JSON.parse(await Bun.file(installedPath).text());

    // Find vibes plugin entry
    const vibesEntry = Array.isArray(data)
      ? data.find(
          (p: any) =>
            p.name === "vibes" ||
            p.packageName?.includes("vibes") ||
            p.path?.includes("vibes")
        )
      : null;

    if (!vibesEntry?.path) {
      // Fallback: scan cache directories
      const cacheDir = join(h, ".claude", "plugins", "cache");
      if (!existsSync(cacheDir)) return null;

      // Look for vibes plugin in any marketplace cache
      const { readdirSync } = await import("fs");
      for (const market of readdirSync(cacheDir)) {
        const vibesDir = join(cacheDir, market, "vibes");
        if (existsSync(vibesDir)) {
          // Find latest version
          const versions = readdirSync(join(vibesDir)).filter(
            (v) => !v.startsWith(".")
          );
          if (versions.length > 0) {
            const latestVersion = versions.sort().pop()!;
            const pluginRoot = join(vibesDir, latestVersion);
            return validateAndReturn(pluginRoot);
          }
        }
      }
      return null;
    }

    return validateAndReturn(vibesEntry.path);
  } catch {
    return null;
  }
}

function validateAndReturn(pluginRoot: string): PluginPaths | null {
  const paths = resolvePluginPaths(pluginRoot);

  // Verify critical files exist
  const required = [paths.themeDir, paths.assembleScript];
  for (const p of required) {
    if (!existsSync(p)) {
      console.warn(`[plugin-discovery] Missing required path: ${p}`);
      return null;
    }
  }

  return paths;
}
```

**Step 4: Run test to verify it passes**

```bash
cd vibes-desktop && bun test src/bun/__tests__/plugin-discovery.test.ts
```

Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add vibes-desktop/src/bun/plugin-discovery.ts vibes-desktop/src/bun/__tests__/
git commit -m "feat: plugin discovery — find vibes plugin from ~/.claude/plugins/"
```

---

## Task 4: Claude CLI Resolution and Auth

**Files:**
- Create: `vibes-desktop/src/bun/auth.ts`
- Create: `vibes-desktop/src/bun/__tests__/auth.test.ts`

**Context:** macOS GUI apps don't inherit shell PATH (Gotcha #13). Must resolve the absolute path to `claude` at startup via login shell. Auth check spawns a lightweight Claude command to verify the user is logged in.

**Step 1: Write the failing test**

Create `src/bun/__tests__/auth.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { resolveClaudePath, cleanEnv } from "../auth.ts";

describe("resolveClaudePath", () => {
  test("returns a non-empty string", () => {
    const path = resolveClaudePath();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });
});

describe("cleanEnv", () => {
  test("removes nesting guard variables", () => {
    process.env.CLAUDECODE = "1";
    process.env.CLAUDE_CODE_ENTRYPOINT = "test";
    const env = cleanEnv();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
  });

  test("preserves CLAUDE_CODE_OAUTH_TOKEN", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "keep-me";
    const env = cleanEnv();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("keep-me");
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  test("removes CMUX variables", () => {
    process.env.CMUX_SURFACE_ID = "test";
    process.env.CMUX_PANEL_ID = "test";
    const env = cleanEnv();
    expect(env.CMUX_SURFACE_ID).toBeUndefined();
    expect(env.CMUX_PANEL_ID).toBeUndefined();
    delete process.env.CMUX_SURFACE_ID;
    delete process.env.CMUX_PANEL_ID;
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd vibes-desktop && bun test src/bun/__tests__/auth.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement auth module**

Create `src/bun/auth.ts`:

```typescript
export function resolveClaudePath(): string {
  // Try interactive login shell (sources .zprofile AND .zshrc)
  for (const flags of ["-lic", "-lc", "-ic"]) {
    try {
      const result = Bun.spawnSync(["zsh", flags, "which claude"], {
        timeout: 5000,
      });
      const resolved = result.stdout.toString().trim();
      if (
        resolved &&
        result.exitCode === 0 &&
        !resolved.includes("not found")
      ) {
        return resolved;
      }
    } catch {}
  }

  // Direct path check — common install locations
  const home = process.env.HOME || "";
  const candidates = [
    `${home}/.claude/local/claude`,
    `/usr/local/bin/claude`,
    `/opt/homebrew/bin/claude`,
    `${home}/.local/bin/claude`,
    `${home}/.npm-global/bin/claude`,
  ];

  for (const p of candidates) {
    try {
      const file = Bun.file(p);
      if (file.size > 0) return p;
    } catch {}
  }

  return "claude"; // fallback
}

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  if (env.CMUX_SURFACE_ID) {
    delete env.CMUX_SURFACE_ID;
    delete env.CMUX_PANEL_ID;
    delete env.CMUX_TAB_ID;
    delete env.CMUX_WORKSPACE_ID;
    delete env.CMUX_SOCKET_PATH;
  }
  return env;
}

// Cached at startup
export const CLAUDE_BIN = resolveClaudePath();

export async function checkClaudeInstalled(): Promise<{
  installed: boolean;
  version?: string;
  path?: string;
}> {
  try {
    const result = Bun.spawnSync([CLAUDE_BIN, "--version"], {
      timeout: 10000,
      env: cleanEnv(),
    });
    const version = result.stdout.toString().trim();
    if (result.exitCode === 0 && version) {
      return { installed: true, version, path: CLAUDE_BIN };
    }
    return { installed: false };
  } catch {
    return { installed: false };
  }
}

export async function checkClaudeAuth(): Promise<{
  authenticated: boolean;
  account?: string;
}> {
  try {
    // Spawn a minimal Claude command to test auth
    const result = Bun.spawnSync(
      [
        CLAUDE_BIN,
        "-p",
        "--output-format",
        "json",
        "--max-turns",
        "1",
        "--permission-mode",
        "bypassPermissions",
        "--setting-sources",
        "",
        "Reply with exactly: AUTH_OK",
      ],
      {
        timeout: 30000,
        env: cleanEnv(),
      }
    );

    const stdout = result.stdout.toString().trim();
    if (result.exitCode === 0 && stdout.includes("AUTH_OK")) {
      return { authenticated: true };
    }

    const stderr = result.stderr.toString();
    if (
      stderr.includes("not authenticated") ||
      stderr.includes("login") ||
      stderr.includes("unauthorized")
    ) {
      return { authenticated: false };
    }

    // If it ran at all without auth error, auth is probably fine
    if (result.exitCode === 0) {
      return { authenticated: true };
    }

    return { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}

export async function triggerClaudeLogin(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // claude login opens browser for OAuth
    const proc = Bun.spawn([CLAUDE_BIN, "login"], {
      stdout: "pipe",
      stderr: "pipe",
      env: cleanEnv(),
    });

    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return { success: true };
    }

    const stderr = await new Response(proc.stderr).text();
    return { success: false, error: stderr.trim() };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function checkPocketIdAuth(): Promise<{
  authenticated: boolean;
}> {
  const { existsSync } = await import("fs");
  const { join } = await import("path");
  const { homedir } = await import("os");

  const tokenPath = join(homedir(), ".vibes", "auth.json");
  if (!existsSync(tokenPath)) return { authenticated: false };

  try {
    const data = JSON.parse(await Bun.file(tokenPath).text());
    // Check if token exists and hasn't expired
    if (data.access_token && data.expires_at) {
      const expiresAt = new Date(data.expires_at).getTime();
      if (expiresAt > Date.now()) {
        return { authenticated: true };
      }
    }
    return { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}
```

**Step 4: Run tests**

```bash
cd vibes-desktop && bun test src/bun/__tests__/auth.test.ts
```

Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add vibes-desktop/src/bun/auth.ts vibes-desktop/src/bun/__tests__/auth.test.ts
git commit -m "feat: Claude CLI resolution, env cleaning, and auth checking"
```

---

## Task 5: Claude Manager (Stream Parser + Subprocess)

**Files:**
- Create: `vibes-desktop/src/bun/claude-manager.ts`
- Create: `vibes-desktop/src/bun/__tests__/claude-manager.test.ts`

**Context:** Port the core of `claude-bridge.ts` — operation lock, stream parsing, progress tracking, heartbeat, spawn/abort. This is the engine that powers generate, chat, and theme switching. Replace WebSocket broadcast with RPC `sendProxy` calls.

**Step 1: Write failing tests**

Create `src/bun/__tests__/claude-manager.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  createStreamParser,
  calcProgressFromCounters,
  acquireLock,
  releaseLock,
  isLocked,
} from "../claude-manager.ts";

describe("createStreamParser", () => {
  test("parses complete JSON lines", () => {
    const events: any[] = [];
    const parse = createStreamParser((e) => events.push(e));

    parse(Buffer.from('{"type":"system"}\n{"type":"result"}\n'));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("system");
    expect(events[1].type).toBe("result");
  });

  test("handles split chunks", () => {
    const events: any[] = [];
    const parse = createStreamParser((e) => events.push(e));

    parse(Buffer.from('{"type":"sys'));
    expect(events).toHaveLength(0);

    parse(Buffer.from('tem"}\n'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("system");
  });

  test("skips empty lines", () => {
    const events: any[] = [];
    const parse = createStreamParser((e) => events.push(e));

    parse(Buffer.from('\n\n{"type":"test"}\n\n'));
    expect(events).toHaveLength(1);
  });
});

describe("calcProgressFromCounters", () => {
  test("starts at 5% minimum", () => {
    const { progress } = calcProgressFromCounters(0, 0, false);
    expect(progress).toBeGreaterThanOrEqual(5);
  });

  test("increases with elapsed time", () => {
    const early = calcProgressFromCounters(2, 0, false);
    const later = calcProgressFromCounters(30, 0, false);
    expect(later.progress).toBeGreaterThan(early.progress);
  });

  test("jumps when hasEdited is true", () => {
    const noEdit = calcProgressFromCounters(10, 2, false);
    const withEdit = calcProgressFromCounters(10, 2, true);
    expect(withEdit.progress).toBeGreaterThan(noEdit.progress);
  });

  test("never exceeds 95", () => {
    const { progress } = calcProgressFromCounters(999, 50, true);
    expect(progress).toBeLessThanOrEqual(95);
  });

  test("provides stage labels", () => {
    const { stage } = calcProgressFromCounters(5, 0, false);
    expect(stage).toBeTruthy();
    expect(typeof stage).toBe("string");
  });
});

describe("operation lock", () => {
  test("acquires and releases", () => {
    expect(isLocked()).toBe(false);
    const acquired = acquireLock("test", () => {});
    expect(acquired).toBe(true);
    expect(isLocked()).toBe(true);
    releaseLock();
    expect(isLocked()).toBe(false);
  });

  test("rejects when already locked", () => {
    acquireLock("test1", () => {});
    const second = acquireLock("test2", () => {});
    expect(second).toBe(false);
    releaseLock();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd vibes-desktop && bun test src/bun/__tests__/claude-manager.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement Claude Manager**

Create `src/bun/claude-manager.ts`:

```typescript
import { CLAUDE_BIN, cleanEnv } from "./auth.ts";

// --- Stream Parser ---

export function createStreamParser(onEvent: (event: any) => void) {
  const decoder = new TextDecoder();
  let buffer = "";

  return (chunk: Buffer | Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (err) {
        console.warn(
          "[claude stdout] JSON parse error:",
          (err as Error).message,
          line.slice(0, 200)
        );
      }
    }
  };
}

// --- Progress Calculation ---

export function calcProgressFromCounters(
  elapsedSec: number,
  toolsUsed: number,
  hasEdited: boolean,
  floorProgress = 0
): { progress: number; stage: string } {
  let progress = 5;
  let stage = "Starting Claude...";

  if (elapsedSec > 2) {
    progress = 10;
    stage = "Loading context...";
  }
  if (elapsedSec > 8) {
    progress = 20;
    stage = "Analyzing request...";
  }
  if (toolsUsed > 0) {
    progress = 30 + Math.min(toolsUsed * 5, 30);
    stage = "Reading & analyzing...";
  }
  if (hasEdited) {
    progress = Math.max(progress, 70);
    stage = "Writing changes...";
  }
  if (elapsedSec > 60) {
    progress = Math.max(progress, 80);
    stage = "Finishing up...";
  }

  progress = Math.max(progress, floorProgress);
  progress = Math.min(progress, 95);

  return { progress, stage };
}

// --- Operation Lock ---

let currentLock: { type: string; cancelFn: () => void } | null = null;

export function acquireLock(type: string, cancelFn: () => void): boolean {
  if (currentLock) return false;
  currentLock = { type, cancelFn };
  return true;
}

export function releaseLock(): void {
  currentLock = null;
}

export function cancelCurrent(): boolean {
  if (!currentLock) return false;
  currentLock.cancelFn();
  releaseLock();
  return true;
}

export function isLocked(): boolean {
  return currentLock !== null;
}

// --- Active Tasks ---

const activeTasks = new Map<
  string,
  {
    proc: ReturnType<typeof Bun.spawn>;
    heartbeat: ReturnType<typeof setInterval>;
  }
>();

// --- Spawn Claude ---

export interface SpawnOpts {
  maxTurns?: number;
  model?: string;
  tools?: string;
  cwd?: string;
  permissionMode?: string;
}

export function spawnClaude(
  taskId: string,
  prompt: string,
  opts: SpawnOpts,
  rpc: any
): ReturnType<typeof Bun.spawn> | null {
  const cancelFn = () => abortTask(taskId);
  if (!acquireLock("claude", cancelFn)) {
    rpc.sendProxy.error({ taskId, message: "Another operation is in progress" });
    return null;
  }

  let currentState:
    | "spawning"
    | "running"
    | "thinking"
    | "tool_use"
    | "idle" = "spawning";
  let lastToolName = "";
  let lastOutputTime = Date.now();
  let toolsUsed = 0;
  let hasEdited = false;
  let floorProgress = 0;
  const startTime = Date.now();

  // Build args
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    opts.permissionMode || "bypassPermissions",
    "--setting-sources",
    "",
    "--model",
    opts.model || "sonnet",
    "--no-session-persistence",
  ];

  if (opts.maxTurns) {
    args.push("--max-turns", String(opts.maxTurns));
  }

  if (opts.tools) {
    args.push("--tools", opts.tools);
  }

  args.push(prompt);

  // Spawn
  const proc = Bun.spawn([CLAUDE_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv(),
    cwd: opts.cwd,
  });

  // Heartbeat every 2s
  const heartbeat = setInterval(() => {
    const elapsedSec = (Date.now() - startTime) / 1000;
    const { progress, stage } = calcProgressFromCounters(
      elapsedSec,
      toolsUsed,
      hasEdited,
      floorProgress
    );
    floorProgress = progress; // ratchet

    rpc.sendProxy.status({
      taskId,
      state: currentState,
      detail: currentState === "tool_use" ? lastToolName : undefined,
      elapsedMs: Date.now() - startTime,
      lastActivityMs: Date.now() - lastOutputTime,
      progress,
      stage,
    });

    // Silence timeout: 300s
    const silenceSec = (Date.now() - lastOutputTime) / 1000;
    if (silenceSec > 300) {
      console.warn("[claude-manager] Silence timeout — killing subprocess");
      proc.kill("SIGTERM");
    }
  }, 2000);

  activeTasks.set(taskId, { proc, heartbeat });

  // Collect stderr
  const stderrChunks: string[] = [];
  const stderrDecoder = new TextDecoder();
  (async () => {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrChunks.push(stderrDecoder.decode(value, { stream: true }));
      }
    } catch {}
  })();

  function cleanup() {
    clearInterval(heartbeat);
    activeTasks.delete(taskId);
    currentState = "idle";
    releaseLock();
  }

  // Parse stdout
  const parse = createStreamParser((event) => {
    lastOutputTime = Date.now();

    switch (event.type) {
      case "system":
        currentState = "running";
        break;

      case "assistant": {
        const msg = event.message;
        if (!msg?.content) break;
        for (const block of msg.content) {
          if (block.type === "text") {
            rpc.sendProxy.token({ taskId, text: block.text });
            currentState = "running";
          } else if (block.type === "tool_use") {
            rpc.sendProxy.toolUse({
              taskId,
              tool: block.name,
              input:
                typeof block.input === "string"
                  ? block.input
                  : JSON.stringify(block.input),
            });
            currentState = "tool_use";
            lastToolName = block.name;
            toolsUsed++;
            if (block.name === "Edit" || block.name === "Write") {
              hasEdited = true;
            }
          }
        }
        break;
      }

      case "stream_event": {
        const delta = event.event?.delta;
        if (delta?.text) {
          rpc.sendProxy.token({ taskId, text: delta.text });
          currentState = "running";
        }
        break;
      }

      case "tool_result": {
        const content = event.content ?? event.message?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((b: any) => b.text ?? "").join("")
              : JSON.stringify(content);
        rpc.sendProxy.toolResult({
          taskId,
          tool: lastToolName,
          output: text.slice(0, 10000),
          isError: !!event.is_error,
        });
        currentState = "running";

        // Notify that app was updated if Write/Edit succeeded
        if (
          !event.is_error &&
          (lastToolName === "Write" || lastToolName === "Edit")
        ) {
          rpc.sendProxy.appUpdated({ path: "app.jsx" });
        }
        break;
      }

      case "result":
        rpc.sendProxy.done({
          taskId,
          text: "",
          cost: event.total_cost_usd ?? 0,
          duration: event.duration_ms ?? 0,
          hasEdited,
        });
        cleanup();
        break;
    }
  });

  // Pump stdout
  (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parse(value);
      }
    } catch {}

    const exitCode = await proc.exited;
    if (exitCode !== 0 && currentState !== "idle") {
      const stderr = stderrChunks.join("");
      rpc.sendProxy.error({
        taskId,
        message: stderr.trim() || `Claude exited with code ${exitCode}`,
      });
    }
    cleanup();
  })();

  return proc;
}

export function abortTask(taskId: string): boolean {
  const task = activeTasks.get(taskId);
  if (!task) return false;

  task.proc.kill("SIGTERM");
  // Fallback to SIGKILL after 5s
  setTimeout(() => {
    try {
      task.proc.kill("SIGKILL");
    } catch {}
  }, 5000);

  clearInterval(task.heartbeat);
  activeTasks.delete(taskId);
  releaseLock();
  return true;
}
```

**Step 4: Run tests**

```bash
cd vibes-desktop && bun test src/bun/__tests__/claude-manager.test.ts
```

Expected: PASS (all tests).

**Step 5: Commit**

```bash
git add vibes-desktop/src/bun/claude-manager.ts vibes-desktop/src/bun/__tests__/claude-manager.test.ts
git commit -m "feat: Claude manager — stream parser, progress tracking, operation lock, subprocess spawn"
```

---

## Task 6: Preview Server

**Files:**
- Create: `vibes-desktop/src/bun/preview-server.ts`

**Context:** Lightweight HTTP server on localhost:3333 serving the assembled preview HTML and static assets (themes, animations). Uses the plugin path from Task 3 for templates and assembly.

**Step 1: Implement preview server**

Create `src/bun/preview-server.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join, extname } from "path";
import type { PluginPaths } from "./plugin-discovery.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
};

export interface PreviewServerContext {
  pluginPaths: PluginPaths;
  getAssembledHtml: () => string | null;
  port: number;
}

export function startPreviewServer(ctx: PreviewServerContext): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: ctx.port,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers for iframe
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Preview frame
      if (path === "/app-frame" || path === "/app-frame/") {
        const html = ctx.getAssembledHtml();
        if (!html) {
          return new Response("<html><body><p>No app loaded.</p></body></html>", {
            headers: { ...corsHeaders, "Content-Type": "text/html" },
          });
        }
        return new Response(html, {
          headers: { ...corsHeaders, "Content-Type": "text/html" },
        });
      }

      // Theme files
      if (path.startsWith("/themes/")) {
        const filePath = join(ctx.pluginPaths.themeDir, path.replace("/themes/", ""));
        return serveFile(filePath, corsHeaders);
      }

      // Animation files
      if (path.startsWith("/animations/")) {
        const filePath = join(ctx.pluginPaths.animationDir, path.replace("/animations/", ""));
        return serveFile(filePath, corsHeaders);
      }

      // Bundle files (fireproof-oidc-bridge.js etc.)
      if (path.startsWith("/bundles/")) {
        const filePath = join(ctx.pluginPaths.bundlesDir, path.replace("/bundles/", ""));
        return serveFile(filePath, corsHeaders);
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    },
  });

  console.log(`[preview-server] Listening on http://127.0.0.1:${ctx.port}`);
  return server;
}

function serveFile(filePath: string, headers: Record<string, string>): Response {
  if (!existsSync(filePath)) {
    return new Response("Not Found", { status: 404, headers });
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    return new Response(content, {
      headers: { ...headers, "Content-Type": contentType },
    });
  } catch {
    return new Response("Read Error", { status: 500, headers });
  }
}
```

**Step 2: Verify it starts**

This will be integrated into `src/bun/index.ts` in Task 9. For now, verify no syntax errors:

```bash
cd vibes-desktop && bun build src/bun/preview-server.ts --no-bundle --target=bun
```

Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add vibes-desktop/src/bun/preview-server.ts
git commit -m "feat: preview HTTP server for /app-frame and static assets"
```

---

## Task 7: Config Loader (Themes, Animations, Skills)

**Files:**
- Create: `vibes-desktop/src/bun/config.ts`

**Context:** Port theme catalog parsing, animation catalog parsing, color extraction, theme auto-selection, and plugin skill discovery from the web editor's `config.ts`. These are read-only data loaders that run at startup and feed the RPC responses.

**Step 1: Implement config loader**

Create `src/bun/config.ts`:

```typescript
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { PluginPaths } from "./plugin-discovery.ts";
import type { ThemeEntry, AnimationEntry, SkillEntry } from "../shared/rpc-types.ts";

export interface AppConfig {
  themes: ThemeEntry[];
  animations: AnimationEntry[];
  skills: SkillEntry[];
  themeRootCss: Record<string, string>;
  appsDir: string;
}

export function loadConfig(pluginPaths: PluginPaths): AppConfig {
  const themes = loadThemeCatalog(pluginPaths.themeDir);
  const animations = loadAnimationCatalog(pluginPaths.animationDir);
  const skills = discoverPluginSkills();
  const themeRootCss = loadThemeRootCss(pluginPaths.themeDir, themes);
  const appsDir = join(homedir(), ".vibes", "apps");

  return { themes, animations, skills, themeRootCss, appsDir };
}

// --- Theme Catalog ---

function loadThemeCatalog(themeDir: string): ThemeEntry[] {
  const catalogPath = join(themeDir, "catalog.txt");
  if (!existsSync(catalogPath)) return [];

  const content = readFileSync(catalogPath, "utf-8");
  const themes: ThemeEntry[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    // Format: id | name | mood | bestFor
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 4) continue;

    const [id, name, mood, bestFor] = parts;
    const colors = parseThemeColors(themeDir, id);

    themes.push({ id, name, mood, bestFor, colors });
  }

  return themes;
}

function parseThemeColors(
  themeDir: string,
  themeId: string
): ThemeEntry["colors"] {
  const defaults = {
    bg: "#1a1a2e",
    text: "#e0e0e0",
    accent: "#e94560",
    muted: "#666",
    border: "#333",
  };

  for (const ext of [".txt", ".md"]) {
    const filePath = join(themeDir, `${themeId}${ext}`);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, "utf-8");
    const colors = { ...defaults };

    // Extract from COLOR TOKENS section
    const bgMatch = content.match(/--bg[:\s]+([#\w]+)/);
    const textMatch = content.match(/--text[:\s]+([#\w]+)/);
    const accentMatch = content.match(/--accent[:\s]+([#\w]+)/);
    const mutedMatch = content.match(/--muted[:\s]+([#\w]+)/);
    const borderMatch = content.match(/--border[:\s]+([#\w]+)/);

    if (bgMatch) colors.bg = bgMatch[1];
    if (textMatch) colors.text = textMatch[1];
    if (accentMatch) colors.accent = accentMatch[1];
    if (mutedMatch) colors.muted = mutedMatch[1];
    if (borderMatch) colors.border = borderMatch[1];

    return colors;
  }

  return defaults;
}

function loadThemeRootCss(
  themeDir: string,
  themes: ThemeEntry[]
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const theme of themes) {
    for (const ext of [".txt", ".md"]) {
      const filePath = join(themeDir, `${theme.id}${ext}`);
      if (!existsSync(filePath)) continue;

      const content = readFileSync(filePath, "utf-8");
      const rootMatch = content.match(/:root\s*\{[^}]+\}/s);
      if (rootMatch) {
        result[theme.id] = rootMatch[0];
      }
      break;
    }
  }

  return result;
}

// --- Animation Catalog ---

function loadAnimationCatalog(animDir: string): AnimationEntry[] {
  const catalogPath = join(animDir, "catalog.txt");
  if (!existsSync(catalogPath)) return [];

  const content = readFileSync(catalogPath, "utf-8");
  const animations: AnimationEntry[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 3) continue;

    const [id, name, description] = parts;
    animations.push({ id, name, description });
  }

  return animations;
}

export function getAnimationInstructions(
  animDir: string,
  animationId: string
): string | null {
  const filePath = join(animDir, `${animationId}.txt`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

// --- Skill Discovery ---

function discoverPluginSkills(): SkillEntry[] {
  const home = homedir();
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(installedPath)) return [];

  try {
    const data = JSON.parse(readFileSync(installedPath, "utf-8"));
    if (!Array.isArray(data)) return [];

    const skills: SkillEntry[] = [];

    for (const plugin of data) {
      if (!plugin.path || plugin.name === "vibes") continue;

      const skillsDir = join(plugin.path, "skills");
      if (!existsSync(skillsDir)) continue;

      for (const skillDir of readdirSync(skillsDir)) {
        const skillMdPath = join(skillsDir, skillDir, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;

        const content = readFileSync(skillMdPath, "utf-8");
        const frontmatter = parseYamlFrontmatter(content);
        if (frontmatter.name) {
          skills.push({
            id: `${plugin.name}:${skillDir}`,
            name: frontmatter.name,
            description: frontmatter.description || "",
            pluginName: plugin.name,
          });
        }
      }
    }

    return skills;
  } catch {
    return [];
  }
}

function parseYamlFrontmatter(
  content: string
): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// --- Theme Auto-Selection ---

export function autoSelectTheme(
  themes: ThemeEntry[],
  userPrompt: string
): string {
  const prompt = userPrompt.toLowerCase();
  let bestMatch = themes[0]?.id || "midnight";
  let bestScore = 0;

  for (const theme of themes) {
    let score = 0;
    const keywords = (theme.bestFor + " " + theme.mood).toLowerCase().split(/[\s,]+/);
    for (const kw of keywords) {
      if (kw && prompt.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = theme.id;
    }
  }

  return bestMatch;
}

// --- App Management Utils ---

export function slugifyPrompt(prompt: string): string {
  const filler = new Set([
    "a", "an", "the", "is", "it", "in", "on", "to", "for",
    "and", "or", "but", "with", "that", "this", "of", "my",
    "me", "i", "we", "make", "create", "build", "app",
  ]);

  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w && !filler.has(w))
    .slice(0, 4)
    .join("-")
    .slice(0, 63) || "untitled";
}

export function resolveAppName(appsDir: string, slug: string): string {
  if (!existsSync(join(appsDir, slug))) return slug;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${slug}-${i}`;
    if (!existsSync(join(appsDir, candidate))) return candidate;
  }

  return `${slug}-${Date.now()}`;
}
```

**Step 2: Verify compilation**

```bash
cd vibes-desktop && bun build src/bun/config.ts --no-bundle --target=bun
```

Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add vibes-desktop/src/bun/config.ts
git commit -m "feat: config loader — themes, animations, skills, auto-select, app utils"
```

---

## Task 8: Generate and Chat Handlers

**Files:**
- Create: `vibes-desktop/src/bun/handlers/generate.ts`
- Create: `vibes-desktop/src/bun/handlers/chat.ts`
- Create: `vibes-desktop/src/bun/handlers/theme.ts`
- Create: `vibes-desktop/src/bun/handlers/deploy.ts`

**Context:** These handlers translate RPC requests into Claude subprocess invocations. Port the prompt construction logic from the web editor's handlers. Each handler calls `spawnClaude()` from Task 5 with the appropriate prompt, tools, and maxTurns.

**Step 1: Implement generate handler**

Create `src/bun/handlers/generate.ts`:

```typescript
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnClaude, type SpawnOpts } from "../claude-manager.ts";
import { autoSelectTheme, slugifyPrompt, resolveAppName } from "../config.ts";
import type { PluginPaths } from "../plugin-discovery.ts";
import type { ThemeEntry } from "../../shared/rpc-types.ts";

export interface GenerateContext {
  pluginPaths: PluginPaths;
  themes: ThemeEntry[];
  themeRootCss: Record<string, string>;
  appsDir: string;
  currentApp: string | null;
  setCurrentApp: (name: string) => void;
}

export function handleGenerate(
  ctx: GenerateContext,
  rpc: any,
  params: {
    prompt: string;
    themeId?: string;
    model?: string;
    designRef?: { type: string; content: string; intent?: string };
    animationId?: string;
  }
): string {
  const taskId = crypto.randomUUID();

  // Create app directory
  const slug = slugifyPrompt(params.prompt);
  const appName = resolveAppName(ctx.appsDir, slug);
  const appDir = join(ctx.appsDir, appName);
  mkdirSync(appDir, { recursive: true });
  ctx.setCurrentApp(appName);

  // Select theme
  const themeId = params.themeId || autoSelectTheme(ctx.themes, params.prompt);
  const theme = ctx.themes.find((t) => t.id === themeId);

  // Load style guide
  let styleGuide = "";
  if (existsSync(ctx.pluginPaths.stylePrompt)) {
    styleGuide = readFileSync(ctx.pluginPaths.stylePrompt, "utf-8");
  }

  // Load theme content
  let themeContent = "";
  let themeEssentials = "";
  for (const ext of [".txt", ".md"]) {
    const themePath = join(ctx.pluginPaths.themeDir, `${themeId}${ext}`);
    if (existsSync(themePath)) {
      themeContent = readFileSync(themePath, "utf-8");
      themeEssentials = themeContent.slice(0, 4000);
      break;
    }
  }

  const rootCss = ctx.themeRootCss[themeId] || "";

  // Build prompt
  let prompt: string;
  let tools = "Write";
  let maxTurns = 5;

  if (params.designRef?.type === "html") {
    const refContent = params.designRef.content.slice(0, 30000);
    prompt = buildHtmlRefPrompt(
      params.prompt,
      refContent,
      styleGuide,
      appDir
    );
    maxTurns = 5;
  } else if (params.designRef?.type === "image") {
    prompt = buildImageRefPrompt(
      params.prompt,
      params.designRef.content,
      params.designRef.intent || "match",
      styleGuide,
      themeEssentials,
      rootCss,
      appDir
    );
    tools = "Write,Read";
    maxTurns = 8;
  } else {
    prompt = buildStandardPrompt(
      params.prompt,
      styleGuide,
      themeEssentials,
      rootCss,
      theme?.name || themeId,
      appDir
    );
  }

  // Spawn Claude
  const opts: SpawnOpts = {
    maxTurns,
    model: params.model,
    tools,
    cwd: appDir,
  };

  spawnClaude(taskId, prompt, opts, rpc);

  return taskId;
}

function buildStandardPrompt(
  userPrompt: string,
  styleGuide: string,
  themeEssentials: string,
  rootCss: string,
  themeName: string,
  appDir: string
): string {
  return `You are generating a React web application using JSX with Babel runtime transpilation.

STYLE GUIDE:
${styleGuide}

THEME: ${themeName}
${themeEssentials}

${rootCss ? `ROOT CSS:\n${rootCss}` : ""}

USER REQUEST: ${userPrompt}

IMPORTANT:
- Write a complete app.jsx file to ${appDir}/app.jsx
- Use React hooks (useState, useEffect, useRef, useMemo)
- Use Fireproof for data: const { useDocument, useLiveQuery, database } = window.useFireproof("app-db")
- Include theme section markers: /* @theme:tokens */, /* @theme:surfaces */, /* @theme:motion */, /* @theme:decoration */
- All CSS must be inline in the JSX file (no external stylesheets)
- Do NOT import React — it's available globally via the import map
- Export default function App() { ... }`;
}

function buildHtmlRefPrompt(
  userPrompt: string,
  htmlContent: string,
  styleGuide: string,
  appDir: string
): string {
  return `You are generating a React web application that matches this design reference.

STYLE GUIDE:
${styleGuide}

DESIGN REFERENCE HTML:
${htmlContent}

USER REQUEST: ${userPrompt}

Extract the visual design from the reference: colors, typography, spacing, layout, shadows, borders.
Create @theme:tokens, @theme:surfaces, @theme:motion, @theme:decoration sections.

Write a complete app.jsx file to ${appDir}/app.jsx.`;
}

function buildImageRefPrompt(
  userPrompt: string,
  imageDataUrl: string,
  intent: string,
  styleGuide: string,
  themeEssentials: string,
  rootCss: string,
  appDir: string
): string {
  return `You are generating a React web application inspired by a design image.

STYLE GUIDE:
${styleGuide}

${themeEssentials ? `THEME:\n${themeEssentials}` : ""}

The user has provided a design reference image. ${
    intent === "mood"
      ? "Analyze its color palette and mood — apply colors only, not layout."
      : "Match the layout, typography, and color scheme as closely as possible."
  }

USER REQUEST: ${userPrompt}

First, Read the image at the path that will be provided.
Then write a complete app.jsx file to ${appDir}/app.jsx.`;
}
```

**Step 2: Implement chat handler**

Create `src/bun/handlers/chat.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnClaude, type SpawnOpts } from "../claude-manager.ts";
import { getAnimationInstructions } from "../config.ts";
import type { PluginPaths } from "../plugin-discovery.ts";

export interface ChatContext {
  pluginPaths: PluginPaths;
  appsDir: string;
  currentApp: string | null;
}

const EFFECT_INSTRUCTIONS: Record<string, string> = {
  "3d": "Add WebGL or CSS 3D transforms. Use perspective, rotateX/Y/Z, preserve-3d.",
  animated:
    "Add @keyframes animations, CSS transitions, requestAnimationFrame loops, scroll-triggered effects.",
  interactive:
    "Add mouse-follow effects, drag interactions, hover morphs, parallax scrolling.",
  particles:
    "Add Canvas 2D particle system with useRef/useEffect. Particles drift and connect with proximity lines.",
  shader:
    "Add WebGL fragment shader with u_time, u_resolution, u_mouse uniforms. Use requestAnimationFrame.",
};

export function handleChat(
  ctx: ChatContext,
  rpc: any,
  params: {
    message: string;
    model?: string;
    designRef?: { type: string; content: string; intent?: string };
    animationId?: string;
    effects?: string[];
    skillId?: string;
  }
): string {
  const taskId = crypto.randomUUID();

  if (!ctx.currentApp) {
    rpc.sendProxy.error({ taskId, message: "No app loaded" });
    return taskId;
  }

  const appDir = join(ctx.appsDir, ctx.currentApp);
  let promptParts: string[] = [];
  let maxTurns = 8;

  // Animation instructions
  if (params.animationId) {
    const instructions = getAnimationInstructions(
      ctx.pluginPaths.animationDir,
      params.animationId
    );
    if (instructions) {
      promptParts.push(`ANIMATION MODIFIER:\n${instructions}`);
      maxTurns = 12;
    }
  }

  // Legacy effect chips
  if (params.effects?.length) {
    const effectBlocks = params.effects
      .map((e) => EFFECT_INSTRUCTIONS[e])
      .filter(Boolean);
    if (effectBlocks.length) {
      promptParts.push(
        `EFFECT INSTRUCTIONS:\n${effectBlocks.join("\n\n")}`
      );
      maxTurns = 12;
    }
  }

  // Design reference
  if (params.designRef) {
    if (params.designRef.type === "html") {
      const content = params.designRef.content.slice(0, 15000);
      promptParts.push(
        `DESIGN REFERENCE:\n${content}\n\nExtract colors, typography, layout from this reference.`
      );
      maxTurns = 12;
    } else if (params.designRef.type === "image") {
      const intent = params.designRef.intent || "match";
      promptParts.push(
        `A design image has been provided. ${
          intent === "mood"
            ? "Analyze mood and colors only."
            : "Match the layout and colors."
        }`
      );
      maxTurns = 12;
    }
  }

  // Skill context
  if (params.skillId) {
    const skillContent = loadSkillContent(ctx.pluginPaths, params.skillId);
    if (skillContent) {
      promptParts.push(
        `SKILL CONTEXT (adapt for web editor — no Bash, no Agent, focused on Edit calls):\n${skillContent.slice(0, 30000)}`
      );
      maxTurns = 16;
    }
  }

  // User message
  promptParts.push(`User says: "${params.message}"`);

  const prompt = promptParts.join("\n\n");

  const opts: SpawnOpts = {
    maxTurns,
    model: params.model,
    tools: "Read,Edit,Write,Glob,Grep",
    cwd: appDir,
  };

  spawnClaude(taskId, prompt, opts, rpc);

  return taskId;
}

function loadSkillContent(
  pluginPaths: PluginPaths,
  skillId: string
): string | null {
  // skillId format: "pluginName:skillDir"
  const parts = skillId.split(":");
  if (parts.length !== 2) return null;

  // Search installed plugins for matching skill
  const home = require("os").homedir();
  const installedPath = join(
    home,
    ".claude",
    "plugins",
    "installed_plugins.json"
  );
  if (!existsSync(installedPath)) return null;

  try {
    const plugins = JSON.parse(readFileSync(installedPath, "utf-8"));
    const plugin = plugins.find((p: any) => p.name === parts[0]);
    if (!plugin?.path) return null;

    const skillMdPath = join(plugin.path, "skills", parts[1], "SKILL.md");
    if (!existsSync(skillMdPath)) return null;

    return readFileSync(skillMdPath, "utf-8");
  } catch {
    return null;
  }
}
```

**Step 3: Implement theme handler**

Create `src/bun/handlers/theme.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnClaude, type SpawnOpts } from "../claude-manager.ts";
import type { PluginPaths } from "../plugin-discovery.ts";
import type { ThemeEntry } from "../../shared/rpc-types.ts";

export interface ThemeContext {
  pluginPaths: PluginPaths;
  themes: ThemeEntry[];
  themeRootCss: Record<string, string>;
  appsDir: string;
  currentApp: string | null;
}

export function handleSwitchTheme(
  ctx: ThemeContext,
  rpc: any,
  themeId: string
): string {
  const taskId = crypto.randomUUID();

  if (!ctx.currentApp) {
    rpc.sendProxy.error({ taskId, message: "No app loaded" });
    return taskId;
  }

  const appDir = join(ctx.appsDir, ctx.currentApp);
  const appJsxPath = join(appDir, "app.jsx");

  if (!existsSync(appJsxPath)) {
    rpc.sendProxy.error({ taskId, message: "No app.jsx found" });
    return taskId;
  }

  const appJsx = readFileSync(appJsxPath, "utf-8");
  const hasMarkers = appJsx.includes("@theme:tokens");

  // Load theme content
  let themeContent = "";
  for (const ext of [".txt", ".md"]) {
    const themePath = join(ctx.pluginPaths.themeDir, `${themeId}${ext}`);
    if (existsSync(themePath)) {
      themeContent = readFileSync(themePath, "utf-8").slice(0, 4000);
      break;
    }
  }

  const rootCss = ctx.themeRootCss[themeId] || "";
  const theme = ctx.themes.find((t) => t.id === themeId);

  let prompt: string;
  let maxTurns: number;

  if (hasMarkers) {
    // Multi-pass: surgical replacement within markers
    prompt = `Switch the theme of this app to "${theme?.name || themeId}".

THEME:
${themeContent}

${rootCss ? `ROOT CSS:\n${rootCss}` : ""}

The app has @theme:tokens, @theme:surfaces, @theme:motion, @theme:decoration markers.
Replace ONLY the content within these markers. Do NOT change any functional code.
Read app.jsx first, then use Edit to replace each marker section.`;
    maxTurns = 5;
  } else {
    // Legacy: full CSS rewrite
    prompt = `Switch the theme of this app to "${theme?.name || themeId}".

THEME:
${themeContent}

${rootCss ? `ROOT CSS:\n${rootCss}` : ""}

This app doesn't have theme markers. Rewrite all CSS variables and visual styles
to match the new theme. Do NOT change any functional code or layout.
Read app.jsx first, then use Edit to update the styles.`;
    maxTurns = 8;
  }

  const opts: SpawnOpts = {
    maxTurns,
    tools: "Read,Edit",
    cwd: appDir,
  };

  spawnClaude(taskId, prompt, opts, rpc);

  // Notify UI of theme selection
  rpc.sendProxy.themeSelected({ themeId });

  return taskId;
}
```

**Step 4: Implement deploy handler**

Create `src/bun/handlers/deploy.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PluginPaths } from "../plugin-discovery.ts";

export interface DeployContext {
  pluginPaths: PluginPaths;
  appsDir: string;
  currentApp: string | null;
}

export async function handleDeploy(
  ctx: DeployContext,
  rpc: any,
  appName: string
): Promise<string> {
  const taskId = crypto.randomUUID();

  const appDir = join(ctx.appsDir, appName);
  const appJsxPath = join(appDir, "app.jsx");

  if (!existsSync(appJsxPath)) {
    rpc.sendProxy.error({ taskId, message: "No app.jsx found" });
    return taskId;
  }

  // Check Pocket ID auth
  const { homedir } = await import("os");
  const authPath = join(homedir(), ".vibes", "auth.json");
  if (!existsSync(authPath)) {
    rpc.sendProxy.authRequired({ service: "pocketid" });
    return taskId;
  }

  rpc.sendProxy.deployProgress({ stage: "assembling" });

  try {
    // Run assembly script from plugin
    const assembleResult = Bun.spawnSync(
      [
        "bun",
        ctx.pluginPaths.assembleScript,
        "--app-jsx",
        appJsxPath,
        "--output",
        join(appDir, "index.html"),
      ],
      {
        cwd: ctx.pluginPaths.root,
        timeout: 30000,
      }
    );

    if (assembleResult.exitCode !== 0) {
      const stderr = assembleResult.stderr.toString();
      rpc.sendProxy.error({
        taskId,
        message: `Assembly failed: ${stderr}`,
      });
      return taskId;
    }

    rpc.sendProxy.deployProgress({ stage: "deploying" });

    // Run deploy script from plugin
    const deployResult = Bun.spawnSync(
      [
        "bun",
        join(ctx.pluginPaths.root, "scripts", "deploy-cloudflare.js"),
        "--name",
        appName,
        "--file",
        join(appDir, "index.html"),
      ],
      {
        cwd: ctx.pluginPaths.root,
        timeout: 60000,
      }
    );

    if (deployResult.exitCode !== 0) {
      const stderr = deployResult.stderr.toString();
      rpc.sendProxy.error({
        taskId,
        message: `Deploy failed: ${stderr}`,
      });
      return taskId;
    }

    const stdout = deployResult.stdout.toString();
    // Extract URL from deploy output
    const urlMatch = stdout.match(
      /https?:\/\/[a-z0-9-]+\.(?:marcus-e\.workers\.dev|vibes\.diy)/
    );
    const url = urlMatch?.[0] || "";

    rpc.sendProxy.deployProgress({ stage: "complete", url });
    rpc.sendProxy.done({
      taskId,
      text: `Deployed to ${url}`,
      cost: 0,
      duration: 0,
    });
  } catch (err) {
    rpc.sendProxy.error({ taskId, message: String(err) });
  }

  return taskId;
}
```

**Step 5: Commit**

```bash
git add vibes-desktop/src/bun/handlers/
git commit -m "feat: generate, chat, theme, and deploy handlers"
```

---

## Task 9: Wire RPC Handlers to Bun Entry

**Files:**
- Modify: `vibes-desktop/src/bun/index.ts`

**Context:** Connect all the Bun-side modules (auth, plugin discovery, config, handlers, preview server) to the RPC request handlers. This is the integration point.

**Step 1: Rewrite index.ts with full wiring**

Replace `src/bun/index.ts` with:

```typescript
import { BrowserWindow, BrowserView, ApplicationMenu } from "electrobun/bun";
import type { VibesDesktopRPC } from "../shared/rpc-types.ts";
import {
  checkClaudeInstalled,
  checkClaudeAuth,
  triggerClaudeLogin,
  checkPocketIdAuth,
} from "./auth.ts";
import { discoverVibesPlugin, type PluginPaths } from "./plugin-discovery.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import { startPreviewServer } from "./preview-server.ts";
import { abortTask } from "./claude-manager.ts";
import { handleGenerate } from "./handlers/generate.ts";
import { handleChat } from "./handlers/chat.ts";
import { handleSwitchTheme } from "./handlers/theme.ts";
import { handleDeploy } from "./handlers/deploy.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// --- App State ---
let pluginPaths: PluginPaths | null = null;
let config: AppConfig | null = null;
let currentApp: string | null = null;
let assembledHtml: string | null = null;

const PREVIEW_PORT = 3333;

// --- Startup ---
async function init() {
  // Discover plugin
  pluginPaths = await discoverVibesPlugin();
  if (pluginPaths) {
    config = loadConfig(pluginPaths);
    // Ensure apps dir
    mkdirSync(config.appsDir, { recursive: true });
  }

  // Start preview server
  if (pluginPaths) {
    startPreviewServer({
      pluginPaths,
      getAssembledHtml: () => assembledHtml,
      port: PREVIEW_PORT,
    });
  }
}

init().catch(console.error);

// --- Assembly helper ---
function assembleCurrentApp(): string | null {
  if (!pluginPaths || !config || !currentApp) return null;
  const appDir = join(config.appsDir, currentApp);
  const appJsxPath = join(appDir, "app.jsx");
  if (!existsSync(appJsxPath)) return null;

  try {
    const result = Bun.spawnSync(
      [
        "bun",
        pluginPaths.assembleScript,
        "--app-jsx",
        appJsxPath,
        "--stdout",
      ],
      {
        cwd: pluginPaths.root,
        timeout: 15000,
      }
    );

    if (result.exitCode === 0) {
      assembledHtml = result.stdout.toString();
      return assembledHtml;
    }
  } catch {}
  return null;
}

// --- RPC ---
const rpc = BrowserView.defineRPC<VibesDesktopRPC>({
  handlers: {
    requests: {
      // Setup
      checkClaude: async () => checkClaudeInstalled(),
      checkAuth: async () => checkClaudeAuth(),
      triggerLogin: async () => triggerClaudeLogin(),
      checkPocketId: async () => checkPocketIdAuth(),
      triggerPocketIdLogin: async () => {
        // Trigger Pocket ID login via plugin's CLI auth
        if (!pluginPaths) return { success: false };
        try {
          const result = Bun.spawnSync(
            ["bun", join(pluginPaths.root, "scripts", "lib", "cli-auth.js")],
            { cwd: pluginPaths.root, timeout: 60000 }
          );
          return { success: result.exitCode === 0 };
        } catch {
          return { success: false };
        }
      },

      // Generate
      generate: async (params) => {
        if (!pluginPaths || !config)
          return { taskId: "error-no-plugin" };
        const taskId = handleGenerate(
          {
            pluginPaths,
            themes: config.themes,
            themeRootCss: config.themeRootCss,
            appsDir: config.appsDir,
            currentApp,
            setCurrentApp: (name) => {
              currentApp = name;
            },
          },
          rpc,
          params
        );
        return { taskId };
      },

      // Chat
      chat: async (params) => {
        if (!pluginPaths || !config)
          return { taskId: "error-no-plugin" };
        const taskId = handleChat(
          { pluginPaths, appsDir: config.appsDir, currentApp },
          rpc,
          params
        );
        return { taskId };
      },

      // Abort
      abort: async ({ taskId }) => ({ success: abortTask(taskId) }),

      // Theme
      switchTheme: async ({ themeId }) => {
        if (!pluginPaths || !config)
          return { taskId: "error-no-plugin" };
        const taskId = handleSwitchTheme(
          {
            pluginPaths,
            themes: config.themes,
            themeRootCss: config.themeRootCss,
            appsDir: config.appsDir,
            currentApp,
          },
          rpc,
          themeId
        );
        return { taskId };
      },
      getThemes: async () => ({
        themes: config?.themes || [],
      }),
      getAnimations: async () => ({
        animations: config?.animations || [],
      }),

      // App Management
      saveApp: async ({ name }) => {
        if (!config || !currentApp) return { success: false };
        const src = join(config.appsDir, currentApp);
        const dst = join(config.appsDir, name);
        if (src !== dst) {
          mkdirSync(dst, { recursive: true });
          cpSync(src, dst, { recursive: true });
        }
        return { success: true };
      },
      loadApp: async ({ name }) => {
        if (!config) return { success: false };
        const appDir = join(config.appsDir, name);
        if (!existsSync(join(appDir, "app.jsx")))
          return { success: false };
        currentApp = name;
        assembleCurrentApp();
        return { success: true };
      },
      listApps: async () => {
        if (!config) return { apps: [] };
        if (!existsSync(config.appsDir)) return { apps: [] };
        const dirs = readdirSync(config.appsDir, { withFileTypes: true })
          .filter(
            (d) =>
              d.isDirectory() &&
              existsSync(join(config!.appsDir, d.name, "app.jsx"))
          )
          .map((d) => {
            const stat = Bun.file(
              join(config!.appsDir, d.name, "app.jsx")
            );
            return {
              name: d.name,
              slug: d.name,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          });
        return { apps: dirs };
      },
      deleteApp: async ({ name }) => {
        if (!config) return { success: false };
        const appDir = join(config.appsDir, name);
        if (!existsSync(appDir)) return { success: false };
        rmSync(appDir, { recursive: true });
        if (currentApp === name) currentApp = null;
        return { success: true };
      },
      saveScreenshot: async ({ name, dataUrl }) => {
        if (!config) return { success: false };
        const appDir = join(config.appsDir, name);
        mkdirSync(appDir, { recursive: true });
        // Strip data URL prefix
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        writeFileSync(join(appDir, "thumbnail.png"), buffer);
        return { success: true };
      },

      // Deploy
      deploy: async ({ name }) => {
        if (!pluginPaths || !config)
          return { taskId: "error-no-plugin" };
        const taskId = await handleDeploy(
          { pluginPaths, appsDir: config.appsDir, currentApp },
          rpc,
          name
        );
        return { taskId };
      },

      // Config
      getSkills: async () => ({
        skills: config?.skills || [],
      }),
      getConfig: async () => ({
        pluginPath: pluginPaths?.root || "",
        appsDir: config?.appsDir || "",
        currentApp,
      }),
    },
    messages: {},
  },
});

// --- Window ---
const mainWindow = new BrowserWindow({
  title: "Vibes Editor",
  width: 1280,
  height: 820,
  minWidth: 960,
  minHeight: 600,
  url: "electrobun://mainview/index.html",
  rpc,
});

// --- Native Menu ---
ApplicationMenu.setApplicationMenu([
  {
    label: "Vibes Editor",
    submenu: [
      { label: "About Vibes Editor", role: "about" },
      { type: "separator" },
      { label: "Quit", role: "quit", accelerator: "CmdOrCtrl+Q" },
    ],
  },
  {
    label: "File",
    submenu: [
      { label: "New App", id: "new-app", accelerator: "CmdOrCtrl+N" },
      { label: "Save", id: "save-app", accelerator: "CmdOrCtrl+S" },
      { type: "separator" },
      { label: "Load App...", id: "load-app", accelerator: "CmdOrCtrl+O" },
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
      { label: "Toggle Developer Tools", role: "toggleDevTools", accelerator: "CmdOrCtrl+Alt+I" },
      { type: "separator" },
      { label: "Actual Size", role: "resetZoom" },
      { label: "Zoom In", role: "zoomIn" },
      { label: "Zoom Out", role: "zoomOut" },
    ],
  },
]);

ApplicationMenu.on("application-menu-clicked", (event) => {
  switch (event.id) {
    case "new-app":
      // Send RPC to webview to switch to generate phase
      rpc.sendProxy.appUpdated({ path: "__new__" });
      break;
    case "save-app":
      // Webview handles save via its current state
      break;
    case "load-app":
      // Webview handles load via gallery
      break;
  }
});

console.log("[vibes-desktop] App started");
```

**Step 2: Verify compilation**

```bash
cd vibes-desktop && bunx electrobun dev
```

Expected: App launches. RPC handlers are wired. Preview server starts on :3333.

**Step 3: Commit**

```bash
git add vibes-desktop/src/bun/index.ts
git commit -m "feat: wire all Bun-side modules to RPC handlers"
```

---

## Task 10: React App Shell and Phase Routing

**Files:**
- Modify: `vibes-desktop/src/mainview/App.tsx`
- Create: `vibes-desktop/src/mainview/hooks/useRPC.ts`
- Modify: `vibes-desktop/src/mainview/index.ts`

**Context:** The React UI has three phases: Setup → Generate → Edit. Phase routing is state-driven (no router needed). The `useRPC` hook bridges ElectroBun's module-level callbacks into React state.

**Step 1: Create useRPC hook**

Create `src/mainview/hooks/useRPC.ts`:

```typescript
import { useEffect, useCallback, useRef, useState } from "react";
import { callbacks, electrobun } from "../index.ts";
import type { VibesDesktopRPC } from "../../shared/rpc-types.ts";

type StatusMsg = VibesDesktopRPC["webview"]["messages"]["status"];
type DoneMsg = VibesDesktopRPC["webview"]["messages"]["done"];
type ErrorMsg = VibesDesktopRPC["webview"]["messages"]["error"];

export interface StreamState {
  tokens: string;
  tools: Array<{ tool: string; input: string; output?: string; isError?: boolean }>;
  status: StatusMsg | null;
  done: DoneMsg | null;
  error: ErrorMsg | null;
  isStreaming: boolean;
}

export function useRPC() {
  const [stream, setStream] = useState<StreamState>({
    tokens: "",
    tools: [],
    status: null,
    done: null,
    error: null,
    isStreaming: false,
  });

  const [appUpdated, setAppUpdated] = useState(0);

  useEffect(() => {
    callbacks.onToken = ({ text }) => {
      setStream((prev) => ({
        ...prev,
        tokens: prev.tokens + text,
        isStreaming: true,
      }));
    };

    callbacks.onToolUse = ({ tool, input }) => {
      setStream((prev) => ({
        ...prev,
        tools: [...prev.tools, { tool, input }],
      }));
    };

    callbacks.onToolResult = ({ tool, output, isError }) => {
      setStream((prev) => {
        const tools = [...prev.tools];
        const lastIdx = tools.findLastIndex((t) => t.tool === tool && !t.output);
        if (lastIdx >= 0) {
          tools[lastIdx] = { ...tools[lastIdx], output, isError };
        }
        return { ...prev, tools };
      });
    };

    callbacks.onStatus = (status) => {
      setStream((prev) => ({ ...prev, status }));
    };

    callbacks.onDone = (done) => {
      setStream((prev) => ({
        ...prev,
        done,
        isStreaming: false,
      }));
    };

    callbacks.onError = (error) => {
      setStream((prev) => ({
        ...prev,
        error,
        isStreaming: false,
      }));
    };

    callbacks.onAppUpdated = () => {
      setAppUpdated((n) => n + 1);
    };

    return () => {
      callbacks.onToken = null;
      callbacks.onToolUse = null;
      callbacks.onToolResult = null;
      callbacks.onStatus = null;
      callbacks.onDone = null;
      callbacks.onError = null;
      callbacks.onAppUpdated = null;
    };
  }, []);

  const resetStream = useCallback(() => {
    setStream({
      tokens: "",
      tools: [],
      status: null,
      done: null,
      error: null,
      isStreaming: false,
    });
  }, []);

  // RPC request helpers
  const rpc = electrobun.rpc;

  return { stream, resetStream, appUpdated, rpc };
}
```

**Step 2: Create App shell with phase routing**

Update `src/mainview/App.tsx`:

```tsx
import React, { useState, useEffect } from "react";
import { useRPC } from "./hooks/useRPC.ts";

type Phase = "setup" | "generate" | "edit";

export default function App() {
  const [phase, setPhase] = useState<Phase>("setup");
  const { stream, resetStream, appUpdated, rpc } = useRPC();

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0a0a", color: "#e0e0e0", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <header style={{ padding: "12px 20px", borderBottom: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Vibes Editor</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          {phase === "edit" && (
            <button onClick={() => { resetStream(); setPhase("generate"); }}
              style={headerBtnStyle}>
              New App
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, overflow: "hidden" }}>
        {phase === "setup" && (
          <SetupPhase onComplete={() => setPhase("generate")} rpc={rpc} />
        )}
        {phase === "generate" && (
          <div style={centerStyle}>
            <p>Generate phase — coming in Task 12</p>
            <button onClick={() => setPhase("edit")} style={headerBtnStyle}>
              Skip to Edit (dev)
            </button>
          </div>
        )}
        {phase === "edit" && (
          <div style={centerStyle}>
            <p>Edit phase — coming in Task 13</p>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Setup Phase (inline for now, extract in Task 11) ---
function SetupPhase({ onComplete, rpc }: { onComplete: () => void; rpc: any }) {
  const [step, setStep] = useState(0); // 0=checking, 1=install, 2=auth, 3=done
  const [claudeInfo, setClaudeInfo] = useState<any>(null);
  const [authStatus, setAuthStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Step 1: Check Claude CLI
      const claude = await rpc.request.checkClaude({});
      setClaudeInfo(claude);

      if (!claude.installed) {
        setStep(1);
        setLoading(false);
        return;
      }

      // Step 2: Check auth
      const auth = await rpc.request.checkAuth({});
      setAuthStatus(auth);

      if (!auth.authenticated) {
        setStep(2);
        setLoading(false);
        return;
      }

      // All good
      setStep(3);
      setLoading(false);
      setTimeout(onComplete, 500);
    })();
  }, []);

  if (loading) {
    return (
      <div style={centerStyle}>
        <p>Checking setup...</p>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div style={centerStyle}>
        <h2>Claude CLI Not Found</h2>
        <p>Install Claude Code CLI to continue:</p>
        <code style={codeStyle}>npm install -g @anthropic-ai/claude-code</code>
        <button onClick={async () => {
          setLoading(true);
          const result = await rpc.request.checkClaude({});
          setClaudeInfo(result);
          if (result.installed) {
            const auth = await rpc.request.checkAuth({});
            setAuthStatus(auth);
            setStep(auth.authenticated ? 3 : 2);
            if (auth.authenticated) setTimeout(onComplete, 500);
          }
          setLoading(false);
        }} style={primaryBtnStyle}>
          Check Again
        </button>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div style={centerStyle}>
        <h2>Authenticate with Anthropic</h2>
        <p>Sign in to your Anthropic account to enable Claude.</p>
        <button onClick={async () => {
          setLoading(true);
          const result = await rpc.request.triggerLogin({});
          if (result.success) {
            setStep(3);
            setTimeout(onComplete, 500);
          }
          setLoading(false);
        }} style={primaryBtnStyle}>
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div style={centerStyle}>
      <h2>Ready!</h2>
      <p>Claude CLI v{claudeInfo?.version} — authenticated</p>
    </div>
  );
}

// --- Styles ---
const centerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  gap: "16px",
  padding: "40px",
};

const headerBtnStyle: React.CSSProperties = {
  background: "#222",
  color: "#e0e0e0",
  border: "1px solid #333",
  borderRadius: "6px",
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: "13px",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "#e94560",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  padding: "12px 24px",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: 600,
};

const codeStyle: React.CSSProperties = {
  background: "#1a1a2e",
  padding: "12px 20px",
  borderRadius: "6px",
  fontSize: "14px",
  fontFamily: "monospace",
};
```

**Step 3: Update index.ts to mount React**

Add to the bottom of `src/mainview/index.ts`:

```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

const root = createRoot(document.getElementById("root")!);
root.render(React.createElement(App));
```

**Step 4: Verify**

```bash
cd vibes-desktop && bunx electrobun dev
```

Expected: App launches, shows "Checking setup..." then progresses through setup wizard. If Claude CLI is installed and authenticated, auto-advances to generate phase.

**Step 5: Commit**

```bash
git add vibes-desktop/src/mainview/
git commit -m "feat: React app shell with setup wizard and phase routing"
```

---

## Task 11: Setup Wizard Component (Extract + Polish)

**Files:**
- Create: `vibes-desktop/src/mainview/components/SetupWizard.tsx`
- Modify: `vibes-desktop/src/mainview/App.tsx` — extract inline SetupPhase

**Step 1: Extract and polish SetupWizard**

Move the inline `SetupPhase` from App.tsx into its own component at `src/mainview/components/SetupWizard.tsx`. Add:
- Step indicator (1/2 dots)
- Claude version display on success
- Error state if login fails
- Plugin check (warn if vibes plugin not found, but don't block)
- Animated transitions between steps

**Step 2: Commit**

```bash
git add vibes-desktop/src/mainview/components/SetupWizard.tsx vibes-desktop/src/mainview/App.tsx
git commit -m "feat: polished setup wizard with step indicators and plugin check"
```

---

## Task 12: Generate Phase UI

**Files:**
- Create: `vibes-desktop/src/mainview/components/GeneratePhase.tsx`
- Create: `vibes-desktop/src/mainview/components/ThemeCarousel.tsx`
- Create: `vibes-desktop/src/mainview/components/AppGallery.tsx`
- Modify: `vibes-desktop/src/mainview/App.tsx`

**Context:** The generate phase has: prompt textarea, theme carousel, design reference upload (drag-and-drop + file picker), animation picker, and app gallery. When submitted, it calls `rpc.request.generate()` and shows streaming progress.

**Step 1: Implement ThemeCarousel**

Create `src/mainview/components/ThemeCarousel.tsx` — horizontal scrollable row of theme cards showing color swatches. Each card shows theme name, mood, and 5 color dots (bg, text, accent, muted, border). Selected theme has a highlight border.

**Step 2: Implement AppGallery**

Create `src/mainview/components/AppGallery.tsx` — grid of saved apps with thumbnails. Calls `rpc.request.listApps()` on mount. Click to load. Delete button per card.

**Step 3: Implement GeneratePhase**

Create `src/mainview/components/GeneratePhase.tsx`:
- Prompt textarea with placeholder
- Theme carousel below prompt
- "Upload Design" button (uses `FileReader.readAsText()` for HTML, `readAsDataURL()` for images — NO `File.path`)
- Animation picker dropdown
- Gallery toggle
- Submit button → calls `rpc.request.generate()`, shows progress via `stream.status`
- On completion (`stream.done`), transition to edit phase

**Step 4: Wire into App.tsx**

Replace the generate phase placeholder in `App.tsx` with the `GeneratePhase` component.

**Step 5: Verify**

```bash
cd vibes-desktop && bunx electrobun dev
```

Expected: Generate phase shows prompt, themes, gallery. Entering a prompt and submitting spawns Claude and shows progress.

**Step 6: Commit**

```bash
git add vibes-desktop/src/mainview/components/
git commit -m "feat: generate phase with theme carousel, app gallery, design upload"
```

---

## Task 13: Edit Phase — Split Pane Layout

**Files:**
- Create: `vibes-desktop/src/mainview/components/EditPhase.tsx`
- Create: `vibes-desktop/src/mainview/components/PreviewPane.tsx`
- Create: `vibes-desktop/src/mainview/components/ChatPane.tsx`
- Modify: `vibes-desktop/src/mainview/App.tsx`

**Context:** The edit phase is a split-pane layout: preview iframe on the left (~600px), chat on the right (~640px), with a draggable splitter between them. The preview loads `http://localhost:3333/app-frame` in an iframe. Chat shows message history with streaming tokens, tool indicators, and a composer at the bottom.

**Step 1: Implement PreviewPane**

Create `src/mainview/components/PreviewPane.tsx`:
- iframe pointing to `http://localhost:3333/app-frame`
- Refresh on `appUpdated` counter change (append `?t=${Date.now()}` to URL)
- Green border flash animation on update
- Version bar at top (app name, optional undo/redo)

**Step 2: Implement ChatPane**

Create `src/mainview/components/ChatPane.tsx`:
- Message list (scrollable, auto-scroll to bottom)
- Each message: user bubble or assistant bubble
- Assistant bubbles show streaming tokens, tool use indicators (collapsible), stage labels
- Progress bar during streaming (from `stream.status.progress`)
- Composer at bottom: textarea + send button + cancel button (during streaming)
- Optional: animation picker, design ref upload, skill selector in composer toolbar
- On send: call `rpc.request.chat()`, reset stream, add user message to history

**Step 3: Implement EditPhase with splitter**

Create `src/mainview/components/EditPhase.tsx`:
- Flexbox layout with PreviewPane, draggable splitter div, ChatPane
- Splitter: 4px wide, cursor: col-resize, drag to resize panes
- Minimum pane width: 300px
- Default split: 50/50

**Step 4: Wire into App.tsx**

Replace the edit phase placeholder. Pass `appUpdated` and `stream` from `useRPC()`.

**Step 5: Verify**

```bash
cd vibes-desktop && bunx electrobun dev
```

Expected: After generating an app, edit phase shows split pane. Preview loads assembled HTML. Chat input sends messages to Claude and shows streaming responses. Preview refreshes when Claude edits files.

**Step 6: Commit**

```bash
git add vibes-desktop/src/mainview/components/EditPhase.tsx vibes-desktop/src/mainview/components/PreviewPane.tsx vibes-desktop/src/mainview/components/ChatPane.tsx
git commit -m "feat: edit phase with split pane preview and streaming chat"
```

---

## Task 14: Theme Switching in Edit Mode

**Files:**
- Modify: `vibes-desktop/src/mainview/components/ChatPane.tsx`
- Modify: `vibes-desktop/src/mainview/components/EditPhase.tsx`

**Context:** Add a theme button to the edit phase header that opens the theme carousel as an overlay. Selecting a theme calls `rpc.request.switchTheme()` and shows progress.

**Step 1: Add theme button to EditPhase header**

Add a palette icon button. Clicking toggles the ThemeCarousel as a dropdown/overlay.

**Step 2: Wire theme selection**

On theme card click: call `rpc.request.switchTheme({ themeId })`, show progress in chat, close overlay. Preview refreshes on completion via `appUpdated`.

**Step 3: Commit**

```bash
git add vibes-desktop/src/mainview/components/
git commit -m "feat: theme switching overlay in edit mode"
```

---

## Task 15: Deploy Integration

**Files:**
- Create: `vibes-desktop/src/mainview/components/DeployPanel.tsx`
- Modify: `vibes-desktop/src/mainview/components/EditPhase.tsx`
- Modify: `vibes-desktop/src/mainview/index.ts` — add deployProgress callback

**Context:** Deploy button in the edit phase header. Shows progress stages (assembling → deploying → complete). Handles Pocket ID auth gate — if not authenticated, shows login prompt before deploying.

**Step 1: Implement DeployPanel**

Create `src/mainview/components/DeployPanel.tsx`:
- Deploy button triggers `rpc.request.deploy({ name: currentApp })`
- Subscribe to `callbacks.onDeployProgress` for stage updates
- Subscribe to `callbacks.onAuthRequired` for Pocket ID gate
- Show progress: assembling spinner → deploying spinner → success with URL link
- URL is clickable (opens in default browser)

**Step 2: Wire auth callbacks**

Add `onAuthRequired` and `onAuthComplete` handlers to trigger Pocket ID login flow inline.

**Step 3: Commit**

```bash
git add vibes-desktop/src/mainview/components/DeployPanel.tsx
git commit -m "feat: deploy panel with Pocket ID auth gate and progress tracking"
```

---

## Task 16: App Management (Save/Load/Screenshots)

**Files:**
- Modify: `vibes-desktop/src/mainview/components/AppGallery.tsx`
- Modify: `vibes-desktop/src/mainview/components/EditPhase.tsx`

**Context:** Add save functionality to the edit phase. Gallery accessible from both generate and edit phases. Screenshots captured from preview iframe.

**Step 1: Add save button to EditPhase**

Cmd+S or button click → prompt for name (default: current app name) → `rpc.request.saveApp({ name })`.

**Step 2: Add screenshot capture**

After save, capture preview iframe as image. Since we can't directly screenshot an iframe cross-origin, use `rpc.request.saveScreenshot()` with a canvas-based approach or just save a placeholder.

**Step 3: Wire gallery into edit phase**

Add "Load App" option in header → shows AppGallery as modal → selecting loads app and refreshes preview.

**Step 4: Commit**

```bash
git add vibes-desktop/src/mainview/components/
git commit -m "feat: save/load apps with gallery and screenshots"
```

---

## Task 17: Animation Picker

**Files:**
- Create: `vibes-desktop/src/mainview/components/AnimationPicker.tsx`
- Modify: `vibes-desktop/src/mainview/components/ChatPane.tsx`

**Context:** Browsable animation catalog in the chat composer toolbar. Selecting an animation adds it as context to the next chat message.

**Step 1: Implement AnimationPicker**

Dropdown that calls `rpc.request.getAnimations()` on open. Lists animations with name and description. Selected animation stored in chat composer state.

**Step 2: Wire into ChatPane**

When an animation is selected and user sends a message, pass `animationId` in the chat params. Show a chip in the composer indicating the active animation. Clear after send.

**Step 3: Commit**

```bash
git add vibes-desktop/src/mainview/components/AnimationPicker.tsx
git commit -m "feat: animation picker in chat composer"
```

---

## Task 18: Skills Integration

**Files:**
- Create: `vibes-desktop/src/mainview/components/SkillPicker.tsx`
- Modify: `vibes-desktop/src/mainview/components/ChatPane.tsx`

**Context:** Discover installed plugin skills and show them in the chat composer toolbar. Selecting a skill injects its SKILL.md content as context for the next chat message.

**Step 1: Implement SkillPicker**

Dropdown that calls `rpc.request.getSkills()` on open. Shows skill name, description, and plugin name. Selected skill stored in composer state.

**Step 2: Wire into ChatPane**

When a skill is selected, pass `skillId` in chat params. Show chip in composer. Clear after send.

**Step 3: Commit**

```bash
git add vibes-desktop/src/mainview/components/SkillPicker.tsx
git commit -m "feat: skill picker for plugin skill context injection"
```

---

## Task 19: System Tray

**Files:**
- Modify: `vibes-desktop/src/bun/index.ts`

**Context:** Show system tray icon during long operations. Tooltip shows current status. Click brings window to front. Native notification on background task completion.

**Step 1: Add tray to index.ts**

```typescript
import { Tray } from "electrobun/bun";

const tray = new Tray({
  title: "Vibes",
  image: "path/to/icon.png", // 22x22 template image
  width: 22,
  height: 22,
});
```

**Step 2: Update tray on status changes**

Listen for Claude subprocess events and update tray tooltip. When `done` fires, send native notification if window is not focused.

**Step 3: Commit**

```bash
git add vibes-desktop/src/bun/index.ts
git commit -m "feat: system tray with status tooltip and completion notifications"
```

---

## Task 20: Polish and Integration Test

**Files:**
- All previously created files

**Step 1: End-to-end test**

Launch app, go through setup wizard, generate an app with a prompt and theme, chat to edit it, switch themes, save the app, load it from gallery, deploy it. Verify each phase works.

**Step 2: Fix edge cases**

- Preview server not starting if plugin not found
- Abort during generate/chat/theme
- Multiple rapid generates
- App name collisions
- Missing theme files
- Network errors during deploy

**Step 3: Build for distribution**

```bash
cd vibes-desktop && bunx electrobun build --env=stable
```

Verify DMG is created in `artifacts/`. Test launching from DMG on a clean user account.

**Step 4: Final commit**

```bash
git add -A
git commit -m "polish: integration fixes and build verification"
```
