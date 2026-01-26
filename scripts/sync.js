#!/usr/bin/env node
/**
 * Vibes DIY Sync Script
 *
 * Fetches documentation, import maps, and menu components from upstream sources
 * and caches locally for fast skill invocation.
 *
 * Usage:
 *   node scripts/sync.js          # Fetch only if cache is empty
 *   node scripts/sync.js --force  # Force refresh all cached files
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import * as esbuild from "esbuild";
import {
  PLUGIN_ROOT,
  CACHE_DIR,
  CONFIG_FILES,
  TEMPLATES,
  CACHE_FILES,
  SKILL_FILES,
  relativeToPlugin
} from "./lib/paths.js";
import { parseImportMapTs, parseStylePromptsTs } from "./lib/parsers.js";

// Default upstream sources (can be overridden via config file or env vars)
const DEFAULT_SOURCES = {
  fireproof: "https://use-fireproof.com/llms-full.txt",
  stylePrompt: "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/prompts/pkg/style-prompts.ts",
  importMap: "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/vibes.diy/pkg/app/config/import-map.ts",
  cssVariables: "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/vibes.diy/pkg/app/styles/colors.css",
  vibesComponentsBase: "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/vibes.diy/pkg/app/components/vibes",
  useVibesBase: "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/use-vibes/base"
};

/**
 * Load source configuration from file or environment
 * Priority: env vars > config file > defaults
 */
function loadSourceConfig() {
  let fileConfig = {};

  // Try loading config file
  if (existsSync(CONFIG_FILES.sources)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_FILES.sources, 'utf-8'));
      console.log('Loaded source config from', relativeToPlugin(CONFIG_FILES.sources));
    } catch (e) {
      console.warn(`Warning: Could not parse config file (${e.message}), using defaults`);
    }
  }

  // Merge with env vars taking priority
  return {
    fireproof: process.env.VIBES_FIREPROOF_URL || fileConfig.fireproof || DEFAULT_SOURCES.fireproof,
    stylePrompt: process.env.VIBES_STYLE_PROMPT_URL || fileConfig.stylePrompt || DEFAULT_SOURCES.stylePrompt,
    importMap: process.env.VIBES_IMPORT_MAP_URL || fileConfig.importMap || DEFAULT_SOURCES.importMap,
    cssVariables: process.env.VIBES_CSS_VARIABLES_URL || fileConfig.cssVariables || DEFAULT_SOURCES.cssVariables,
    vibesComponentsBase: process.env.VIBES_COMPONENTS_BASE_URL || fileConfig.vibesComponentsBase || DEFAULT_SOURCES.vibesComponentsBase,
    useVibesBase: process.env.VIBES_USE_VIBES_BASE_URL || fileConfig.useVibesBase || DEFAULT_SOURCES.useVibesBase
  };
}

// Load configuration
const SOURCE_CONFIG = loadSourceConfig();

// Documentation sources
const DOC_SOURCES = {
  fireproof: SOURCE_CONFIG.fireproof,
};

// Style prompt source
const STYLE_PROMPT_URL = SOURCE_CONFIG.stylePrompt;

// Import map source
const IMPORT_MAP_URL = SOURCE_CONFIG.importMap;

// CSS variables source (colors.css contains all button/card/theme variables)
const CSS_VARIABLES_URL = SOURCE_CONFIG.cssVariables;

// Menu component sources from vibes.diy
const VIBES_COMPONENTS_BASE = SOURCE_CONFIG.vibesComponentsBase;
const USE_VIBES_BASE = SOURCE_CONFIG.useVibesBase;

