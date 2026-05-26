#!/usr/bin/env bash
# lint-dist.sh — Verify dist/ outputs are free of banned patterns.
# Run after building tier 2/3 packages to catch regressions.
#
# Exit code 0 = clean, 1 = violations found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOG_ROOT="$(dirname "$SCRIPT_DIR")"

violations=0

check() {
  local label="$1" pattern="$2" path="$3"
  if grep -rq "$pattern" "$path" 2>/dev/null; then
    echo "FAIL: $label"
    grep -rn "$pattern" "$path" | head -5
    violations=$((violations + 1))
  fi
}

# Transport: browser entry must not contain node: imports
if [ -d "$MOG_ROOT/infra/transport/dist" ]; then
  check "node: in transport browser entry" \
    "from 'node:" \
    "$MOG_ROOT/infra/transport/dist/index.browser.js"

  check "require('module') in transport browser entry" \
    "require.*['\"]module['\"]" \
    "$MOG_ROOT/infra/transport/dist/index.browser.js"
fi

# All dist: no Vite env leaks
for pkg in infra/transport infra/icons apps/spreadsheet kernel shell; do
  dist="$MOG_ROOT/$pkg/dist"
  [ -d "$dist" ] || continue
  check "import.meta.env.VITE_ in $pkg/dist" \
    'import\.meta\.env\.VITE_' \
    "$dist"
done

# All dist: no .svg?react imports
for pkg in infra/icons apps/spreadsheet shell; do
  dist="$MOG_ROOT/$pkg/dist"
  [ -d "$dist" ] || continue
  check ".svg?react in $pkg/dist" \
    '\.svg?react' \
    "$dist"
done

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "$violations violation(s) found in dist/ outputs."
  exit 1
else
  echo "All dist/ outputs clean."
fi
