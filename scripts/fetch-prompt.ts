#!/usr/bin/env bun
/**
 * Vibes DIY Sync Script
 *
 * Fetches documentation and import map configuration from upstream sources
 * and caches locally for fast skill invocation.
 *
 * Usage:
 *   bun scripts/fetch-prompt.ts          # Fetch only if cache is empty
 *   bun scripts/fetch-prompt.ts --force  # Force refresh all cached docs
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";

// Get the plugin root directory (parent of scripts/)
const PLUGIN_ROOT = dirname(import.meta.dir);
const CACHE_DIR = join(PLUGIN_ROOT, "cache");

// Documentation sources
const DOC_SOURCES: Record<string, string> = {
  fireproof: "https://use-fireproof.com/llms-full.txt",
  // Add other module documentation URLs as needed
  // callai: "https://raw.githubusercontent.com/user/call-ai/main/llms.txt",
};

// Style prompt source
const STYLE_PROMPT_URL = "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/prompts/pkg/style-prompts.ts";

// Import map source
const IMPORT_MAP_URL = "https://raw.githubusercontent.com/VibesDIY/vibes.diy/main/vibes.diy/pkg/app/config/import-map.ts";

interface FetchResult {
  name: string;
  success: boolean;
  cached: boolean;
  error?: string;
}

interface ImportMapCache {
  lastUpdated: string;
  source: string;
  imports: Record<string, string>;
}

async function fetchDoc(name: string, url: string, force: boolean): Promise<FetchResult> {
  const cachePath = join(CACHE_DIR, `${name}.txt`);

  // Check if cached version exists and we're not forcing refresh
  if (!force && existsSync(cachePath)) {
    return { name, success: true, cached: true };
  }

  try {
    console.log(`Fetching ${name} from ${url}...`);
    const response = await fetch(url);

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
 * Parse the import-map.ts file from vibes.diy and extract the import map
 */