const MENU_COMPONENT_SOURCES = {
  // Order matters: dependencies before dependents

  // Hooks (dependencies for components)
  "useMobile": `${USE_VIBES_BASE}/hooks/useMobile.ts`,

  // Icons (dependencies for VibesButton)
  "BackIcon": `${VIBES_COMPONENTS_BASE}/icons/BackIcon.tsx`,
  "InviteIcon": `${VIBES_COMPONENTS_BASE}/icons/InviteIcon.tsx`,
  "LoginIcon": `${VIBES_COMPONENTS_BASE}/icons/LoginIcon.tsx`,
  "RemixIcon": `${VIBES_COMPONENTS_BASE}/icons/RemixIcon.tsx`,
  "SettingsIcon": `${VIBES_COMPONENTS_BASE}/icons/SettingsIcon.tsx`,

  // Core components
  "VibesSwitch.styles": `${VIBES_COMPONENTS_BASE}/VibesSwitch/VibesSwitch.styles.ts`,
  "VibesSwitch": `${VIBES_COMPONENTS_BASE}/VibesSwitch/VibesSwitch.tsx`,
  "HiddenMenuWrapper.styles": `${VIBES_COMPONENTS_BASE}/HiddenMenuWrapper/HiddenMenuWrapper.styles.ts`,
  "HiddenMenuWrapper": `${VIBES_COMPONENTS_BASE}/HiddenMenuWrapper/HiddenMenuWrapper.tsx`,
  "VibesButton.styles": `${VIBES_COMPONENTS_BASE}/VibesButton/VibesButton.styles.ts`,
  "VibesButton": `${VIBES_COMPONENTS_BASE}/VibesButton/VibesButton.tsx`,
};

// Default timeout for fetch requests (60 seconds)
const FETCH_TIMEOUT_MS = 60000;

/**
 * Fetch with timeout protection
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds (default: FETCH_TIMEOUT_MS)
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  }
}

async function fetchDoc(name, url, force) {
  const cachePath = join(CACHE_DIR, `${name}.txt`);

  if (!force && existsSync(cachePath)) {
    return { name, success: true, cached: true };
  }

  try {
    console.log(`Fetching ${name} from ${url}...`);
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      return {
        name,
        success: false,
        cached: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const content = await response.text();
    writeFileSync(cachePath, content, "utf-8");
    console.log(`  Cached ${name} (${content.length} bytes)`);

    return { name, success: true, cached: false };
  } catch (error) {
    return {
      name,
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// parseImportMapTs and parseStylePromptsTs are imported from ./lib/parsers.js

async function fetchStylePrompt(force) {
  const cachePath = join(CACHE_DIR, "style-prompt.txt");

  if (!force && existsSync(cachePath)) {
    return { name: "style-prompt", success: true, cached: true };
  }

  try {
    console.log(`Fetching style-prompt from ${STYLE_PROMPT_URL}...`);
    const response = await fetchWithTimeout(STYLE_PROMPT_URL);

    if (!response.ok) {
      return {
        name: "style-prompt",
        success: false,
        cached: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const content = await response.text();
    const stylePrompt = parseStylePromptsTs(content);

    if (!stylePrompt) {
      return {
        name: "style-prompt",
        success: false,
        cached: false,
        error: "Failed to parse default style prompt from source"
      };
    }

    writeFileSync(cachePath, stylePrompt, "utf-8");
    console.log(`  Cached style-prompt (${stylePrompt.length} bytes)`);

    return { name: "style-prompt", success: true, cached: false };
  } catch (error) {
    return {
      name: "style-prompt",
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchImportMap(force) {
  const cachePath = join(CACHE_DIR, "import-map.json");

  if (!force && existsSync(cachePath)) {
    return { name: "import-map", success: true, cached: true };
  }

  try {
    console.log(`Fetching import-map from ${IMPORT_MAP_URL}...`);
    const response = await fetchWithTimeout(IMPORT_MAP_URL);

    if (!response.ok) {
      return {
        name: "import-map",
        success: false,
        cached: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const content = await response.text();
    const imports = parseImportMapTs(content);

    const cache = {
      lastUpdated: new Date().toISOString(),
      source: IMPORT_MAP_URL,
      imports
    };

    writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
    console.log(`  Cached import-map (${Object.keys(imports).length} entries)`);

    return { name: "import-map", success: true, cached: false };
  } catch (error) {
    return {
      name: "import-map",
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Fetch CSS variables from vibes.diy
 */
