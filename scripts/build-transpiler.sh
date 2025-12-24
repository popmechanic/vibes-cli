#!/bin/bash

# Build the transpiler as a standalone Bun executable
# This only needs to be run by plugin developers when updating the transpiler

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building transpiler executable..."

# Ensure bin directory exists
mkdir -p "$PROJECT_ROOT/bin"

# Compile to standalone executable
bun build "$SCRIPT_DIR/transpile.ts" --compile --outfile "$PROJECT_ROOT/bin/transpile"

echo ""
echo "Built: $PROJECT_ROOT/bin/transpile"
echo ""
echo "To use:"
echo "  ./bin/transpile"
echo ""
echo "Remember to commit bin/transpile to the repository!"
