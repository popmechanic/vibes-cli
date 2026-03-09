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

# Check for Bun runtime
if ! command -v bun &>/dev/null; then
    state_hints=$'\n\n## ⚠️ Bun Required\nBun runtime is not installed. Install it before running any Vibes commands:\n```bash\ncurl -fsSL https://bun.sh/install | bash\n```\nThen restart your terminal. Bun is required for all Vibes assembly, preview, and deploy scripts.'
fi

REGISTRY="$HOME/.vibes/deployments.json"
AUTH_CACHE="$HOME/.vibes/auth.json"
if [ -f "$REGISTRY" ]; then
    app_count=$(grep -c '"name"' "$REGISTRY" 2>/dev/null || echo "0")
    state_hints+=$'\n\n## Project State\nVibes registry found with '"$app_count"' app(s). Deploy with /vibes:cloudflare.'
elif [ -f "$AUTH_CACHE" ]; then
    state_hints+=$'\n\n## Project State\nPocket ID authenticated (cached at ~/.vibes/auth.json). Deploy with /vibes:cloudflare.'
else
    state_hints+=$'\n\n## Project State\nNo auth cache found. Auth is automatic — browser login on first deploy, cached at ~/.vibes/auth.json.'
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