async function fetchCssVariables(force) {
  const cachePath = join(CACHE_DIR, "vibes-variables.css");

  if (!force && existsSync(cachePath)) {
    return { name: "vibes-variables", success: true, cached: true };
  }

  try {
    console.log(`Fetching CSS variables from ${CSS_VARIABLES_URL}...`);
    const response = await fetchWithTimeout(CSS_VARIABLES_URL);

    if (!response.ok) {
      // If the CSS file doesn't exist, generate minimal CSS variables
      console.log("  CSS file not found, generating minimal variables...");
      const minimalCss = `:root {
  /* Vibes color variables */
  --vibes-black: #0f172a;
  --vibes-white: #ffffff;
  --vibes-near-black: #1e293b;
  --vibes-gray-ultralight: #f8fafc;
  --vibes-gray-lightest: #f1f5f9;
  --vibes-gray-light: #e2e8f0;
  --vibes-gray: #94a3b8;
  --vibes-gray-dark: #64748b;

  /* Button variants */
  --vibes-variant-blue: #3b82f6;
  --vibes-variant-red: #ef4444;
  --vibes-variant-yellow: #eab308;
  --vibes-variant-gray: #6b7280;
  --vibes-variant-green: #22c55e;
}

/* Menu animations */
@keyframes vibes-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
`;
      writeFileSync(cachePath, minimalCss, "utf-8");
      console.log(`  Generated vibes-variables.css (${minimalCss.length} bytes)`);
      return { name: "vibes-variables", success: true, cached: false };
    }

    const content = await response.text();
    writeFileSync(cachePath, content, "utf-8");
    console.log(`  Cached vibes-variables.css (${content.length} bytes)`);

    return { name: "vibes-variables", success: true, cached: false };
  } catch (error) {
    return {
      name: "vibes-variables",
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Fetch and transpile menu components from vibes.diy
 */
async function fetchMenuComponents(force) {
  const cachePath = CACHE_FILES.vibesMenu;

  if (!force && existsSync(cachePath)) {
    return { name: "vibes-menu", success: true, cached: true };
  }

  try {
    console.log("Fetching menu components from vibes.diy (parallel)...");

    // Fetch all components in parallel
    const fetchPromises = Object.entries(MENU_COMPONENT_SOURCES).map(async ([name, url]) => {
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
          console.warn(`  Warning: Failed to fetch ${name} (${response.status})`);
          return { name, source: null };
        }
        const source = await response.text();
        console.log(`  Fetched ${name}`);
        return { name, source };
      } catch (err) {
        console.warn(`  Warning: Failed to fetch ${name}: ${err.message}`);
        return { name, source: null };
      }
    });

    const fetchResults = await Promise.all(fetchPromises);

    // Track successes and failures explicitly
    const successful = fetchResults.filter(r => r.source !== null);
    const failed = fetchResults.filter(r => r.source === null);

    // Report failures summary (individual errors logged above)
    if (failed.length > 0) {
      console.warn(`  Failed to fetch ${failed.length}/${fetchResults.length} components: ${failed.map(f => f.name).join(', ')}`);
    }

    // Build sources object from successful fetches
    const sources = {};
    for (const { name, source } of successful) {
      sources[name] = source;
    }

    if (Object.keys(sources).length === 0) {
      return {
        name: "vibes-menu",
        success: false,
        cached: false,
        error: "Failed to fetch any menu component sources"
      };
    }

    console.log("  Transpiling components with esbuild (parallel)...");

    // Transpile all components in parallel
    const transpilePromises = Object.entries(sources).map(async ([name, source]) => {
      const isTS = name.includes(".styles");
      const loader = isTS ? "ts" : "tsx";

      try {
        const result = await esbuild.transform(source, {
          loader,
          jsx: "transform",
          jsxFactory: "React.createElement",
          jsxFragment: "React.Fragment",
          target: "es2020",
        });

        // Process the transpiled code
        let code = result.code;

        // Remove imports (they'll be available globally via the template)
        // Patterns are anchored to line start (^) to avoid matching inside comments
        // Note: esbuild's transform strips most comments, but we anchor defensively
        code = code
          .replace(/^import\s+\w+\s*,\s*\{[^}]+\}\s+from\s+["'][^"']+["'];?\n?/gm, "")  // import X, { y } from "..."
          .replace(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];?\n?/gm, "")            // import { x } from "..."
          .replace(/^import\s+[\w]+\s+from\s+["'][^"']+["'];?\n?/gm, "")                // import x from "..."
          .replace(/^import\s+type\s+[^\n]+\n?/gm, "")                                  // import type ... (anchored, non-greedy)
          .replace(/^export\s+/gm, "");                                                 // export keyword

        // Add React. prefix to hooks if not already prefixed
        code = code
          .replace(/(?<!React\.)useState\(/g, "React.useState(")
          .replace(/(?<!React\.)useEffect\(/g, "React.useEffect(")
          .replace(/(?<!React\.)useRef\(/g, "React.useRef(")
          .replace(/(?<!React\.)useCallback\(/g, "React.useCallback(")
          .replace(/(?<!React\.)useMemo\(/g, "React.useMemo(")
          .replace(/(?<!React\.)useLayoutEffect\b/g, "React.useLayoutEffect");

        // Namespace functions that would conflict between components
        // VibesButton.styles defines getContentWrapperStyle(isMobile, hasIcon)
        // HiddenMenuWrapper.styles defines getContentWrapperStyle(menuHeight, menuOpen, isBouncing)
        // Rename at transpile time to avoid conflicts when combined
        if (name === 'VibesButton.styles' || name === 'VibesButton') {
          code = code.replace(
            /\bgetContentWrapperStyle\b/g,
            'getVibesButtonContentWrapperStyle'
          );
        }

        return { name, code, success: true };
      } catch (err) {
        console.warn(`  Warning: Failed to transpile ${name}: ${err.message}`);
        return { name, code: null, success: false };
      }
    });

    const transpileResults = await Promise.all(transpilePromises);

    let combinedOutput = `// Auto-generated vibes menu components
// Run: node scripts/sync.js --force to regenerate
// Source: ${VIBES_COMPONENTS_BASE}
// Generated: ${new Date().toISOString()}

`;

    // Combine results in order
    for (const { name, code, success } of transpileResults) {
      if (success && code) {
        combinedOutput += `// === ${name} ===\n${code}\n\n`;
      }
    }

    // Add window exports for components that need to be accessed globally
    combinedOutput += `// === Window Exports (for standalone apps) ===
// Expose key components to window for use in inline scripts
if (typeof window !== 'undefined') {
  window.useMobile = useMobile;
  window.VibesSwitch = VibesSwitch;
  window.HiddenMenuWrapper = HiddenMenuWrapper;
  window.VibesButton = VibesButton;
  // Icons
  window.BackIcon = BackIcon;
  window.InviteIcon = InviteIcon;
  window.LoginIcon = LoginIcon;
  window.RemixIcon = RemixIcon;
  window.SettingsIcon = SettingsIcon;
}
`;

    writeFileSync(cachePath, combinedOutput, "utf-8");
    console.log(`  Cached vibes-menu.js (${combinedOutput.length} bytes)`);

    return { name: "vibes-menu", success: true, cached: false };
  } catch (error) {
    return {
      name: "vibes-menu",
      success: false,
      cached: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Generate the import map JSON string for templates
 * Uses unpinned React (esm.sh resolves latest compatible) and ?external= for singleton
 *
 * NOTE: Version 0.24.3-dev includes toCloud() for Fireproof Cloud sync.
 * See CLAUDE.md for details.
 */
const STABLE_VIBES_VERSION = "0.18.9";

// @fireproof/clerk package for authenticated Clerk sync
const FIREPROOF_CLERK_VERSION = "0.0.2";
const FIREPROOF_CLERK_PACKAGE = "@necrodome/fireproof-clerk";

function generateImportMapJson(imports) {
  // Use unpinned React URLs - esm.sh will resolve compatible versions
  const templateImports = {
    "react": "https://esm.sh/react",
    "react-dom": "https://esm.sh/react-dom",
    "react-dom/client": "https://esm.sh/react-dom/client",
    "react/jsx-runtime": "https://esm.sh/react/jsx-runtime",
  };

  // Use stable version with ?external=react,react-dom for single React instance
  // Override upstream version if it's a dev version (has known bugs)
  templateImports["use-fireproof"] = `https://esm.sh/use-vibes@${STABLE_VIBES_VERSION}?external=react,react-dom`;
  templateImports["use-vibes"] = `https://esm.sh/use-vibes@${STABLE_VIBES_VERSION}?external=react,react-dom`;

  // @fireproof/clerk for authenticated Clerk sync
  templateImports["@fireproof/clerk"] = `https://esm.sh/${FIREPROOF_CLERK_PACKAGE}@${FIREPROOF_CLERK_VERSION}?external=react,react-dom`;

  return JSON.stringify({ imports: templateImports }, null, 6).replace(/^/gm, '  ').trim();
}

/**
 * Get all available component markers from cache content
 * @param {string} cacheContent - Content of vibes-menu.js
 * @returns {string[]} - Array of component names found
 */
function getAvailableMarkers(cacheContent) {
  const markers = [...cacheContent.matchAll(/\/\/ === ([\w.]+) ===/g)];
  return markers.map(m => m[1]);
}

/**
 * Extract a component's code from the cached vibes-menu.js
 * Components are delimited by `// === ComponentName ===` comments
 *
 * @param {string} cacheContent - Content of vibes-menu.js
 * @param {string} componentName - Name of component (e.g., "VibesSwitch")
 * @returns {string|null} - Component code or null if not found
 */
function extractComponentFromCache(cacheContent, componentName) {
  // Pattern to extract section: starts at `// === Name ===` and goes until next `// ===` or end
  const extractSection = (name) => {
    const startMarker = `// === ${name} ===`;
    const startIdx = cacheContent.indexOf(startMarker);

    if (startIdx === -1) {
      // Provide helpful debug info when marker not found
      const available = getAvailableMarkers(cacheContent);
      console.warn(`  Component marker not found: "${name}"`);
      if (available.length > 0) {
        console.warn(`  Available markers: ${available.join(', ')}`);
      }
      return null;
    }

    // Find the end (next `// ===` marker or end of file)
    const contentStart = startIdx + startMarker.length;
    const nextMarkerMatch = cacheContent.slice(contentStart).match(/\n\/\/ === /);
    const endIdx = nextMarkerMatch
      ? contentStart + nextMarkerMatch.index
      : cacheContent.length;

    const extracted = cacheContent.slice(contentStart, endIdx).trim();

    // Validate we got actual content
    if (!extracted || extracted.length < 10) {
      console.warn(`  Warning: Component "${name}" extracted but appears empty or too short`);
    }

    return extracted;
  };

  // Special case: "Icons" extracts all icon components as a group
  if (componentName === "Icons") {
    const iconNames = ["BackIcon", "LoginIcon", "RemixIcon", "InviteIcon", "SettingsIcon"];
    const iconCodes = iconNames
      .map(name => extractSection(name))
      .filter(Boolean);
    return iconCodes.length > 0 ? iconCodes.join("\n\n") : null;
  }

  // For main components (VibesSwitch, HiddenMenuWrapper, VibesButton),
  // we need both the .styles section and the component itself
  const stylesName = `${componentName}.styles`;

  // Get styles (if they exist) and component
  const stylesCode = extractSection(stylesName);
  const componentCode = extractSection(componentName);

  if (!componentCode) return null;

  // Combine styles + component if styles exist
  if (stylesCode) {
    return `${stylesCode}\n\n${componentCode}`;
  }
  return componentCode;
}

/**
 * Update template files with components from the cached vibes-menu.js
 * Replaces content between `// === START ComponentName ===` and `// === END ComponentName ===` markers
 */
function updateTemplateComponents() {
  const cachePath = CACHE_FILES.vibesMenu;

  if (!existsSync(cachePath)) {
    console.log("  Skipping template update: vibes-menu.js not cached");
    return { updated: [], failed: [], skipped: ["vibes-menu.js not cached"] };
  }

  const cacheContent = readFileSync(cachePath, "utf-8");

  // Templates and their components
  // Note: VibesPanel is a local component (not in upstream), so not synced
  // Icons = all icon components (BackIcon, LoginIcon, etc.) as a group
  const templateConfigs = [
    {
      path: TEMPLATES.vibesBasic,
      components: ["useMobile", "Icons", "VibesSwitch", "HiddenMenuWrapper", "VibesButton"]
    },
    {
      path: TEMPLATES.sellUnified,
      components: ["useMobile", "Icons", "VibesSwitch", "HiddenMenuWrapper", "VibesButton"]
    }
  ];

  const updated = [];
  const failed = [];
  const skipped = [];

  for (const template of templateConfigs) {
    if (!existsSync(template.path)) {
      skipped.push(relativeToPlugin(template.path));
      continue;
    }

    let content = readFileSync(template.path, "utf-8");
    let modified = false;

    for (const componentName of template.components) {
      // Extract component from cache
      const newCode = extractComponentFromCache(cacheContent, componentName);
      if (!newCode) {
        console.warn(`  Warning: Could not extract ${componentName} from cache`);
        continue;
      }

      // Build regex to find marker block
      const startMarker = `// === START ${componentName} ===`;
      const endMarker = `// === END ${componentName} ===`;

      const startIdx = content.indexOf(startMarker);
      const endIdx = content.indexOf(endMarker);

      if (startIdx === -1 || endIdx === -1) {
        console.warn(`  Warning: Missing markers for ${componentName} in ${relativeToPlugin(template.path)}`);
        continue;
      }

      // Replace content between markers (preserving markers)
      const before = content.slice(0, startIdx + startMarker.length);
      const after = content.slice(endIdx);
      const newContent = `${before}\n${newCode}\n${after}`;

      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    }

    if (modified) {
      // Post-process: Fix duplicate function name issue
      // HiddenMenuWrapper has getContentWrapperStyle(menuHeight, menuOpen, isBouncing)
      // VibesButton has getContentWrapperStyle(isMobile, hasIcon) - rename to getButtonContentWrapperStyle
      // This fixes: "Identifier 'getContentWrapperStyle' has already been declared"
      content = fixDuplicateFunctionNames(content);

      try {
        writeFileSync(template.path, content, "utf-8");
        updated.push(relativeToPlugin(template.path));
      } catch (err) {
        failed.push(relativeToPlugin(template.path));
      }
    }
  }

  return { updated, failed, skipped };
}

/**
 * Fix duplicate function names that come from upstream components.
 * Both HiddenMenuWrapper and VibesButton define getContentWrapperStyle with different signatures.
 *
 * NOTE: Primary fix is now done at transpile time in fetchMenuComponents().
 * This function is a safety fallback for templates that were synced before the transpile-time fix.
 */
function fixDuplicateFunctionNames(content) {
  // Find the VibesButton block and rename getContentWrapperStyle within it
  const vibesButtonStart = content.indexOf('// === START VibesButton ===');
  const vibesButtonEnd = content.indexOf('// === END VibesButton ===');

  if (vibesButtonStart === -1 || vibesButtonEnd === -1) {
    return content;
  }

  const before = content.slice(0, vibesButtonStart);
  const vibesButtonBlock = content.slice(vibesButtonStart, vibesButtonEnd);
  const after = content.slice(vibesButtonEnd);

  // Rename the function definition and all uses within VibesButton block
  // Uses the same new name as the transpile-time fix: getVibesButtonContentWrapperStyle
  const fixedBlock = vibesButtonBlock.replace(
    /\bgetContentWrapperStyle\b/g,
    'getVibesButtonContentWrapperStyle'
  );

  return before + fixedBlock + after;
}

/**
 * Update import maps in skill/agent files
 */
function updateSkillImportMaps(imports) {
  const updated = [];
  const failed = [];

  // Use centralized skill file paths
  const filesToUpdate = [SKILL_FILES.vibesSkill];

  const importMapRegex = /<script type="importmap">\s*\{[\s\S]*?"imports":\s*\{[\s\S]*?\}\s*\}\s*<\/script>/g;

  const newImportMap = `<script type="importmap">
  ${generateImportMapJson(imports)}
  </script>`;

  for (const filePath of filesToUpdate) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const newContent = content.replace(importMapRegex, newImportMap);

      if (newContent !== content) {
        writeFileSync(filePath, newContent, "utf-8");
        updated.push(relativeToPlugin(filePath));
      }
    } catch (error) {
      failed.push(relativeToPlugin(filePath));
    }
  }

  return { updated, failed };
}

async function main() {
  const force = process.argv.includes("--force");
  const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

  mkdirSync(CACHE_DIR, { recursive: true });

  console.log("Vibes DIY Sync");
  console.log(`Cache directory: ${CACHE_DIR}`);
  console.log(`Force refresh: ${force}`);
  console.log("");

  const results = [];

  // Fetch documentation
  for (const [name, url] of Object.entries(DOC_SOURCES)) {
    const result = await fetchDoc(name, url, force);
    results.push(result);
  }

  // Fetch style prompt
  const stylePromptResult = await fetchStylePrompt(force);
  results.push(stylePromptResult);

  // Fetch import map
  const importMapResult = await fetchImportMap(force);
  results.push(importMapResult);

  // Fetch CSS variables
  const cssResult = await fetchCssVariables(force);
  results.push(cssResult);

  // Fetch and transpile menu components
  const menuResult = await fetchMenuComponents(force);
  results.push(menuResult);

  // Update skill files with new import map
  if (importMapResult.success && !importMapResult.cached) {
    const cache = JSON.parse(readFileSync(CACHE_FILES.importMap, "utf-8"));
    const { updated, failed } = updateSkillImportMaps(cache.imports);

    if (updated.length > 0) {
      console.log("\nUpdated import maps in:");
      for (const file of updated) {
        console.log(`  - ${file}`);
      }
    }
    if (failed.length > 0) {
      console.log("\nFailed to update:");
      for (const file of failed) {
        console.log(`  - ${file}`);
      }
    }
  }

  // Update template files with menu components
  if (menuResult.success && !menuResult.cached) {
    const { updated, failed, skipped } = updateTemplateComponents();

    if (updated.length > 0) {
      console.log("\nUpdated template components in:");
      for (const file of updated) {
        console.log(`  - ${file}`);
      }
    }
    if (failed.length > 0) {
      console.log("\nFailed to update templates:");
      for (const file of failed) {
        console.log(`  - ${file}`);
      }
    }
    if (skipped.length > 0 && verbose) {
      console.log("\nSkipped templates:");
      for (const reason of skipped) {
        console.log(`  - ${reason}`);
      }
    }
  }

  // Summary
  console.log("\nSummary:");
  const successful = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  const fromCache = results.filter(r => r.cached);

  console.log(`  Total: ${results.length}`);
  console.log(`  Fetched: ${successful.length - fromCache.length}`);
  console.log(`  From cache: ${fromCache.length}`);

  if (failedResults.length > 0) {
    console.log(`  Failed: ${failedResults.length}`);
    for (const f of failedResults) {
      console.log(`    - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }

  if (verbose) {
    console.log("\nCached files:");
    for (const result of successful) {
      if (result.name === "import-map") {
        if (existsSync(CACHE_FILES.importMap)) {
          const content = JSON.parse(readFileSync(CACHE_FILES.importMap, "utf-8"));
          console.log(`  import-map: ${Object.keys(content.imports).length} entries, updated ${content.lastUpdated}`);
        }
      } else if (result.name === "vibes-menu") {
        if (existsSync(CACHE_FILES.vibesMenu)) {
          const content = readFileSync(CACHE_FILES.vibesMenu, "utf-8");
          console.log(`  vibes-menu: ${content.length} bytes`);
        }
      } else {
        const cachePath = join(CACHE_DIR, `${result.name}.txt`);
        if (existsSync(cachePath)) {
          const content = readFileSync(cachePath, "utf-8");
          console.log(`  ${result.name}: ${content.length} bytes`);
        }
      }
    }
  }

  // Check cache staleness
  if (existsSync(CACHE_FILES.importMap)) {
    const cache = JSON.parse(readFileSync(CACHE_FILES.importMap, "utf-8"));
    const lastUpdated = new Date(cache.lastUpdated);
    const daysSinceUpdate = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate > 30) {
      console.warn(`\nWarning: Cache is ${daysSinceUpdate} days old. Consider running with --force to update.`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
