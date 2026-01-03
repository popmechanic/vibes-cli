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
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";

// Get the plugin root directory (parent of scripts/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = dirname(__dirname);
const CACHE_DIR = join(PLUGIN_ROOT, "cache");
const CONFIG_FILE = join(PLUGIN_ROOT, "config", "sources.json");

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
  if (existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      console.log('Loaded source config from', CONFIG_FILE);
    } catch (e) {
      console.warn('Warning: Could not parse config file, using defaults');
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

/**
 * Parse the import-map.ts file from vibes.diy and extract the import map.
 *
 * Handles multiple syntax patterns:
 * - Quoted keys: "react-dom": "https://esm.sh/react-dom@19.2.1"
 * - Unquoted keys: react: "https://esm.sh/react@19.2.1"
 * - Template literals with VIBES_VERSION: "use-vibes": `https://esm.sh/use-vibes@${VIBES_VERSION}`
 *
 * @param {string} content - Raw TypeScript content from import-map.ts
 * @returns {Object.<string, string>} - Object mapping package names to CDN URLs
 * @example
 * const imports = parseImportMapTs(tsContent);
 * // { "react": "https://esm.sh/react@19.2.1", "use-vibes": "https://esm.sh/use-vibes@0.19" }
 */
function parseImportMapTs(content) {
  const imports = {};

  // Extract VIBES_VERSION
  const versionMatch = content.match(/const VIBES_VERSION\s*=\s*["']([^"']+)["']/);
  const vibesVersion = versionMatch ? versionMatch[1] : "0.19";

  // Extract entries from getLibraryImportMap function
  // Match quoted keys: "react-dom": "https://esm.sh/react-dom@19.2.1"
  const quotedStaticMatches = content.matchAll(/"([^"]+)":\s*"(https:\/\/[^"]+)"/g);
  for (const match of quotedStaticMatches) {
    imports[match[1]] = match[2];
  }

  // Match unquoted keys: react: "https://esm.sh/react@19.2.1"
  const unquotedStaticMatches = content.matchAll(/(\w+):\s*"(https:\/\/[^"]+)"/g);
  for (const match of unquotedStaticMatches) {
    imports[match[1]] = match[2];
  }

  // Match quoted keys with template literals: "use-fireproof": `https://esm.sh/use-vibes@${VIBES_VERSION}`
  const quotedTemplateMatches = content.matchAll(/"([^"]+)":\s*`(https:\/\/[^`]+)\$\{VIBES_VERSION\}`/g);
  for (const match of quotedTemplateMatches) {
    imports[match[1]] = match[2] + vibesVersion;
  }

  // Match unquoted keys with template literals: react: `https://esm.sh/react@${VIBES_VERSION}`
  const unquotedTemplateMatches = content.matchAll(/(\w+):\s*`(https:\/\/[^`]+)\$\{VIBES_VERSION\}`/g);
  for (const match of unquotedTemplateMatches) {
    imports[match[1]] = match[2] + vibesVersion;
  }

  return imports;
}

/**
 * Parse the style-prompts.ts file and extract the default style prompt.
 *
 * Looks for DEFAULT_STYLE_NAME and then extracts the corresponding prompt
 * from the stylePrompts array. Falls back to searching for a brutalist-style
 * prompt if the default cannot be found.
 *
 * @param {string} content - Raw TypeScript content from style-prompts.ts
 * @returns {string} The extracted style prompt text, or empty string if not found
 */
function parseStylePromptsTs(content) {
  // Find the DEFAULT_STYLE_NAME
  const defaultNameMatch = content.match(/DEFAULT_STYLE_NAME\s*=\s*["']([^"']+)["']/);
  const defaultName = defaultNameMatch ? defaultNameMatch[1] : "brutalist web";

  // Find the stylePrompts array and extract the prompt for the default style
  const styleRegex = new RegExp(
    `\\{\\s*name:\\s*["']${defaultName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*,\\s*prompt:\\s*(['"\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`,
    's'
  );

  const match = content.match(styleRegex);
  if (match) {
    return match[2]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  // Fallback
  const fallbackMatch = content.match(/prompt:\s*['"`](Create a UI theme in a neo-brutalist style[^'"`]*)['"]/s);
  if (fallbackMatch) {
    return fallbackMatch[1];
  }

  return "";
}

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
  const cachePath = join(CACHE_DIR, "vibes-menu.js");

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
    const sources = {};
    for (const { name, source } of fetchResults) {
      if (source !== null) {
        sources[name] = source;
      }
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
 * Add ?external=react,react-dom to esm.sh URLs to ensure single React instance
 * This tells esm.sh to keep React as a bare specifier so our import map intercepts it.
 * This prevents "Cannot read properties of null (reading 'useContext')" errors.
 */
function addReactExternal(url) {
  if (!url || !url.includes("esm.sh")) return url;
  // Don't add external to react/react-dom themselves
  if (url.includes("/react@") || url.includes("/react-dom@")) return url;
  // Remove any existing alias/external params and add external
  let cleanUrl = url.replace(/[?&](alias|external)=[^&]*/g, "");
  // Clean up any trailing ? or &
  cleanUrl = cleanUrl.replace(/[?&]$/, "");
  // Add external parameter
  const separator = cleanUrl.includes("?") ? "&" : "?";
  return cleanUrl + separator + "external=react,react-dom";
}

/**
 * Generate the import map JSON string for templates
 * Uses unpinned React (esm.sh resolves latest compatible) and ?external= for singleton
 *
 * NOTE: We use stable version 0.18.9 for use-vibes and call-ai, not the upstream
 * dev version. The 0.19.x-dev versions have known React context bugs.
 * See CLAUDE.md for details.
 */
const STABLE_VIBES_VERSION = "0.18.9";

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
  templateImports["call-ai"] = `https://esm.sh/call-ai@${STABLE_VIBES_VERSION}?external=react,react-dom`;
  templateImports["use-vibes"] = `https://esm.sh/use-vibes@${STABLE_VIBES_VERSION}?external=react,react-dom`;

  return JSON.stringify({ imports: templateImports }, null, 6).replace(/^/gm, '  ').trim();
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
  // For main components (VibesSwitch, HiddenMenuWrapper, VibesButton),
  // we need both the .styles section and the component itself
  const stylesName = `${componentName}.styles`;

  // Pattern to extract section: starts at `// === Name ===` and goes until next `// ===` or end
  const extractSection = (name) => {
    const startMarker = `// === ${name} ===`;
    const startIdx = cacheContent.indexOf(startMarker);
    if (startIdx === -1) return null;

    // Find the end (next `// ===` marker or end of file)
    const contentStart = startIdx + startMarker.length;
    const nextMarkerMatch = cacheContent.slice(contentStart).match(/\n\/\/ === /);
    const endIdx = nextMarkerMatch
      ? contentStart + nextMarkerMatch.index
      : cacheContent.length;

    return cacheContent.slice(contentStart, endIdx).trim();
  };

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
  const cachePath = join(CACHE_DIR, "vibes-menu.js");

  if (!existsSync(cachePath)) {
    console.log("  Skipping template update: vibes-menu.js not cached");
    return { updated: [], failed: [], skipped: ["vibes-menu.js not cached"] };
  }

  const cacheContent = readFileSync(cachePath, "utf-8");

  // Templates and their components
  // Note: VibesPanel is a local component (not in upstream), so not synced
  const templates = [
    {
      path: join(PLUGIN_ROOT, "skills/vibes/templates/index.html"),
      components: ["VibesSwitch", "HiddenMenuWrapper", "VibesButton"]
    },
    {
      path: join(PLUGIN_ROOT, "skills/sell/templates/unified.html"),
      components: ["VibesSwitch", "HiddenMenuWrapper", "VibesButton"]
    }
  ];

  const updated = [];
  const failed = [];
  const skipped = [];

  for (const template of templates) {
    if (!existsSync(template.path)) {
      skipped.push(template.path.replace(PLUGIN_ROOT + "/", ""));
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
        console.warn(`  Warning: Missing markers for ${componentName} in ${template.path.replace(PLUGIN_ROOT + "/", "")}`);
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
      try {
        writeFileSync(template.path, content, "utf-8");
        updated.push(template.path.replace(PLUGIN_ROOT + "/", ""));
      } catch (err) {
        failed.push(template.path.replace(PLUGIN_ROOT + "/", ""));
      }
    }
  }

  return { updated, failed, skipped };
}

/**
 * Update import maps in skill/agent files
 */
function updateSkillImportMaps(imports) {
  const updated = [];
  const failed = [];

  const filesToUpdate = [
    join(PLUGIN_ROOT, "skills/vibes/SKILL.md"),
  ];

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
        updated.push(filePath.replace(PLUGIN_ROOT + "/", ""));
      }
    } catch (error) {
      failed.push(filePath.replace(PLUGIN_ROOT + "/", ""));
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
    const cachePath = join(CACHE_DIR, "import-map.json");
    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
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
        const cachePath = join(CACHE_DIR, "import-map.json");
        if (existsSync(cachePath)) {
          const content = JSON.parse(readFileSync(cachePath, "utf-8"));
          console.log(`  import-map: ${Object.keys(content.imports).length} entries, updated ${content.lastUpdated}`);
        }
      } else if (result.name === "vibes-menu") {
        const cachePath = join(CACHE_DIR, "vibes-menu.js");
        if (existsSync(cachePath)) {
          const content = readFileSync(cachePath, "utf-8");
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
  const importMapPath = join(CACHE_DIR, "import-map.json");
  if (existsSync(importMapPath)) {
    const cache = JSON.parse(readFileSync(importMapPath, "utf-8"));
    const lastUpdated = new Date(cache.lastUpdated);
    const daysSinceUpdate = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate > 30) {
      console.warn(`\nWarning: Cache is ${daysSinceUpdate} days old. Consider running with --force to update.`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
