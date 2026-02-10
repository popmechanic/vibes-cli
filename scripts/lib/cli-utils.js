/**
 * Shared CLI argument parsing utilities.
 *
 * Schema-driven: callers declare their flags, and parseArgs handles
 * --flag value, --flag=value, boolean --flag, -f aliases, positionals,
 * --help, and unknown-flag errors.
 */

/**
 * Parse CLI arguments against a schema.
 *
 * @param {Array<{name: string, flag: string, alias?: string, type: 'string'|'boolean', default?: any, required?: boolean, description?: string}>} schema
 * @param {string[]} [argv] - Arguments to parse (default: process.argv.slice(2))
 * @returns {{ args: Record<string, any>, positionals: string[] }}
 */
export function parseArgs(schema, argv = process.argv.slice(2)) {
  // Build lookup maps
  const flagToEntry = new Map();
  const aliasToEntry = new Map();

  for (const entry of schema) {
    flagToEntry.set(entry.flag, entry);
    if (entry.alias) {
      aliasToEntry.set(entry.alias, entry);
    }
  }

  // Initialize defaults
  const args = {};
  for (const entry of schema) {
    args[entry.name] = entry.default !== undefined ? entry.default : (entry.type === 'boolean' ? false : null);
  }

  const positionals = [];
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];

    // Handle --flag=value syntax
    if (raw.startsWith('--') && raw.includes('=')) {
      const eqIndex = raw.indexOf('=');
      const flag = raw.slice(0, eqIndex);
      const value = raw.slice(eqIndex + 1);
      const entry = flagToEntry.get(flag);
      if (!entry) {
        errors.push(`Unknown flag: ${flag}`);
        continue;
      }
      if (entry.type === 'boolean') {
        args[entry.name] = value === 'true' || value === '1';
      } else {
        args[entry.name] = value;
      }
      continue;
    }

    // Handle --help (always recognized)
    if (raw === '--help' || raw === '-h') {
      args._help = true;
      continue;
    }

    // Handle --flag or -f
    if (raw.startsWith('--') || (raw.startsWith('-') && raw.length === 2)) {
      const entry = raw.startsWith('--') ? flagToEntry.get(raw) : aliasToEntry.get(raw);
      if (!entry) {
        errors.push(`Unknown flag: ${raw}`);
        continue;
      }
      if (entry.type === 'boolean') {
        args[entry.name] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('-') && next.length > 1 && !/^\d/.test(next.slice(1)))) {
          errors.push(`Flag ${raw} requires a value`);
          continue;
        }
        args[entry.name] = next;
        i++;
      }
      continue;
    }

    // Positional argument
    positionals.push(raw);
  }

  if (errors.length > 0) {
    args._errors = errors;
  }

  return { args, positionals };
}

/**
 * Format a help message from schema + metadata.
 *
 * @param {{ name: string, description: string, usage: string, examples?: string[], notes?: string[], sections?: Array<{title: string, entries: Array}>}} meta
 * @param {Array} schema
 * @returns {string}
 */
export function formatHelp(meta, schema) {
  const lines = [];

  lines.push(`${meta.name}`);
  lines.push('='.repeat(meta.name.length));
  lines.push('');
  lines.push(meta.description);
  lines.push('');
  lines.push('Usage:');
  lines.push(`  ${meta.usage}`);
  lines.push('');

  // Group entries by section if sections are provided
  if (meta.sections) {
    for (const section of meta.sections) {
      lines.push(`${section.title}:`);
      for (const entry of section.entries) {
        const flagStr = formatFlagStr(entry);
        lines.push(`  ${flagStr.padEnd(30)} ${entry.description || ''}`);
      }
      lines.push('');
    }
  } else {
    lines.push('Options:');
    for (const entry of schema) {
      const flagStr = formatFlagStr(entry);
      lines.push(`  ${flagStr.padEnd(30)} ${entry.description || ''}`);
    }
    lines.push(`  ${'--help'.padEnd(30)} Show this help message`);
    lines.push('');
  }

  // Always add --help to sections output
  if (meta.sections) {
    // --help already included in sections by the caller if they want it
  }

  if (meta.examples && meta.examples.length > 0) {
    lines.push('Examples:');
    for (const example of meta.examples) {
      lines.push(`  ${example}`);
    }
    lines.push('');
  }

  if (meta.notes && meta.notes.length > 0) {
    for (const note of meta.notes) {
      lines.push(note);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatFlagStr(entry) {
  let str = entry.flag;
  if (entry.alias) {
    str = `${entry.alias}, ${str}`;
  }
  if (entry.type !== 'boolean') {
    const placeholder = entry.flag.replace(/^--/, '').replace(/-/g, '_').toUpperCase();
    str += ` <${placeholder}>`;
  }
  return str;
}

/**
 * Handle --help and validation errors: print help, exit.
 * Call this after parseArgs to handle the common cases.
 *
 * @param {{ args: Record<string, any>, positionals: string[] }} parsed
 * @param {Array} schema
 * @param {{ meta: object, requiredArgs?: string[], requiredPositionals?: number, positionalLabels?: string[] }} opts
 */
export function handleHelpAndErrors(parsed, schema, opts) {
  const { args } = parsed;
  const helpText = formatHelp(opts.meta, schema);

  if (args._help) {
    console.log('\n' + helpText);
    process.exit(0);
  }

  if (args._errors) {
    for (const err of args._errors) {
      console.error(`Error: ${err}`);
    }
    console.error('\nRun with --help for usage information');
    process.exit(1);
  }
}
