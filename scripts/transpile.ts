#!/usr/bin/env bun

/**
 * Transpile TSX source files to React.createElement syntax using Bun
 *
 * This script:
 * 1. Reads TSX/TS files from src/vibes-menu/
 * 2. Uses Bun's built-in transpiler (no Babel needed!)
 * 3. Converts JSX → React.createElement
 * 4. Strips TypeScript types
 * 5. Outputs combined JavaScript to cache/vibes-menu-transpiled.js
 *
 * Usage: bun scripts/transpile.ts
 * Or after compilation: ./bin/transpile
 */

import { resolve, dirname, basename, join } from "path";

// Determine project root
// When running as compiled binary, use current working directory
// When running via bun directly, use the script location
function getProjectRoot(): string {
  // Check if we're running as a compiled binary
  // Compiled binaries have Bun.main starting with /$bunfs/
  if (Bun.main.startsWith("/$bunfs/")) {
    return process.cwd();
  }
  // Running via `bun scripts/transpile.ts`
  return resolve(dirname(Bun.main), "..");
}

const projectRoot = getProjectRoot();
const SRC_DIR = join(projectRoot, "src/vibes-menu");
const OUTPUT_FILE = join(projectRoot, "cache/vibes-menu-transpiled.js");

// Files to transpile in dependency order
const FILES = [
  "VibesSwitch.styles.ts",
  "VibesSwitch.tsx",
  "HiddenMenuWrapper.styles.ts",
  "HiddenMenuWrapper.tsx",
];

async function transpileFile(filePath: string): Promise<string> {
  const source = await Bun.file(filePath).text();

  // Use Bun's built-in transpiler
  const transpiler = new Bun.Transpiler({
    loader: filePath.endsWith(".tsx") ? "tsx" : "ts",
    // Use classic runtime for React.createElement instead of automatic JSX transform
    tsconfig: {
      compilerOptions: {
        jsx: "react",
        jsxFactory: "React.createElement",
        jsxFragmentFactory: "React.Fragment",
      },
    },
  });

  return transpiler.transformSync(source);
}

function processImports(code: string): string {
  return code
    // Remove local file imports (we're inlining everything)
    .replace(/import\s+.*from\s+["']\.\/[^"']+["'];?\n?/g, "")
    // Remove React imports (will be available globally in the browser)
    .replace(/import\s+React.*from\s+["']react["'];?\n?/g, "")
    .replace(/import\s+\{[^}]+\}\s+from\s+["']react["'];?\n?/g, "")
    // Remove type-only imports
    .replace(/import\s+type\s+.*from\s+["'][^"']+["'];?\n?/g, "")
    // Remove export keywords (we'll use these as internal functions)
    .replace(/^export\s+/gm, "");
}

async function main() {
  console.log("Transpiling vibes-menu components with Bun...\n");

  let combinedOutput = `// Auto-generated from src/vibes-menu/
// Run: ./bin/transpile (or bun scripts/transpile.ts) to regenerate
// Source: https://github.com/VibesDIY/vibes.diy/tree/main/vibes.diy/pkg/app/components/vibes
// Generated: ${new Date().toISOString()}

`;

  for (const file of FILES) {
    const filePath = join(SRC_DIR, file);

    const exists = await Bun.file(filePath).exists();
    if (!exists) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }

    console.log(`  Transpiling ${file}...`);

    let transpiled = await transpileFile(filePath);
    transpiled = processImports(transpiled);

    combinedOutput += `// === ${file} ===\n${transpiled}\n\n`;
  }

  // Ensure output directory exists
  const outputDir = dirname(OUTPUT_FILE);
  await Bun.write(join(outputDir, ".gitkeep"), "");

  await Bun.write(OUTPUT_FILE, combinedOutput);

  console.log(`\nOutput written to: ${OUTPUT_FILE}`);
  console.log("\nTo use in templates:");
  console.log("  1. Copy the transpiled code into the <script type=\"module\"> section");
  console.log("  2. Ensure React is imported at the top");
  console.log("  3. Use VibesSwitch and HiddenMenuWrapper components");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
