#!/usr/bin/env node
/**
 * Deploy Vibes app to Cloudflare Workers
 *
 * Usage:
 *   node scripts/deploy-cloudflare.js --name myapp --file index.html
 *
 * Automatically copies:
 *   - index.html to public/
 *   - bundles/*.js to public/ (fireproof-clerk-bundle.js workaround)
 *   - assets/ to public/assets/ (images, icons)
 */

import { execSync } from "child_process";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve plugin root (works in dev and installed modes)
function resolvePluginRoot() {
  if (process.env.VIBES_PLUGIN_ROOT) {
    return process.env.VIBES_PLUGIN_ROOT;
  }
  // Check if we're in the plugin directory
  const devPath = resolve(__dirname, "..");
  if (existsSync(join(devPath, "skills", "cloudflare"))) {
    return devPath;
  }
  // Claude Code plugin cache location
  const pluginCache = join(homedir(), ".claude/plugins/cache/vibes-cli/vibes");
  if (existsSync(pluginCache)) {
    const versions = readdirSync(pluginCache).filter(
      (f) => !f.startsWith(".") && statSync(join(pluginCache, f)).isDirectory()
    );
    if (versions.length > 0) {
      return join(pluginCache, versions[versions.length - 1]);
    }
  }
  // Standard install location
  const vibesPath = join(homedir(), ".vibes");
  if (existsSync(join(vibesPath, "skills", "cloudflare"))) {
    return vibesPath;
  }
  return devPath;
}

const PLUGIN_ROOT = resolvePluginRoot();
const WORKER_DIR = resolve(PLUGIN_ROOT, "skills/cloudflare/worker");

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...options });
}

/**
 * Recursively copy a directory
 */
function copyDirRecursive(src, dest) {
  if (!existsSync(src)) return;

  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
      console.log(`  Copied ${entry}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const nameIdx = args.indexOf("--name");
  const fileIdx = args.indexOf("--file");

  if (nameIdx === -1) {
    console.error("Usage: deploy-cloudflare.js --name <app-name> --file <index.html>");
    process.exit(1);
  }

  const name = args[nameIdx + 1];
  const file = fileIdx !== -1 ? args[fileIdx + 1] : "index.html";

  console.log(`Deploying ${name} to Cloudflare Workers...`);
  console.log(`Plugin root: ${PLUGIN_ROOT}`);

  // Ensure public directory exists
  const publicDir = resolve(WORKER_DIR, "public");
  mkdirSync(publicDir, { recursive: true });

  // 1. Copy the HTML file to public/
  const srcFile = resolve(process.cwd(), file);
  if (!existsSync(srcFile)) {
    console.error(`File not found: ${srcFile}`);
    process.exit(1);
  }
  const destFile = resolve(publicDir, "index.html");
  console.log(`\nCopying ${basename(srcFile)} to public/`);
  copyFileSync(srcFile, destFile);

  // 2. Copy bundles/ to public/ (e.g., fireproof-clerk-bundle.js)
  const bundlesDir = resolve(PLUGIN_ROOT, "bundles");
  if (existsSync(bundlesDir)) {
    console.log(`\nCopying bundles/ to public/`);
    for (const entry of readdirSync(bundlesDir)) {
      const srcPath = join(bundlesDir, entry);
      if (!statSync(srcPath).isDirectory() && entry.endsWith(".js")) {
        copyFileSync(srcPath, join(publicDir, entry));
        console.log(`  Copied ${entry}`);
      }
    }
  }

  // 3. Copy assets/ to public/assets/ (images, favicons, etc.)
  const assetsDir = resolve(PLUGIN_ROOT, "assets");
  const publicAssetsDir = resolve(publicDir, "assets");
  if (existsSync(assetsDir)) {
    console.log(`\nCopying assets/ to public/assets/`);
    copyDirRecursive(assetsDir, publicAssetsDir);
  }

  // Install dependencies if needed
  const nodeModules = resolve(WORKER_DIR, "node_modules");
  if (!existsSync(nodeModules)) {
    console.log("\nInstalling dependencies...");
    run("npm install", { cwd: WORKER_DIR });
  }

  // Deploy with wrangler
  console.log("\nDeploying to Cloudflare...");
  run(`npx wrangler deploy --name ${name}`, { cwd: WORKER_DIR });

  console.log(`\n✅ Deployed to https://${name}.workers.dev`);
}

main();
