#!/usr/bin/env node
/**
 * Build Design Tokens
 *
 * Generates CSS and AI documentation from the single source of truth
 * in scripts/lib/design-tokens.js.
 *
 * Outputs:
 *   build/design-tokens.css — :root {} + theme CSS (injected into template)
 *   build/design-tokens.txt — AI-readable documentation (read at generation time)
 *
 * Usage:
 *   bun scripts/build-design-tokens.js
 *   bun scripts/build-design-tokens.js --force  # Rebuild even if output exists
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  TOKEN_CATALOG,
  VIBES_THEME_CSS,
  DOC_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
} from "./lib/design-tokens.js";
import {
  COMPONENT_CATALOG,
  generateComponentDocs,
} from "./lib/component-catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Plugin root is one level up from scripts/
const PLUGIN_ROOT = join(__dirname, "..");
const BUILD_DIR = join(PLUGIN_ROOT, "build");
const CSS_OUTPUT = join(BUILD_DIR, "design-tokens.css");
const TXT_OUTPUT = join(BUILD_DIR, "design-tokens.txt");

/**
 * Generate the :root {} CSS block from TOKEN_CATALOG
 */
function generateRootCSS() {
  let lines = ["      :root {"];

  for (const [category, tokens] of Object.entries(TOKEN_CATALOG)) {
    lines.push(`        /* ${category} */`);
    for (const [prop, value] of Object.entries(tokens)) {
      lines.push(`        ${prop}: ${value};`);
    }
    lines.push("");
  }

  // Remove trailing empty line before closing brace
  if (lines[lines.length - 1] === "") lines.pop();
  lines.push("      }");

  return lines.join("\n");
}

/**
 * Generate build/design-tokens.css
 * Contains the :root {} block + VIBES_THEME_CSS
 */
function generateCSS() {
  const rootBlock = generateRootCSS();
  return rootBlock + "\n" + VIBES_THEME_CSS;
}

/**
 * Generate build/design-tokens.txt (AI documentation)
 */
function generateTXT() {
  let lines = [];

  lines.push("# Vibes Design Token Catalog");
  lines.push("");
  lines.push("Define these as CSS custom properties in :root {}. Use `var(--token-name)` in generated code.");
  lines.push("");
  lines.push("## How to Use");
  lines.push("");
  lines.push("```jsx");
  lines.push("{/* In Tailwind arbitrary values */}");
  lines.push('<div className="bg-[var(--color-background)] text-[var(--color-text)] rounded-[var(--radius-lg)] p-[var(--spacing-4)]">');
  lines.push("");
  lines.push("{/* In inline styles */}");
  lines.push("<button style={{ background: 'var(--vibes-button-bg)', boxShadow: 'var(--shadow-brutalist-blue)' }}>");
  lines.push("");
  lines.push("{/* Override in a <style> block for app-specific themes */}");
  lines.push("<style>{`:root { --color-primary: oklch(0.6 0.2 280); }`}</style>");
  lines.push("```");
  lines.push("");
  lines.push('BUTTON USAGE: Use `className="btn"` for default blue buttons. Variants: `btn-red`, `btn-yellow`, `btn-gray`.');
  lines.push('Example: `<button className="btn">Click Me</button>` or `<button className="btn btn-red">Delete</button>`');
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Token Groups");

  for (const category of DOC_CATEGORIES) {
    const tokens = TOKEN_CATALOG[category];
    if (!tokens) continue;

    lines.push("");
    lines.push(`### ${category}`);
    lines.push("");

    const desc = CATEGORY_DESCRIPTIONS[category];
    if (desc) {
      lines.push(desc);
      lines.push("");
    }

    lines.push("```css");
    for (const [prop, value] of Object.entries(tokens)) {
      lines.push(`${prop}: ${value};`);
    }
    lines.push("```");
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## VIBES THEME CSS");
  lines.push("");
  lines.push("The template provides minimal structural styles. All visual design (backgrounds, shadows, typography treatment) is defined by the app's theme.");
  lines.push("");
  lines.push("Include these minimal structural CSS rules:");
  lines.push("");
  lines.push("```css");
  lines.push("body { margin: 0; padding: 0; }");
  lines.push("#container { position: relative; z-index: 2; width: 100%; min-height: 100vh; padding: 20px; }");
  lines.push("```");
  lines.push("");
  lines.push("**Buttons:** Use `className=\"btn\"` for structurally styled buttons. Variants: `btn-red`, `btn-yellow`, `btn-gray`.");
  lines.push('Example: `<button className="btn">Click Me</button>`');
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Rules for Generated Code");
  lines.push("");
  lines.push("1. **Use semantic `--color-*` tokens** for app surfaces, text, borders, and interactive elements.");
  lines.push('2. **Use `.btn` class** for buttons instead of hand-styling \u2014 add `btn-red`, `btn-yellow`, `btn-gray` for variants.');
  lines.push("3. **Use `--radius-*` tokens** for border-radius values.");
  lines.push("4. **Use `--shadow-*` tokens** for box-shadow \u2014 including `--shadow-brutalist-*` for neo-brutalist style.");
  lines.push("5. **Use `--spacing-*` tokens** for padding and margin where CSS custom properties are needed.");
  lines.push("6. **Use `--font-*` and `--text-*` tokens** for typography.");
  lines.push("7. **Override `--color-*` tokens** in a `:root` style block for per-app theming (light/dark, custom palette).");
  lines.push("8. **Don't redefine `--vibes-*` tokens** \u2014 those are system-level. Override `--color-*` tokens instead.");
  lines.push("9. **Tailwind is still available** for layout utilities (flex, grid, responsive breakpoints). Tokens and Tailwind complement each other.");
  lines.push("10. **Define your app's background** in a `:root` style block or on your root container div — the template provides no background.");
  lines.push("11. **Components are structurally styled** with token-based colors and layout. Add visual flair (shadows, text-transform, animations) in your theme CSS.");
  lines.push("");

  // Append component catalog documentation
  lines.push(generateComponentDocs());

  return lines.join("\n");
}

/**
 * Main function
 */
function main() {
  const force = process.argv.includes("--force");

  console.log("Build Design Tokens");
  console.log("");

  // Check if rebuild is needed
  if (!force && existsSync(CSS_OUTPUT) && existsSync(TXT_OUTPUT)) {
    console.log("Cache exists. Use --force to rebuild.");
    return;
  }

  // Ensure cache directory exists
  mkdirSync(BUILD_DIR, { recursive: true });

  // Generate CSS
  const css = generateCSS();
  writeFileSync(CSS_OUTPUT, css, "utf-8");
  console.log(`  Generated: ${CSS_OUTPUT} (${css.length} bytes)`);

  // Generate TXT
  const txt = generateTXT();
  writeFileSync(TXT_OUTPUT, txt, "utf-8");
  console.log(`  Generated: ${TXT_OUTPUT} (${txt.length} bytes)`);

  // Summary
  const categoryCount = Object.keys(TOKEN_CATALOG).length;
  const tokenCount = Object.values(TOKEN_CATALOG).reduce(
    (sum, group) => sum + Object.keys(group).length,
    0
  );
  const componentCount = Object.keys(COMPONENT_CATALOG).length;
  console.log(`\n  ${categoryCount} categories, ${tokenCount} tokens, ${componentCount} components`);
  console.log("\nDone!");
}

main();
