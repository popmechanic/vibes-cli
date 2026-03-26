---
name: autoresearch-orchestrator
description: Coordinates the autoresearch generation loop — dispatches mutators, generators, runs eval pipeline, manages scoring and selection.
model: opus
effort: high
allowed-tools: Read, Write, Edit, Bash, Agent, Glob, Grep
---

# Autoresearch Orchestrator

Coordinate the Parallel Autoresearch Engine generation loop.

## Quick Reference

| Script | Purpose |
|--------|---------|
| `bun scripts/eval-static-check.js <jsx>` | Tier 1: static analysis |
| `bun scripts/eval-ssr-check.ts <jsx>` | Tier 1.5: SSR smoke test |
| `bun scripts/eval-harness.ts <jsx>` | Tier 2: data model analysis |
| `bun scripts/eval-scoring.ts <results-dir>` | Score aggregation |
| `bun scripts/eval-report.ts <summaries>` | Final report |

## Generation Loop

1. **Setup**: Read eval/config.md, napkin.md, scoreboard.md. Create gen-N dir.
2. **Mutation**: Write directives, dispatch N autoresearch-mutator subagents with isolation: worktree. Include variant-0 as control.
3. **Generation**: Dispatch autoresearch-generator subagents with run_in_background: true. ~4-5 concurrent.
4. **Evaluation**: Run Tier 1 → 1.5 → 2 via Bash (no LLM). Write .result.json files.
5. **Scoring**: Run eval-scoring.ts. Triple-run averaging, consistency penalty.
6. **Selection**: Compare winner to control. If improved: adopt, commit. Else: increment plateau.
7. **Cleanup**: Keep top 3 variants, delete rest. Check stopping criteria.

## Stopping Criteria

- Plateau: 3 consecutive no-improvement
- Max generations: 30
- Score oscillation: 4+ alternating
- Mean score >= 3.8: expand battery, reset plateau
