#!/usr/bin/env bash
# SessionStart hook for Vibes plugin
# Injects framework awareness context into every conversation

set -euo pipefail

# Determine plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Read static context
context_content=$(cat "${SCRIPT_DIR}/session-context.md" 2>&1 || echo "Error reading session-context.md")

# Detect project state and build dynamic hints
state_hints=""

REGISTRY="$HOME/.vibes/deployments.json"
if [ -f "$REGISTRY" ]; then
    app_count=$(grep -c '"name"' "$REGISTRY" 2>/dev/null || echo "0")
    state_hints=$'\n\n## Project State\nVibes registry found with '"$app_count"' app(s). Deploy with /vibes:cloudflare.'
elif [ -f "${PWD}/.env" ]; then
    has_clerk_keys=false
    if grep -q "VITE_CLERK_PUBLISHABLE_KEY=pk_" "${PWD}/.env" 2>/dev/null; then
        has_clerk_keys=true
    fi
    if [ "$has_clerk_keys" = true ]; then
        state_hints=$'\n\n## Project State\nLegacy .env found with Clerk keys. Deploy with /vibes:cloudflare to auto-configure Connect.'
    else
        state_hints=$'\n\n## Project State\n.env found but missing Clerk keys. Add VITE_CLERK_PUBLISHABLE_KEY before deploying.'
    fi
else
    state_hints=$'\n\n## Project State\nNo registry or .env found. Provide Clerk keys when deploying your first app.'
fi

if [ -f "${PWD}/app.jsx" ]; then
    state_hints="${state_hints}"$'\napp.jsx exists — invoke the matching build skill (/vibes:vibes or /vibes:sell) to reassemble.'
fi

if [ -f "${PWD}/index.html" ]; then
    if grep -q "TenantProvider" "${PWD}/index.html" 2>/dev/null; then
        state_hints="${state_hints}"$'\nindex.html exists (sell template) — reassemble with /vibes:sell, deploy with /vibes:cloudflare.'
    else
        state_hints="${state_hints}"$'\nindex.html exists (vibes template) — reassemble with /vibes:vibes, deploy with /vibes:cloudflare.'
    fi
fi

# Escape for JSON using pure bash (character-by-character)
escape_for_json() {
    local input="$1"
    local output=""
    local i char
    for (( i=0; i<${#input}; i++ )); do
        char="${input:$i:1}"
        case "$char" in
            $'\\') output+='\\' ;;
            '"') output+='\"' ;;
            $'\n') output+='\n' ;;
            $'\r') output+='\r' ;;
            $'\t') output+='\t' ;;
            *) output+="$char" ;;
        esac
    done
    printf '%s' "$output"
}

context_escaped=$(escape_for_json "$context_content")
state_escaped=$(escape_for_json "$state_hints")

# Output context injection as JSON
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<vibes-framework>\n${context_escaped}${state_escaped}\n</vibes-framework>"
  }
}
EOF

exit 0
