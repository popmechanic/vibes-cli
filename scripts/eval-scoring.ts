import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunScore {
  variant: number;
  prompt: number;
  run: number;
  score: number;
}

export interface VariantScore {
  variant: number;
  mean: number;
  stdDev: number;
  fitness: number;
  promptAverages: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

/**
 * fitness = mean - (consistencyPenalty * stdDev), floored at 0
 */
export function computeFitness(
  mean: number,
  stdDev: number,
  consistencyPenalty: number
): number {
  return Math.max(0, mean - consistencyPenalty * stdDev);
}

/**
 * Compute mean, std dev, per-prompt averages, and fitness for a single
 * variant's collection of run scores.
 *
 * Algorithm:
 *  1. Group scores by prompt, average runs within each prompt → promptAverages
 *  2. Mean = average of all promptAverages
 *  3. StdDev = population std dev across ALL individual run scores
 *  4. Fitness = computeFitness(mean, stdDev, consistencyPenalty)
 */
export function computeVariantScore(
  scores: RunScore[],
  consistencyPenalty = 0.5
): VariantScore {
  if (scores.length === 0) {
    return { variant: 0, mean: 0, stdDev: 0, fitness: 0, promptAverages: {} };
  }

  const variantId = scores[0].variant;

  // 1. Group by prompt
  const byPrompt = new Map<number, number[]>();
  for (const s of scores) {
    if (!byPrompt.has(s.prompt)) {
      byPrompt.set(s.prompt, []);
    }
    byPrompt.get(s.prompt)!.push(s.score);
  }

  // 2. Compute prompt averages
  const promptAverages: Record<number, number> = {};
  for (const [promptId, runScores] of byPrompt.entries()) {
    promptAverages[promptId] =
      runScores.reduce((sum, v) => sum + v, 0) / runScores.length;
  }

  // 3. Mean = average of prompt averages
  const avgValues = Object.values(promptAverages);
  const mean = avgValues.reduce((sum, v) => sum + v, 0) / avgValues.length;

  // 4. StdDev = population std dev across ALL individual run scores
  const allScores = scores.map((s) => s.score);
  const allMean = allScores.reduce((sum, v) => sum + v, 0) / allScores.length;
  const variance =
    allScores.reduce((sum, v) => sum + (v - allMean) ** 2, 0) / allScores.length;
  const stdDev = Math.sqrt(variance);

  // 5. Fitness
  const fitness = computeFitness(mean, stdDev, consistencyPenalty);

  return { variant: variantId, mean, stdDev, fitness, promptAverages };
}

// ---------------------------------------------------------------------------
// Generation scoring
// ---------------------------------------------------------------------------

/**
 * Walk genDir/variants/variant-{id}/prompt-{M}/run-{R}.result.json files,
 * read finalScore from each, group by variant, compute VariantScore.
 *
 * Returns sorted results with bestVariant, bestFitness, and controlFitness
 * (variant-0's fitness).
 */
export function scoreGeneration(
  genDir: string,
  consistencyPenalty = 0.5
): {
  variantScores: VariantScore[];
  bestVariant: number;
  bestFitness: number;
  controlFitness: number;
} {
  const variantsDir = join(genDir, 'variants');

  if (!existsSync(variantsDir)) {
    return {
      variantScores: [],
      bestVariant: 0,
      bestFitness: 0,
      controlFitness: 0,
    };
  }

  const runScores: RunScore[] = [];

  // Walk variant-{id} directories
  const variantDirs = readdirSync(variantsDir).filter((d) =>
    d.match(/^variant-\d+$/)
  );

  for (const variantDir of variantDirs) {
    const variantId = parseInt(variantDir.replace('variant-', ''), 10);
    const variantPath = join(variantsDir, variantDir);

    // Walk prompt-{M} directories
    const promptDirs = readdirSync(variantPath).filter((d) =>
      d.match(/^prompt-\d+$/)
    );

    for (const promptDir of promptDirs) {
      const promptId = parseInt(promptDir.replace('prompt-', ''), 10);
      const promptPath = join(variantPath, promptDir);

      // Find run-{R}.result.json files
      const resultFiles = readdirSync(promptPath).filter((f) =>
        f.match(/^run-\d+\.result\.json$/)
      );

      for (const resultFile of resultFiles) {
        const runId = parseInt(resultFile.replace(/^run-(\d+)\.result\.json$/, '$1'), 10);
        const resultPath = join(promptPath, resultFile);

        try {
          const content = readFileSync(resultPath, 'utf8');
          const data = JSON.parse(content);
          const score =
            typeof data.finalScore === 'number' ? data.finalScore : 0;

          runScores.push({ variant: variantId, prompt: promptId, run: runId, score });
        } catch {
          // Skip unreadable or malformed result files
        }
      }
    }
  }

  if (runScores.length === 0) {
    return {
      variantScores: [],
      bestVariant: 0,
      bestFitness: 0,
      controlFitness: 0,
    };
  }

  // Group by variant
  const byVariant = new Map<number, RunScore[]>();
  for (const rs of runScores) {
    if (!byVariant.has(rs.variant)) {
      byVariant.set(rs.variant, []);
    }
    byVariant.get(rs.variant)!.push(rs);
  }

  // Compute VariantScore for each variant
  const variantScores: VariantScore[] = [];
  for (const [, scores] of byVariant.entries()) {
    variantScores.push(computeVariantScore(scores, consistencyPenalty));
  }

  // Sort by fitness descending
  variantScores.sort((a, b) => b.fitness - a.fitness);

  const bestVariant = variantScores[0]?.variant ?? 0;
  const bestFitness = variantScores[0]?.fitness ?? 0;
  const controlScore = variantScores.find((v) => v.variant === 0);
  const controlFitness = controlScore?.fitness ?? 0;

  return { variantScores, bestVariant, bestFitness, controlFitness };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const genDir = args[0];

  if (!genDir) {
    console.error('Usage: bun scripts/eval-scoring.ts <gen-dir>');
    process.exit(1);
  }

  if (!existsSync(genDir)) {
    console.error(`Error: Directory not found: ${genDir}`);
    process.exit(1);
  }

  const result = scoreGeneration(genDir);
  console.log(JSON.stringify(result, null, 2));
}
