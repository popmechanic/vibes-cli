import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { computeVariantScore, computeFitness } from '../../eval-scoring.js';
import type { RunScore } from '../../eval-scoring.js';

describe('computeVariantScore', () => {
  it('averages triple-run scores per prompt', () => {
    const scores: RunScore[] = [
      // prompt 0: runs [4, 4, 3]
      { variant: 0, prompt: 0, run: 0, score: 4 },
      { variant: 0, prompt: 0, run: 1, score: 4 },
      { variant: 0, prompt: 0, run: 2, score: 3 },
      // prompt 1: runs [2, 2, 2]
      { variant: 0, prompt: 1, run: 0, score: 2 },
      { variant: 0, prompt: 1, run: 1, score: 2 },
      { variant: 0, prompt: 1, run: 2, score: 2 },
    ];

    const result = computeVariantScore(scores);

    expect(result.variant).toBe(0);
    // prompt 0 avg: (4+4+3)/3 = 3.6667
    expect(result.promptAverages[0]).toBeCloseTo(11 / 3, 5);
    // prompt 1 avg: (2+2+2)/3 = 2.0
    expect(result.promptAverages[1]).toBeCloseTo(2.0, 5);
    // mean of prompt averages: (3.6667 + 2.0) / 2 = 2.8333
    expect(result.mean).toBeCloseTo((11 / 3 + 2) / 2, 5);
  });

  it('computes standard deviation across all runs', () => {
    const scores: RunScore[] = [
      { variant: 1, prompt: 0, run: 0, score: 4 },
      { variant: 1, prompt: 0, run: 1, score: 4 },
      { variant: 1, prompt: 0, run: 2, score: 4 },
    ];

    const result = computeVariantScore(scores);

    // All scores identical → stdDev = 0
    expect(result.stdDev).toBe(0);
    expect(result.mean).toBe(4);
  });

  it('penalizes inconsistent scoring', () => {
    const consistentScores: RunScore[] = [
      { variant: 0, prompt: 0, run: 0, score: 3 },
      { variant: 0, prompt: 0, run: 1, score: 3 },
      { variant: 0, prompt: 0, run: 2, score: 3 },
    ];

    const inconsistentScores: RunScore[] = [
      { variant: 1, prompt: 0, run: 0, score: 4 },
      { variant: 1, prompt: 0, run: 1, score: 1 },
      { variant: 1, prompt: 0, run: 2, score: 4 },
    ];

    const consistent = computeVariantScore(consistentScores, 0.5);
    const inconsistent = computeVariantScore(inconsistentScores, 0.5);

    // Same mean (3 vs 3) but inconsistent has higher stdDev → lower fitness
    expect(consistent.mean).toBeCloseTo(3, 5);
    expect(inconsistent.mean).toBeCloseTo(3, 5);
    expect(inconsistent.stdDev).toBeGreaterThan(consistent.stdDev);
    expect(inconsistent.fitness).toBeLessThan(consistent.fitness);
  });
});

describe('computeFitness', () => {
  it('applies consistency penalty', () => {
    // fitness = mean - (penalty * stdDev) = 3.5 - (0.5 * 1.0) = 3.0
    const fitness = computeFitness(3.5, 1.0, 0.5);
    expect(fitness).toBeCloseTo(3.0, 5);
  });

  it('never goes below 0', () => {
    // fitness would be 1.0 - (0.5 * 5.0) = -1.5, floored at 0
    const fitness = computeFitness(1.0, 5.0, 0.5);
    expect(fitness).toBeGreaterThanOrEqual(0);
    expect(fitness).toBe(0);
  });
});
