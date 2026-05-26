#!/usr/bin/env bash
#
# check-wasm-boundary.sh — Verify WASM package boundary contract
#
# Ensures TypeScript code uses @mog-sdk/wasm (the public npm package)
# and never references compute-core-wasm (the Rust/wasm-pack internal name)
# as a JS package dependency, import specifier, or bundler config entry.
#
# Exit 0 if all checks pass, non-zero if any fail.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

pass_count=0
fail_count=0

check_pass() {
  printf "  PASS: %s\n" "$1"
  pass_count=$((pass_count + 1))
}

check_fail() {
  printf "  FAIL: %s\n" "$1"
  fail_count=$((fail_count + 1))
}

# --------------------------------------------------------------------------
# Check 1: No compute-core-wasm as a JS package dependency
# --------------------------------------------------------------------------
printf "\n[Check 1] No compute-core-wasm in package.json dependencies\n"

pkg_violations=""
while IFS= read -r pjson; do
  # Skip root package.json
  if [ "$pjson" = "$REPO_ROOT/package.json" ]; then
    continue
  fi
  # Skip compute/wasm/npm (wasm-pack build artifact, not a JS consumer)
  case "$pjson" in
    */compute/wasm/npm/*) continue ;;
  esac
  # Check dependencies, devDependencies, peerDependencies for compute-core-wasm as a key
  if grep -q '"compute-core-wasm"' "$pjson" 2>/dev/null; then
    rel="${pjson#"$REPO_ROOT"/}"
    pkg_violations="${pkg_violations}    ${rel}\n"
  fi
done <<EOF
$(git ls-files '*package.json')
EOF

if [ -n "$pkg_violations" ]; then
  printf "  Found compute-core-wasm dependency in:\n"
  printf "$pkg_violations"
  check_fail "compute-core-wasm found as package dependency"
else
  check_pass "No compute-core-wasm package dependencies"
fi

# --------------------------------------------------------------------------
# Check 2: No import('compute-core-wasm') in TypeScript runtime code
# --------------------------------------------------------------------------
printf "\n[Check 2] No compute-core-wasm imports in TypeScript runtime code\n"

import_violations=""
while IFS= read -r tsfile; do
  [ -z "$tsfile" ] && continue
  # Skip .d.ts (handled in check 3)
  case "$tsfile" in
    *.d.ts) continue ;;
  esac
  # Skip test files
  case "$tsfile" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) continue ;;
    */__tests__/*) continue ;;
  esac
  # Skip config files (bundler configs handled in check 4; vite/jest configs
  # are dev-time configuration, not runtime code)
  case "$(basename "$tsfile")" in
    tsup.config.ts|vite.config.ts|vite.config.*.ts|jest.config.ts) continue ;;
  esac
  if grep -q "compute-core-wasm" "$tsfile" 2>/dev/null; then
    # Look for actual import/from specifiers (static or dynamic).
    # Multi-line dynamic imports put the specifier on its own line, so we
    # strip comments and check for either:
    #   - import(...'compute-core-wasm'...) on one line
    #   - from 'compute-core-wasm'
    #   - bare 'compute-core-wasm' as an import argument (indented specifier)
    # Exclude path segments like join(..., 'compute-core-wasm', ...) which
    # are filesystem references, not module specifiers.
    if grep -E "(import\(|from )['\"]compute-core-wasm['\"]" "$tsfile" >/dev/null 2>&1; then
      rel="${tsfile#"$REPO_ROOT"/}"
      import_violations="${import_violations}    ${rel}\n"
    elif grep -E "^[[:space:]]*['\"]compute-core-wasm['\"]" "$tsfile" >/dev/null 2>&1; then
      # Catches multi-line dynamic import where the specifier is on its own
      # indented line (e.g. import(\n  'compute-core-wasm'\n))
      rel="${tsfile#"$REPO_ROOT"/}"
      import_violations="${import_violations}    ${rel}\n"
    fi
  fi
done <<EOF
$(git ls-files '*.ts' '*.tsx' ':!:*.d.ts')
EOF

if [ -n "$import_violations" ]; then
  printf "  Found compute-core-wasm imports in:\n"
  printf "$import_violations"
  check_fail "compute-core-wasm imported in TypeScript runtime code"
else
  check_pass "No compute-core-wasm imports in TypeScript runtime code"
fi

# --------------------------------------------------------------------------
# Check 3: No declare module 'compute-core-wasm' in type declarations
# --------------------------------------------------------------------------
printf "\n[Check 3] No declare module 'compute-core-wasm' in .d.ts files\n"

dts_violations=""
while IFS= read -r dtsfile; do
  [ -z "$dtsfile" ] && continue
  if grep -q "declare module ['\"]compute-core-wasm['\"]" "$dtsfile" 2>/dev/null; then
    rel="${dtsfile#"$REPO_ROOT"/}"
    dts_violations="${dts_violations}    ${rel}\n"
  fi
done <<EOF
$(git ls-files '*.d.ts')
EOF

if [ -n "$dts_violations" ]; then
  printf "  Found declare module 'compute-core-wasm' in:\n"
  printf "$dts_violations"
  check_fail "compute-core-wasm ambient module declarations found"
else
  check_pass "No compute-core-wasm ambient module declarations"
fi

# --------------------------------------------------------------------------
# Check 4: No compute-core-wasm in bundler external configs
# --------------------------------------------------------------------------
printf "\n[Check 4] No compute-core-wasm in tsup.config.ts external arrays\n"

tsup_violations=""
while IFS= read -r tsupfile; do
  [ -z "$tsupfile" ] && continue
  if grep -q "compute-core-wasm" "$tsupfile" 2>/dev/null; then
    rel="${tsupfile#"$REPO_ROOT"/}"
    tsup_violations="${tsup_violations}    ${rel}\n"
  fi
done <<EOF
$(git ls-files '*tsup.config.ts')
EOF

if [ -n "$tsup_violations" ]; then
  printf "  Found compute-core-wasm in tsup configs:\n"
  printf "$tsup_violations"
  check_fail "compute-core-wasm found in bundler external configs"
else
  check_pass "No compute-core-wasm in bundler external configs"
fi

# --------------------------------------------------------------------------
# Check 5: No compute-core-wasm in test mock mappings
# --------------------------------------------------------------------------
printf "\n[Check 5] No compute-core-wasm in jest/vitest mock mappings\n"

mock_violations=""
while IFS= read -r jestfile; do
  [ -z "$jestfile" ] && continue
  if grep -q "compute-core-wasm" "$jestfile" 2>/dev/null; then
    rel="${jestfile#"$REPO_ROOT"/}"
    mock_violations="${mock_violations}    ${rel}\n"
  fi
done <<EOF
$(git ls-files '*jest.config.*' '*vitest.config.*')
EOF

if [ -n "$mock_violations" ]; then
  printf "  Found compute-core-wasm in test configs:\n"
  printf "$mock_violations"
  check_fail "compute-core-wasm found in test mock mappings"
else
  check_pass "No compute-core-wasm in test mock mappings"
fi

# --------------------------------------------------------------------------
# Check 6: @mog-sdk/wasm package files exist
# --------------------------------------------------------------------------
printf "\n[Check 6] @mog-sdk/wasm package exists with correct name\n"

wasm_pkg="$REPO_ROOT/compute/wasm/npm/package.json"
if [ -f "$wasm_pkg" ]; then
  pkg_name=$(grep -o '"name": *"[^"]*"' "$wasm_pkg" | head -1 | sed 's/"name": *"//;s/"//')
  if [ "$pkg_name" = "@mog-sdk/wasm" ]; then
    check_pass "@mog-sdk/wasm package.json exists with correct name"
  else
    check_fail "compute/wasm/npm/package.json has name '$pkg_name', expected '@mog-sdk/wasm'"
  fi
else
  check_fail "compute/wasm/npm/package.json does not exist"
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
total=$((pass_count + fail_count))
printf "\n========================================\n"
printf "WASM boundary check: %d/%d passed" "$pass_count" "$total"
if [ "$fail_count" -gt 0 ]; then
  printf ", %d FAILED" "$fail_count"
fi
printf "\n========================================\n"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
exit 0
