import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { evalStaticCheck } from './eval-static-check.js';
import { ssrSmokeTest } from './eval-ssr-check.ts';
import { analyzeDataModel, assertDataModel, type EvalSpec } from './eval-harness.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PAREConfig {
  variants: number;
  prompts: string[];
  runs: number;
  maxGenerations: number;
  plateauThreshold: number;
  consistencyPenalty: number;
  ablationFrequency: number;
  redTeamCeiling: number;
  sonnetCheckFrequency: number;
}

export interface AppResult {
  variant: number;
  prompt: number;
  run: number;
  tier1: { passed: boolean; critical: string[]; warnings: string[] };
  tier15: { passed: boolean; error?: string };
  tier2: { passed: boolean; score: number; failures: string[] };
  finalScore: number;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(): PAREConfig {
  const args = process.argv.slice(2);

  function getArg(name: string): string | undefined {
    const prefix = `--${name}=`;
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length) : undefined;
  }

  function getInt(name: string, defaultVal: number): number {
    const raw = getArg(name);
    return raw !== undefined ? parseInt(raw, 10) : defaultVal;
  }

  function getFloat(name: string, defaultVal: number): number {
    const raw = getArg(name);
    return raw !== undefined ? parseFloat(raw) : defaultVal;
  }

  const prompts = loadPromptBattery();

  return {
    variants: getInt('variants', 10),
    prompts,
    runs: getInt('runs', 3),
    maxGenerations: getInt('generations', 30),
    plateauThreshold: getInt('plateau', 3),
    consistencyPenalty: getFloat('consistency-penalty', 0.5),
    ablationFrequency: getInt('ablation', 3),
    redTeamCeiling: getInt('red-team-ceiling', 300),
    sonnetCheckFrequency: getInt('sonnet-check', 5),
  };
}

// ---------------------------------------------------------------------------
// Prompt battery loading
// ---------------------------------------------------------------------------

function loadPromptBattery(): string[] {
  const specsDir = join(import.meta.dir, '..', 'eval', 'specs');
  if (!existsSync(specsDir)) {
    return [];
  }

  const files = readdirSync(specsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const prompts: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(specsDir, file), 'utf8');
    const lines = content.split('\n');

    // Find the ## Seed Prompt section and grab the next non-empty line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '## Seed Prompt') {
        // Find the next non-empty line after the header
        for (let j = i + 1; j < lines.length; j++) {
          const line = lines[j].trim();
          if (line.length > 0 && !line.startsWith('#')) {
            prompts.push(line);
            break;
          }
        }
        break;
      }
    }
  }

  return prompts;
}

// ---------------------------------------------------------------------------
// Eval spec loading
// ---------------------------------------------------------------------------

