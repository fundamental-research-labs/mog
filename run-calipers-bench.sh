#!/usr/bin/env bash
# Sequential verifier-corpus speed/memory benchmark: compile Mog, run Mog,
# then Excel COM on Windows when --excel is passed.
#
# Default is Mog-only so you can inspect JSON + HTML in this environment
# before a colleague runs the Excel series on Windows.
#
# Usage:
#   ./run-calipers-bench.sh                         # build Mog, run Mog → JSON + HTML
#   ./run-calipers-bench.sh --excel                 # build Mog, run Mog, then Excel (Windows)
#   ./run-calipers-bench.sh --suite default         # extra calipers bench flags
#   ./run-calipers-bench.sh --json out.json --report ./report
#
# The HTML includes Office.js Excel API coverage: Microsoft method catalog
# vs Mog host vs verification scripts (also written as officejs-coverage.json).
#
# Env:
#   MOG_BIN       built mog binary (default: <repo>/target-native/debug/mog)
#   CALIPERS_BIN  calipers binary (default: build vendor/calipers/cmd/calipers)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${root}/vendor/calipers/go.mod" ]]; then
  git -C "${root}" submodule update --init -- vendor/calipers
fi

excel=0
json="${root}/target-native/calipers-bench.json"
report="${root}/target-native/calipers-bench-report"
extra=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --excel)
      excel=1
      shift
      ;;
    --json)
      json="$2"
      shift 2
      ;;
    --report)
      report="$2"
      shift 2
      ;;
    --help|-h)
      sed -n '2,19p' "$0"
      exit 0
      ;;
    *)
      extra+=("$1")
      shift
      ;;
  esac
done

mog_bin="${MOG_BIN:-${root}/target-native/debug/mog}"
if [[ -z "${MOG_BIN:-}" ]]; then
  (cd "${root}" && cargo build -p mog --locked)
fi
if [[ ! -x "${mog_bin}" ]]; then
  echo "mog: built binary not found at ${mog_bin}" >&2
  exit 1
fi

if [[ -n "${CALIPERS_BIN:-}" ]]; then
  calipers_bin="${CALIPERS_BIN}"
else
  mkdir -p "${root}/target-native"
  (cd "${root}/vendor/calipers" && go build -o "${root}/target-native/calipers" ./cmd/calipers)
  calipers_bin="${root}/target-native/calipers"
fi

mkdir -p "$(dirname "${json}")" "${report}"

coverage_json="${report}/officejs-coverage.json"
python3 "${root}/scripts/officejs-coverage/coverage.py" scan \
  --catalog "${root}/scripts/officejs-coverage/excel-js-api.json" \
  --officejs "${root}/compute/officejs/src" \
  --cases "${root}/vendor/calipers/verification/cases" \
  --out "${coverage_json}"

args=(
  bench
  --engine "${mog_bin}"
  --json "${json}"
  --report "${report}"
  --coverage "${coverage_json}"
  --cases-dir "${root}/vendor/calipers/verification/cases"
)
if [[ "${excel}" -eq 1 ]]; then
  args=(
    bench
    --engine "${mog_bin}"
    --engine excel
    --json "${json}"
    --report "${report}"
    --coverage "${coverage_json}"
    --cases-dir "${root}/vendor/calipers/verification/cases"
  )
fi

echo "calipers bench: ${args[*]} ${extra[*]-}" >&2
exec "${calipers_bin}" "${args[@]}" ${extra[@]+"${extra[@]}"}
