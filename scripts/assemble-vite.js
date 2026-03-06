#!/usr/bin/env node
/**
 * Vite Assembly Script for Connect-enabled Vibes Apps
 *
 * Takes user's JSX/TSX code and assembles it into a Vite project,
 * then builds it for deployment.
 *
 * Usage:
 *   node scripts/assemble-vite.js <input.jsx> <output-dir> [options]
 *
 * Options:
 *   --api-url <url>    Token API URL (default: from .env or localhost)
 *   --cloud-url <url>  Cloud sync URL (default: from .env or localhost)
 *   --oidc-authority <url>  OIDC authority URL
 *   --db-name <name>   Database name (default: vibes-app)
 *   --skip-build       Skip npm build step (for testing)
 *
 * Example:
 *   node scripts/assemble-vite.js app.jsx ./build \
 *     --oidc-authority https://vibes-connect.exe.xyz/auth \
 *     --api-url https://vibes-connect.exe.xyz/api \
 *     --cloud-url fpcloud://vibes-connect.exe.xyz/backend?protocol=wss
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { parseArgs as parseCliArgs, formatHelp } from './lib/cli-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the plugin directory (where templates live)
const findPluginDir = async () => {
  try {
    const { findPluginDirectory } = await import('./find-plugin.js');
    return await findPluginDirectory();
  } catch {
    // Fallback to relative path from scripts/
    return join(__dirname, '..');
  }
};

const assembleViteSchema = [
  { name: 'apiUrl', flag: '--api-url', type: 'string', description: 'Token API URL (Fireproof dashboard)' },
  { name: 'cloudUrl', flag: '--cloud-url', type: 'string', description: 'Cloud sync URL (fpcloud:// protocol)' },
  { name: 'oidcAuthority', flag: '--oidc-authority', type: 'string', description: 'OIDC authority URL' },
  { name: 'dbName', flag: '--db-name', type: 'string', default: 'vibes-app', description: 'Database name (default: vibes-app)' },
  { name: 'skipBuild', flag: '--skip-build', type: 'boolean', description: 'Skip npm build step (for testing)' },
];

const assembleViteMeta = {
  name: 'Vite Assembly Script for Connect-enabled Vibes Apps',
  description: 'Takes user\'s JSX/TSX code and assembles it into a Vite project for deployment.',
  usage: 'node scripts/assemble-vite.js <input.jsx> <output-dir> [options]',
  examples: [
    'node scripts/assemble-vite.js app.jsx ./build \\',
    '  --oidc-authority https://vibes-connect.exe.xyz/auth \\',
    '  --api-url https://vibes-connect.exe.xyz/api \\',
    '  --cloud-url fpcloud://vibes-connect.exe.xyz/backend?protocol=wss',
  ],
};

function parseArgs(argv) {
  const { args, positionals } = parseCliArgs(assembleViteSchema, argv.slice(2));

  // Map positionals to input and outputDir
  args.input = positionals[0] || null;
  args.outputDir = positionals[1] || null;

  // Map _help to help for backward compatibility
  args.help = args._help || false;
  delete args._help;
  delete args._errors;

  return args;
}

function printHelp() {
  console.log('\n' + formatHelp(assembleViteMeta, assembleViteSchema));
}

/**
 * Transform JSX to TSX for Vite compatibility
 * - Replaces use-fireproof imports with @fireproof/oidc (via backward-compat alias useFireproofOIDC)
 * - Replaces useFireproof with useFireproofOIDC
 * - Preserves the structure
 */
