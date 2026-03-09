#!/usr/bin/env bash
set -euo pipefail

# Vibes installer — installs Claude Code, the Vibes marketplace, and the Vibes plugin
# Usage: curl -sSL https://install.vibesos.com | bash

REPO="popmechanic/vibes-cli"
MARKETPLACE="vibes-cli"
PLUGIN="vibes"

# Colors (disable if not a terminal)
if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi

info()  { printf "${BOLD}${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "${BOLD}${YELLOW}!${RESET} %s\n" "$1"; }
fail()  { printf "${BOLD}${RED}✗${RESET} %s\n" "$1"; exit 1; }
step()  { printf "\n${BOLD}%s${RESET}\n" "$1"; }

# ── Step 1: Claude Code ─────────────────────────────────────────────

step "Checking for Claude Code..."

if command -v claude &>/dev/null; then
  CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
  info "Claude Code is installed (${CLAUDE_VERSION})"
else
  warn "Claude Code not found — installing..."

  # Need npm/npx
  if ! command -v npm &>/dev/null; then
    fail "npm is required to install Claude Code. Install Node.js first: https://nodejs.org"
  fi

  npm install -g @anthropic-ai/claude-code

  if command -v claude &>/dev/null; then
    info "Claude Code installed successfully"
  else
    fail "Installation failed. Try: npm install -g @anthropic-ai/claude-code"
  fi
fi

# ── Step 2: Vibes marketplace ───────────────────────────────────────

step "Adding Vibes marketplace..."

# Check if marketplace is already registered
if claude plugin marketplace list 2>/dev/null | grep -q "${MARKETPLACE}"; then
  info "Vibes marketplace already registered"
  # Update to latest
  claude plugin marketplace update "${MARKETPLACE}" 2>/dev/null && \
    info "Marketplace updated to latest" || \
    warn "Could not update marketplace (may already be current)"
else
  claude plugin marketplace add "${REPO}"
  info "Vibes marketplace added"
fi

# ── Step 3: Vibes plugin ────────────────────────────────────────────

step "Installing Vibes plugin..."

if claude plugin list 2>/dev/null | grep -q "${PLUGIN}@${MARKETPLACE}"; then
  info "Vibes plugin already installed"
  # Update to latest
  claude plugin update "${PLUGIN}@${MARKETPLACE}" 2>/dev/null && \
    info "Plugin updated to latest" || \
    warn "Could not update plugin (may already be current)"
else
  claude plugin install "${PLUGIN}@${MARKETPLACE}"
  info "Vibes plugin installed"
fi

# ── Done ────────────────────────────────────────────────────────────

printf "\n${BOLD}${GREEN}Vibes is ready!${RESET}\n"
printf "Run ${BOLD}claude${RESET} and ask it to build you an app.\n\n"
