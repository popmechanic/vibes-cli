#!/usr/bin/env node

/**
 * update.js - Deterministic Vibes app updater
 *
 * Usage:
 *   node update.js path/to/app.html          # Analyze (dry-run)
 *   node update.js path/to/app.html --apply  # Apply all updates
 *   node update.js path/to/app.html --apply=1,2  # Apply specific updates
 *   node update.js ./apps/                   # Batch analyze directory
 *   node update.js --rollback path/to/app.html  # Restore from backup
 *   node update.js path/to/app.html --verbose   # Show diffs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, copyFileSync } from 'fs';
import { resolve, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { analyze, analyzeMultiple } from './lib/analyze.js';
import { compare } from './lib/compare.js';
import { generatePlan, formatPlanOutput, formatBatchSummary, filterUpdates, colors } from './lib/plan.js';
import { getApplicableUpdates, executeUpdate, getUpdateById } from './updates/registry.js';

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const result = {
    targets: [],
    apply: false,
    applySelection: null,
    rollback: false,
    verbose: false,
    force: false,
    json: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--apply') {
      result.apply = true;
      result.applySelection = 'all';
    } else if (arg.startsWith('--apply=')) {
      result.apply = true;
      result.applySelection = arg.slice(8);
    } else if (arg === '--rollback') {
      result.rollback = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
    } else if (arg === '--json') {
      result.json = true;
    } else if (!arg.startsWith('-')) {
      result.targets.push(arg);
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${colors.bold}vibes update${colors.reset} - Deterministic app updater

${colors.bold}Usage:${colors.reset}
  node update.js <path> [options]

${colors.bold}Arguments:${colors.reset}
  <path>           Path to HTML file or directory to scan

${colors.bold}Options:${colors.reset}
  --apply          Apply all recommended updates
  --apply=1,2      Apply specific updates by number
  --rollback       Restore from .bak backup file
  --verbose, -v    Show detailed diffs
  --force, -f      Skip confirmation prompts
  --json           Output as JSON
  --help, -h       Show this help message

${colors.bold}Examples:${colors.reset}
  node update.js app.html           # Analyze app.html (dry-run)
  node update.js app.html --apply   # Apply all updates
  node update.js ./apps/            # Batch analyze directory
  node update.js --rollback app.html  # Restore from backup

${colors.bold}Notes:${colors.reset}
  - By default, runs in dry-run mode (no changes made)
  - Creates .bak backup before applying updates
  - Use --rollback to restore from backup
`);
}

/**
 * Find HTML files in a directory
 */
function findHtmlFiles(dirPath) {
  const files = [];
  const entries = readdirSync(dirPath);

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isFile() && extname(entry).toLowerCase() === '.html') {
      // Skip backup files
      if (!entry.endsWith('.bak.html')) {
        files.push(fullPath);
      }
    } else if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
      // Recurse into subdirectories
      files.push(...findHtmlFiles(fullPath));
    }
  }

  return files;
}

/**
 * Create backup of file
 */