function transformJsxToTsx(jsxCode, dbName) {
  let code = jsxCode;

  // First, replace use-fireproof imports with the OIDC package
  code = code.replace(
    /from\s+["']use-fireproof["']/g,
    'from "@fireproof/oidc"'
  );

  // Replace useFireproof with useFireproofOIDC (backward-compat alias) if not already
  code = code.replace(/\buseFireproof\b(?!Clerk)/g, 'useFireproofOIDC');

  // Replace any hardcoded database name with the provided one
  // Look for patterns like useFireproofOIDC("something")
  // But only if a specific db name was provided (not default)
  if (dbName !== 'vibes-app') {
    code = code.replace(
      /useFireproofOIDC\s*\(\s*["']([^"']+)["']\s*\)/g,
      `useFireproofOIDC("${dbName}")`
    );
  }

  // If no fireproof import exists, add it (useFireproofOIDC is the backward-compat alias)
  if (!code.includes('@fireproof/oidc')) {
    code = `import { useFireproofOIDC, UserButton, useUser } from "@fireproof/oidc";\n${code}`;
  }

  return code;
}

/**
 * Extract the main component name from JSX code
 */
function extractComponentName(code) {
  // Look for export default function ComponentName
  const defaultExportMatch = code.match(/export\s+default\s+function\s+(\w+)/);
  if (defaultExportMatch) return defaultExportMatch[1];

  // Look for export function ComponentName (first one)
  const namedExportMatch = code.match(/export\s+function\s+(\w+)/);
  if (namedExportMatch) return namedExportMatch[1];

  // Look for function App or function Main
  const commonMatch = code.match(/function\s+(App|Main|UserApp)\s*\(/);
  if (commonMatch) return commonMatch[1];

  return 'UserApp';
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.input || !args.outputDir) {
    console.error('Error: Both input file and output directory are required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Validate input file exists
  if (!existsSync(args.input)) {
    console.error(`Error: Input file not found: ${args.input}`);
    process.exit(1);
  }

  console.log('\n=== Vite Assembly for Connect Apps ===\n');
  console.log(`  Input: ${args.input}`);
  console.log(`  Output: ${args.outputDir}`);
  if (args.oidcAuthority) console.log(`  OIDC Authority: ${args.oidcAuthority}`);
  if (args.apiUrl) console.log(`  API URL: ${args.apiUrl}`);
  if (args.cloudUrl) console.log(`  Cloud URL: ${args.cloudUrl}`);
  console.log(`  DB Name: ${args.dbName}`);
  console.log();

  try {
    // Find template directory
    const pluginDir = await findPluginDir();
    const templateDir = join(pluginDir, 'skills/vibes/templates/vite-connect');

    if (!existsSync(templateDir)) {
      throw new Error(`Template directory not found: ${templateDir}`);
    }

    // Clean and create output directory
    if (existsSync(args.outputDir)) {
      console.log('  Cleaning existing output directory...');
      rmSync(args.outputDir, { recursive: true, force: true });
    }
    mkdirSync(args.outputDir, { recursive: true });

    // Copy template to output directory
    console.log('  Copying Vite template...');
    cpSync(templateDir, args.outputDir, { recursive: true });

    // Read and transform user's JSX code
    console.log('  Transforming user code...');
    const userCode = readFileSync(args.input, 'utf-8');
    const transformedCode = transformJsxToTsx(userCode, args.dbName);
    const componentName = extractComponentName(transformedCode);

    // Write transformed code as UserApp.tsx
    const userAppPath = join(args.outputDir, 'src/UserApp.tsx');

    // If the code has a default export, we need to re-export it as UserApp
    let finalCode = transformedCode;
    if (transformedCode.includes('export default')) {
      // Replace export default with named export
      finalCode = transformedCode.replace(
        /export\s+default\s+function\s+(\w+)/,
        'export function UserApp'
      );
    } else if (componentName !== 'UserApp') {
      // Add an alias export
      finalCode = transformedCode + `\n\nexport { ${componentName} as UserApp };\n`;
    }

    writeFileSync(userAppPath, finalCode);
    console.log(`  ✓ User code written to src/UserApp.tsx`);

    // Create .env file with configuration
    console.log('  Creating .env configuration...');
    const envContent = [
      args.oidcAuthority ? `VITE_OIDC_AUTHORITY=${args.oidcAuthority}` : '# VITE_OIDC_AUTHORITY=https://your-studio.exe.xyz/auth',
      args.apiUrl ? `VITE_API_URL=${args.apiUrl}` : '# VITE_API_URL=http://localhost:8080/api/',
      args.cloudUrl ? `VITE_CLOUD_URL=${args.cloudUrl}` : '# VITE_CLOUD_URL=fpcloud://localhost:8080?protocol=ws'
    ].join('\n') + '\n';

    writeFileSync(join(args.outputDir, '.env'), envContent);
    console.log('  ✓ .env created');

    // Install dependencies and build
    if (!args.skipBuild) {
      console.log('  Installing dependencies...');
      execSync('npm install', {
        cwd: args.outputDir,
        stdio: 'pipe',
        timeout: 120000
      });
      console.log('  ✓ Dependencies installed');

      console.log('  Building with Vite...');
      execSync('npm run build', {
        cwd: args.outputDir,
        stdio: 'pipe',
        timeout: 120000
      });
      console.log('  ✓ Build complete');

      console.log(`\n  Output: ${join(args.outputDir, 'dist/')}`);
      console.log('  Deploy this folder to your server.\n');
    } else {
      console.log('\n  Skipped build step (--skip-build)');
      console.log(`  To build manually: cd ${args.outputDir} && npm install && npm run build\n`);
    }

  } catch (err) {
    console.error(`\n✗ Assembly failed: ${err.message}`);
    if (err.stderr) {
      console.error('stderr:', err.stderr.toString());
    }
    process.exit(1);
  }
}

main();
