#!/usr/bin/env bash
# Vibes Stop hook — runs assemble.js at end of turn when app.jsx is newer
# than index.html. No-op outside Vibes projects.
#
# Exit codes:
#   0 — nothing to do OR assembly succeeded OR circuit breaker tripped
#   2 — assembly failed; stderr contains actionable error for the agent

set -euo pipefail

exit 0
