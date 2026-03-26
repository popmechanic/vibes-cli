---
name: autoresearch
argument-hint: "[--variants=N] [--generations=N]"
description: >
  Run the Parallel Autoresearch Engine — massively parallel SKILL.md
  optimization. Generates 10+ SKILL.md variants per generation, tests each
  with programmatic harness (no browser needed), scores with triple-run
  averaging, and iterates autonomously. Use when asked to run autoresearch,
  improve SKILL.md at scale, or start parallel autoresearch.
license: MIT
allowed-tools: Read, Write, Edit, Bash, Agent, Glob, Grep
---

# Parallel Autoresearch Engine

> **Plan mode**: This skill is ONE plan step: "Invoke /vibes:autoresearch". Do not decompose.

## Prerequisites Check

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
echo "Checking autoresearch prerequisites..."
test -f "$VIBES_ROOT/scripts/eval-ssr-check.ts" && echo "✓ Tier 1.5 SSR check" || echo "✗ Missing eval-ssr-check.ts"
test -f "$VIBES_ROOT/scripts/eval-harness.ts" && echo "✓ Tier 2 harness" || echo "✗ Missing eval-harness.ts"
test -f "$VIBES_ROOT/scripts/eval-parallel.ts" && echo "✓ Orchestrator" || echo "✗ Missing eval-parallel.ts"
test -f "$VIBES_ROOT/scripts/eval-scoring.ts" && echo "✓ Scoring" || echo "✗ Missing eval-scoring.ts"
test -f "$VIBES_ROOT/eval/config.md" && echo "✓ Config" || echo "✗ Missing eval/config.md"
test -f "$VIBES_ROOT/eval/napkin.md" && echo "✓ Napkin" || echo "✗ Missing eval/napkin.md"
ls "$VIBES_ROOT/eval/specs/"*.md 2>/dev/null | wc -l | xargs -I{} echo "✓ {} eval specs found"
cd "$VIBES_ROOT/scripts" && bun -e "import React from 'react'; console.log('✓ React available')" 2>/dev/null || echo "✗ React not installed"
```

If any prerequisite is missing, stop and inform the user.

## Running

### Option 1: Full Autonomous Run (Recommended)

Dispatch the autoresearch orchestrator agent (`.claude/agents/autoresearch-orchestrator.md`) with context from eval/config.md, eval/napkin.md, and eval/scoreboard.md.

Pass any CLI arguments from the user (e.g., `--variants=5 --generations=10`).

### Option 2: Single Eval Pipeline Test

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/eval-parallel.ts" --mode=eval-only <app.jsx> <spec.md>
```

### Option 3: Score Existing Generation

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/eval-scoring.ts" "$VIBES_ROOT/eval/results/gen-N/"
```

## What It Does

Each generation:
1. **Mutate**: N independent SKILL.md variants (fix-targeted, structural, adversarial, etc.)
2. **Generate**: Each variant × each prompt × 3 runs
3. **Evaluate**: Tier 1 (static) → Tier 1.5 (SSR) → Tier 2 (data model) — all programmatic
4. **Score**: Triple-run averaging with consistency penalty; fitness = mean - 0.5×stddev
5. **Select**: Best variant replaces current SKILL.md; git commit on improvement
6. **Repeat**: Until plateau (3 gens), max generations, or score oscillation

## Monitoring

- `eval/results/gen-N/summary.json` — per-generation results
- `eval/results/summaries.json` — cumulative history
- `eval/scoreboard.md` — human-readable scoreboard
- `eval/napkin.md` — failure log (grows monotonically)

## Final Report

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/eval-report.ts" "$VIBES_ROOT/eval/results/summaries.json"
```