export function loadEvalSpec(specPath: string): EvalSpec {
  const content = readFileSync(specPath, 'utf8');
  const lines = content.split('\n');

  const tables: string[] = [];
  const perUserFields: Record<string, string[]> = {};
  const sharedTables: string[] = [];

  // Known per-user field names to detect heuristically
  const USER_IDENTITY_FIELDS = [
    'bidder', 'createdBy', 'email', 'sender', 'assignee', 'owner',
    'userId', 'user', 'author', 'reporter', 'submitter', 'player',
  ];

  // Parse ### Tables section
  let inTablesSection = false;
  let inKeyPatternSection = false;
  let keyPatternLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '### Tables') {
      inTablesSection = true;
      inKeyPatternSection = false;
      continue;
    }

    if (trimmed === '### Key Pattern') {
      inTablesSection = false;
      inKeyPatternSection = true;
      continue;
    }

    // Any other ### or ## section ends the current section
    if (trimmed.startsWith('##')) {
      inTablesSection = false;
      inKeyPatternSection = false;
      continue;
    }

    if (inTablesSection) {
      // Lines like: - `tablename` — description
      const tableMatch = trimmed.match(/^-\s+`([^`]+)`/);
      if (tableMatch) {
        const tableName = tableMatch[1];
        tables.push(tableName);

        // Detect per-user fields from the inline description
        // e.g. `{ name, createdBy, bidder }` after the table name
        const descMatch = line.match(/\{([^}]+)\}/);
        if (descMatch) {
          const fields = descMatch[1].split(',').map((f) => f.trim());
          const userFields = fields.filter((f) => USER_IDENTITY_FIELDS.includes(f));
          if (userFields.length > 0) {
            perUserFields[tableName] = userFields;
          }
        }
      }
    }

    if (inKeyPatternSection && trimmed.length > 0) {
      keyPatternLines.push(trimmed);
    }
  }

  // Detect sharedTables from key pattern text
  // Tables mentioned alongside 'all' or 'shared' are shared
  const keyPatternText = keyPatternLines.join(' ').toLowerCase();
  for (const table of tables) {
    const tableNameLower = table.toLowerCase();
    // Look for patterns like "shared X table" or "all X visible to all"
    const sharedPatterns = [
      new RegExp(`shared\\s+${tableNameLower}`),
      new RegExp(`${tableNameLower}.*all\\s+users`),
      new RegExp(`all.*${tableNameLower}.*visible`),
      new RegExp(`shared.*${tableNameLower}.*table`),
    ];
    if (sharedPatterns.some((p) => p.test(keyPatternText))) {
      sharedTables.push(table);
    }
  }

  return { tables, perUserFields, sharedTables };
}

// ---------------------------------------------------------------------------
// Eval pipeline
// ---------------------------------------------------------------------------

export function evaluateApp(jsxPath: string, specPath: string): AppResult {
  const result: AppResult = {
    variant: 0,
    prompt: 0,
    run: 0,
    tier1: { passed: false, critical: [], warnings: [] },
    tier15: { passed: false },
    tier2: { passed: false, score: 0, failures: [] },
    finalScore: 0,
  };

  // Tier 1: Static check
  const staticResult = evalStaticCheck(jsxPath);
  result.tier1 = {
    passed: staticResult.passed,
    critical: staticResult.critical,
    warnings: staticResult.warnings,
  };

  if (!staticResult.passed) {
    result.finalScore = 0;
    return result;
  }

  // Tier 1.5: SSR smoke test
  const ssrResult = ssrSmokeTest(jsxPath);
  result.tier15 = {
    passed: ssrResult.passed,
    error: ssrResult.error,
  };

  if (!ssrResult.passed) {
    result.finalScore = 1;
    return result;
  }

  // Tier 2: Data model analysis + assertions
  const spec = loadEvalSpec(specPath);
  const analysis = analyzeDataModel(jsxPath);
  const assertion = assertDataModel(analysis, spec);

  result.tier2 = {
    passed: assertion.passed,
    score: assertion.score,
    failures: assertion.failures,
  };

  result.finalScore = assertion.score;
  return result;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function getResultsDir(generation: number): string {
  return join(import.meta.dir, '..', 'eval', 'results', `gen-${generation}`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith('--mode='))?.slice('--mode='.length);

  if (mode === 'eval-only') {
    // Find file args (non-flag args)
    const fileArgs = args.filter((a) => !a.startsWith('--'));
    const jsxPath = fileArgs[0];
    const specPath = fileArgs[1];

    if (!jsxPath || !specPath) {
      console.error('Usage: bun eval-parallel.ts --mode=eval-only <file.jsx> <spec.md>');
      process.exit(1);
    }

    if (!existsSync(jsxPath)) {
      console.error(`Error: JSX file not found: ${jsxPath}`);
      process.exit(1);
    }

    if (!existsSync(specPath)) {
      console.error(`Error: Spec file not found: ${specPath}`);
      process.exit(1);
    }

    const result = evaluateApp(jsxPath, specPath);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.finalScore > 0 ? 0 : 1);
  } else if (mode === 'continuous') {
    console.log('Continuous mode is managed by the pare-orchestrator agent.');
    console.log('Use: /vibes:autoresearch to start the orchestrator agent.');
    process.exit(0);
  } else {
    // Default: print config + prompt count
    const config = loadConfig();

    console.log('PARE Orchestrator — eval-parallel.ts');
    console.log('=====================================');
    console.log(`Variants per generation : ${config.variants}`);
    console.log(`Runs per variant        : ${config.runs}`);
    console.log(`Max generations         : ${config.maxGenerations}`);
    console.log(`Plateau threshold       : ${config.plateauThreshold}`);
    console.log(`Consistency penalty     : ${config.consistencyPenalty}`);
    console.log(`Ablation frequency      : ${config.ablationFrequency}`);
    console.log(`Red team ceiling        : ${config.redTeamCeiling}`);
    console.log(`Sonnet check frequency  : ${config.sonnetCheckFrequency}`);
    console.log(`Prompt battery size     : ${config.prompts.length} prompts`);
    console.log('');
    console.log('Ready. Use --mode=eval-only <file.jsx> <spec.md> to evaluate a single app.');
    console.log('Use --mode=continuous to get instructions for the orchestrator agent.');
  }
}
