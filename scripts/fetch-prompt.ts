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

// Import map source
const IMPORT_MAP_URL = "https://raw.githubusercontent.com/vibes-diy/vibes.diy/main/vibes.diy/pkg/app/config/import-map.ts";

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
  // Match patterns like: "react": "https://esm.sh/react@19.2.1"
  const staticMatches = content.matchAll(/"([^"]+)":\s*"(https:\/\/[^"]+)"/g);
  for (const match of staticMatches) {
    imports[match[1]] = match[2];
  }

  // Match patterns with template literals: "use-fireproof": `https://esm.sh/use-vibes@${VIBES_VERSION}`
  const templateMatches = content.matchAll(/"([^"]+)":\s*`(https:\/\/[^`]+)\$\{VIBES_VERSION\}`/g);
  for (const match of templateMatches) {
    imports[match[1]] = match[2] + vibesVersion;
  }

  return imports;
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

  // Fetch import map
  const importMapResult = await fetchImportMap(force);
  results.push(importMapResult);

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
