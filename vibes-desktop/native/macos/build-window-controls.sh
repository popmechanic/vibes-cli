#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/build"
mkdir -p "$OUT_DIR"

xcrun clang++ \
  -dynamiclib \
  -fobjc-arc \
  -framework Cocoa \
  -arch arm64 \
  -arch x86_64 \
  -std=c++17 \
  -o "$OUT_DIR/libWindowControls.dylib" \
  "$SCRIPT_DIR/window-controls.mm"

echo "Built $OUT_DIR/libWindowControls.dylib"