function parseImportMapTs(content: string): Record<string, string> {
  const imports: Record<string, string> = {};

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
 * Parse the style-prompts.ts file and extract the default style prompt
 */
function parseStylePromptsTs(content: string): string {
  // Find the DEFAULT_STYLE_NAME
  const defaultNameMatch = content.match(/DEFAULT_STYLE_NAME\s*=\s*["']([^"']+)["']/);
  const defaultName = defaultNameMatch ? defaultNameMatch[1] : "brutalist web";

  // Find the stylePrompts array and extract the prompt for the default style
  // Match the style object with the matching name
  const styleRegex = new RegExp(
    `\\{\\s*name:\\s*["']${defaultName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*,\\s*prompt:\\s*(['"\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`,
    's'
  );

  const match = content.match(styleRegex);
  if (match) {
    // Unescape the string
    return match[2]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  // Fallback: try to extract any prompt that looks like the brutalist one
  const fallbackMatch = content.match(/prompt:\s*['"`](Create a UI theme in a neo-brutalist style[^'"`]*)['"]/s);
  if (fallbackMatch) {
    return fallbackMatch[1];
  }

  return "";
}

async function fetchStylePrompt(force: boolean): Promise<FetchResult> {
  const cachePath = join(CACHE_DIR, "style-prompt.txt");

  // Check if cached version exists and we're not forcing refresh
  if (!force && existsSync(cachePath)) {
    return { name: "style-prompt", success: true, cached: true };
  }

  try {
    console.log(`Fetching style-prompt from ${STYLE_PROMPT_URL}...`);
    const response = await fetch(STYLE_PROMPT_URL);

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

async function fetchImportMap(force: boolean): Promise<FetchResult> {
  const cachePath = join(CACHE_DIR, "import-map.json");

  // Check if cached version exists and we're not forcing refresh
  if (!force && existsSync(cachePath)) {
    return { name: "import-map", success: true, cached: true };
  }

  try {
    console.log(`Fetching import-map from ${IMPORT_MAP_URL}...`);
    const response = await fetch(IMPORT_MAP_URL);

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

    const cache: ImportMapCache = {
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
 * Generate the import map JSON string for templates
 * Must match vibes.diy import map EXACTLY - including absolute URL mappings
 * that prevent duplicate module instances
 */
function generateImportMapJson(imports: Record<string, string>): string {
  const reactDomUrl = imports["react-dom"] || "https://esm.sh/react-dom@19";
  const reactVersion = reactDomUrl.match(/@(\d+\.\d+\.\d+)/)?.[1] || "19";

  // Get the use-vibes URL for remapping
  const useVibesUrl = imports["use-vibes"] || imports["use-fireproof"];

  const templateImports: Record<string, string> = {
    "react": `https://esm.sh/react@${reactVersion}`,
    "react-dom": imports["react-dom"],
    "react-dom/client": imports["react-dom/client"],
    "react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime`,
  };

  // Add use-fireproof (match vibes.diy exactly)
  if (imports["use-fireproof"]) {
    templateImports["use-fireproof"] = imports["use-fireproof"];
  }

  // Add call-ai (match vibes.diy exactly)
  if (imports["call-ai"]) {
    templateImports["call-ai"] = imports["call-ai"];
  }

  // Add use-vibes direct mapping (match vibes.diy exactly)
  if (imports["use-vibes"]) {
    templateImports["use-vibes"] = imports["use-vibes"];
  }

  // Add absolute URL remappings - these prevent duplicate module instances
  // by ensuring internal imports resolve to the same module
  if (useVibesUrl) {
    templateImports["https://esm.sh/use-fireproof"] = useVibesUrl;
    templateImports["https://esm.sh/use-vibes"] = useVibesUrl;
  }

  return JSON.stringify({ imports: templateImports }, null, 6).replace(/^/gm, '  ').trim();
}

/**
 * Update import maps in skill/agent files
 */
function updateSkillImportMaps(imports: Record<string, string>): { updated: string[], failed: string[] } {
  const updated: string[] = [];
  const failed: string[] = [];

  const filesToUpdate = [
    join(PLUGIN_ROOT, "skills/vibes/SKILL.md"),
    join(PLUGIN_ROOT, "agents/vibes-gen.md"),
  ];

  // Regex to match import map script blocks
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

  // Ensure cache directory exists
  mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`Vibes DIY Sync`);
  console.log(`Cache directory: ${CACHE_DIR}`);
  console.log(`Force refresh: ${force}`);
  console.log("");

  const results: FetchResult[] = [];

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

  // Update skill files with new import map
  if (importMapResult.success && !importMapResult.cached) {
    const cachePath = join(CACHE_DIR, "import-map.json");
    const cache = JSON.parse(readFileSync(cachePath, "utf-8")) as ImportMapCache;
    const { updated, failed } = updateSkillImportMaps(cache.imports);

    if (updated.length > 0) {
      console.log(`\nUpdated import maps in:`);
      for (const file of updated) {
        console.log(`  - ${file}`);
      }
    }
    if (failed.length > 0) {
      console.log(`\nFailed to update:`);
      for (const file of failed) {
        console.log(`  - ${file}`);
      }
    }
  }

  // Summary
  console.log("\nSummary:");
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const fromCache = results.filter(r => r.cached);

  console.log(`  Total: ${results.length}`);
  console.log(`  Fetched: ${successful.length - fromCache.length}`);
  console.log(`  From cache: ${fromCache.length}`);

  if (failed.length > 0) {
    console.log(`  Failed: ${failed.length}`);
    for (const f of failed) {
      console.log(`    - ${f.name}: ${f.error}`);
    }
    process.exit(1);
  }

  // If verbose, show cached file info
  if (verbose) {
    console.log("\nCached files:");
    for (const result of successful) {
      if (result.name === "import-map") {
        const cachePath = join(CACHE_DIR, "import-map.json");
        if (existsSync(cachePath)) {
          const content = JSON.parse(readFileSync(cachePath, "utf-8"));
          console.log(`  import-map: ${Object.keys(content.imports).length} entries, updated ${content.lastUpdated}`);
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
    const cache = JSON.parse(readFileSync(importMapPath, "utf-8")) as ImportMapCache;
    const lastUpdated = new Date(cache.lastUpdated);
    const daysSinceUpdate = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceUpdate > 30) {
      console.log(`\nWarning: Cache is ${daysSinceUpdate} days old. Consider running with --force to update.`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