function createBackup(filePath) {
  const backupPath = filePath.replace(/\.html$/, '.bak.html');
  copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Restore file from backup
 */
function restoreFromBackup(filePath) {
  const backupPath = filePath.replace(/\.html$/, '.bak.html');

  if (!existsSync(backupPath)) {
    return {
      success: false,
      error: `Backup file not found: ${backupPath}`
    };
  }

  copyFileSync(backupPath, filePath);
  return {
    success: true,
    backupPath
  };
}

/**
 * Process a single file
 */
function processFile(filePath, options) {
  const resolvedPath = resolve(filePath);

  // Check file exists
  if (!existsSync(resolvedPath)) {
    return {
      success: false,
      error: `File not found: ${resolvedPath}`
    };
  }

  // Read file
  let html;
  try {
    html = readFileSync(resolvedPath, 'utf-8');
  } catch (e) {
    return {
      success: false,
      error: `Could not read file: ${e.message}`
    };
  }

  // Analyze
  const analysis = analyze(resolvedPath);
  if (!analysis.success) {
    return {
      success: false,
      error: analysis.error
    };
  }

  // Compare
  const comparison = compare(analysis);
  if (!comparison.success) {
    return {
      success: false,
      error: comparison.error
    };
  }

  // Generate plan
  const plan = generatePlan(comparison);

  // If not applying, just return the plan
  if (!options.apply) {
    return {
      success: true,
      mode: 'analyze',
      plan,
      output: formatPlanOutput(plan, options)
    };
  }

  // Filter updates if selection specified
  const updatesToApply = filterUpdates(plan, options.applySelection);

  if (updatesToApply.length === 0) {
    return {
      success: true,
      mode: 'apply',
      appliedCount: 0,
      output: `${colors.yellow}No updates to apply${colors.reset}`
    };
  }

  // Create backup
  const backupPath = createBackup(resolvedPath);
  console.log(`${colors.dim}Backup created: ${backupPath}${colors.reset}`);

  // Apply updates
  let currentHtml = html;
  const applied = [];
  const failed = [];

  for (const update of updatesToApply) {
    const updateDef = getUpdateById(update.id);
    if (!updateDef) {
      failed.push({ id: update.id, error: 'Update not found in registry' });
      continue;
    }

    const result = executeUpdate(updateDef, currentHtml, analysis, comparison);

    if (result.success) {
      currentHtml = result.html;
      applied.push({
        id: update.id,
        name: update.name,
        diff: options.verbose ? result.diff : null
      });
    } else {
      failed.push({ id: update.id, name: update.name, error: result.error });
    }
  }

  // Write updated file
  if (applied.length > 0) {
    writeFileSync(resolvedPath, currentHtml, 'utf-8');
  }

  // Format output
  const lines = [];
  lines.push('');
  lines.push(`${colors.bold}Applied updates to:${colors.reset} ${basename(resolvedPath)}`);
  lines.push('');

  if (applied.length > 0) {
    lines.push(`${colors.green}✓ Applied (${applied.length}):${colors.reset}`);
    for (const a of applied) {
      lines.push(`    ${a.name}`);
      if (options.verbose && a.diff) {
        lines.push(`    ${colors.dim}${JSON.stringify(a.diff).slice(0, 100)}...${colors.reset}`);
      }
    }
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push(`${colors.red}✗ Failed (${failed.length}):${colors.reset}`);
    for (const f of failed) {
      lines.push(`    ${f.name || f.id}: ${f.error}`);
    }
    lines.push('');
  }

  lines.push(`${colors.dim}Backup: ${backupPath}${colors.reset}`);
  lines.push(`${colors.dim}Use --rollback to restore${colors.reset}`);
  lines.push('');

  return {
    success: true,
    mode: 'apply',
    applied,
    failed,
    backupPath,
    output: lines.join('\n')
  };
}

/**
 * Process batch of files
 */
function processBatch(dirPath, options) {
  const resolvedPath = resolve(dirPath);

  if (!existsSync(resolvedPath)) {
    return {
      success: false,
      error: `Directory not found: ${resolvedPath}`
    };
  }

  const stat = statSync(resolvedPath);
  if (!stat.isDirectory()) {
    return {
      success: false,
      error: `Not a directory: ${resolvedPath}`
    };
  }

  // Find HTML files
  const files = findHtmlFiles(resolvedPath);

  if (files.length === 0) {
    return {
      success: true,
      mode: 'batch-analyze',
      output: `${colors.yellow}No HTML files found in: ${resolvedPath}${colors.reset}`
    };
  }

  console.log(`${colors.dim}Found ${files.length} HTML file(s)${colors.reset}`);
  console.log('');

  // Process each file
  const results = [];

  for (const file of files) {
    const result = processFile(file, { ...options, apply: false });

    if (result.success) {
      results.push(result.plan);
    } else {
      results.push({
        success: false,
        error: `${basename(file)}: ${result.error}`
      });
    }
  }

  // Format batch summary
  const output = formatBatchSummary(results);

  // If applying, process files that need updates
  if (options.apply) {
    const filesToUpdate = files.filter((file, i) => {
      const plan = results[i];
      return plan.success && plan.hasUpdates;
    });

    if (filesToUpdate.length > 0) {
      console.log(`${colors.bold}Applying updates to ${filesToUpdate.length} file(s)...${colors.reset}`);
      console.log('');

      for (const file of filesToUpdate) {
        const result = processFile(file, options);
        console.log(result.output);
      }
    }
  }

  return {
    success: true,
    mode: options.apply ? 'batch-apply' : 'batch-analyze',
    fileCount: files.length,
    results,
    output
  };
}

/**
 * Main entry point
 */
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.targets.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  // Handle rollback
  if (args.rollback) {
    for (const target of args.targets) {
      const result = restoreFromBackup(resolve(target));
      if (result.success) {
        console.log(`${colors.green}✓ Restored from backup:${colors.reset} ${target}`);
      } else {
        console.log(`${colors.red}✗ Rollback failed:${colors.reset} ${result.error}`);
      }
    }
    return;
  }

  // Process targets
  for (const target of args.targets) {
    const resolvedPath = resolve(target);
    const stat = existsSync(resolvedPath) ? statSync(resolvedPath) : null;

    if (!stat) {
      console.log(`${colors.red}Error:${colors.reset} Path not found: ${target}`);
      continue;
    }

    if (stat.isDirectory()) {
      // Batch mode
      const result = processBatch(target, args);
      console.log(result.output);
    } else {
      // Single file mode
      const result = processFile(target, args);
      console.log(result.output);
    }
  }
}

// Run if called directly
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export {
  processFile,
  processBatch,
  createBackup,
  restoreFromBackup,
  parseArgs
};
