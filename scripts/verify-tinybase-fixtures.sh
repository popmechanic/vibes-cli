#!/bin/bash
# TinyBase fixture verification — assembles + browser-tests all tinybase-*.jsx fixtures.
# Outputs a single number: count of fixtures that load with 0 console errors.
# Usage: bash scripts/verify-tinybase-fixtures.sh

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPTS_DIR/verify-tinybase-fixtures.mjs"
