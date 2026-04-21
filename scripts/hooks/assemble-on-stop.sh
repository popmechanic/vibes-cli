#!/usr/bin/env bash
# Vibes Stop hook — runs assemble.js at end of turn when app.jsx is newer
# than index.html. No-op outside Vibes projects.
#
# Exit codes:
#   0 — nothing to do OR assembly succeeded OR circuit breaker tripped
#   2 — assembly failed; stderr contains actionable error for the agent

set -euo pipefail

# 1. Walk up from cwd to find the nearest Vibes project (vibes.json + app.jsx)
PROJECT_DIR="$(pwd)"
while [ "$PROJECT_DIR" != "/" ] && [ "$PROJECT_DIR" != "$HOME" ]; do
  if [ -f "$PROJECT_DIR/vibes.json" ] && [ -f "$PROJECT_DIR/app.jsx" ]; then
    break
  fi
  PROJECT_DIR="$(dirname "$PROJECT_DIR")"
done

# Not in a Vibes project → silent no-op
[ -f "$PROJECT_DIR/vibes.json" ] && [ -f "$PROJECT_DIR/app.jsx" ] || exit 0

APP="$PROJECT_DIR/app.jsx"
HTML="$PROJECT_DIR/index.html"
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT}"

# 2. Idempotency — skip if index.html is newer than app.jsx
if [ -f "$HTML" ] && [ "$HTML" -nt "$APP" ]; then
  exit 0
fi

# 3. Run assembly
cd "$PROJECT_DIR"
ASSEMBLE_OUTPUT=$(bun "$VIBES_ROOT/scripts/assemble.js" app.jsx index.html 2>&1) || {
  echo "Vibes assembly failed. Fix app.jsx — the assembler will re-run when you finish your next turn." >&2
  echo "$ASSEMBLE_OUTPUT" >&2
  exit 2
}
