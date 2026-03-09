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

# ── Step 1: Bun ───────────────────────────────────────────────────────

step "Checking for Bun..."

if command -v bun &>/dev/null; then
  BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
  info "Bun is installed (${BUN_VERSION})"
else
  warn "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash

  # Source the updated profile so bun is available in this session
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"

  if command -v bun &>/dev/null; then
    info "Bun installed successfully"
  else
    fail "Bun installation failed. Try manually: https://bun.sh"
  fi
fi

# ── Step 2: Node.js ──────────────────────────────────────────────────

step "Checking for Node.js..."

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
  info "Node.js is installed (${NODE_VERSION})"
else
  warn "Node.js not found — installing via Bun..."
  # Bun can bootstrap npm packages without Node, but Claude Code
  # currently requires Node at runtime. Install via Bun's node shim
  # or prompt the user.
  if command -v brew &>/dev/null; then
    brew install node
    if command -v node &>/dev/null; then
      info "Node.js installed via Homebrew"
    else
      fail "Node.js installation failed. Install manually: https://nodejs.org"
    fi
  else
    fail "Node.js is required for Claude Code. Install from https://nodejs.org"
  fi
fi

# ── Step 3: Claude Code ──────────────────────────────────────────────

step "Checking for Claude Code..."

if command -v claude &>/dev/null; then
  CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
  info "Claude Code is installed (${CLAUDE_VERSION})"
else
  warn "Claude Code not found — installing..."

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

# ── Step 4: Vibes marketplace ───────────────────────────────────────

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

# ── Step 5: Vibes plugin ────────────────────────────────────────────

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
