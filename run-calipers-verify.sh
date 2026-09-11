#!/usr/bin/env bash
# Build Mog and the calipers submodule, then semantically verify the
# mog-owned XLSX roundtrip cases against committed Excel goldens.
#
# Extra arguments are forwarded to `calipers verify`.
#
# Env:
#   MOG_BIN       built mog binary (default: <repo>/target-native/debug/mog)
#   CALIPERS_BIN  calipers binary (default: build vendor/calipers/cmd/calipers)
#
# Full-corpus runs still execute every committed-golden case. The six
# IDs in `known_golden_fails` are Excel-win golden bugs tracked in
# https://github.com/fundamental-research-labs/calipers/issues/38 —
# they print as FAIL, then the runner exits 0 only if nothing else
# failed. Passing `--case` / `--suite` keeps the raw calipers exit.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git -C "${root}" submodule update --init -- vendor/calipers

mog_bin="${MOG_BIN:-${root}/target-native/debug/mog}"
if [[ ! -x "${mog_bin}" ]]; then
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

# Excel-win goldens that cannot match a later re-eval / a non-COM exporter.
# Remove an ID here when that golden is regenerated or xlsxmodel ignores it.
known_golden_fails=(
  officejs/fill_solid
  officejs/spill_take_drop
  roundtrip/formula_stress_test
  roundtrip/formulas_datetime
  roundtrip/formulas_dynamic_arrays
  roundtrip/formulas_information
)

log="$(mktemp)"
trap 'rm -f "${log}"' EXIT

set +e
"${calipers_bin}" verify --engine "${mog_bin}" \
  --cases-dir "${root}/vendor/calipers/verification/cases" \
  "$@" | tee "${log}"
status="${PIPESTATUS[0]}"
set -e

if [[ "${status}" -eq 0 ]]; then
  exit 0
fi

# Targeted walks (`--case`, `--suite`, …) keep a strict exit.
if [[ "$#" -gt 0 ]]; then
  exit "${status}"
fi

mapfile -t failed < <(sed -nE 's/^\[\S+\] ([^ ]+) FAIL.*/\1/p' "${log}")
mapfile -t errors < <(sed -nE 's/^\[\S+\] ([^ ]+) ERROR.*/\1/p' "${log}")

if [[ "${#errors[@]}" -gt 0 ]]; then
  echo "calipers: unexpected ERROR cases: ${errors[*]}" >&2
  exit "${status}"
fi

unexpected=()
for id in "${failed[@]}"; do
  allowed=0
  for known in "${known_golden_fails[@]}"; do
    if [[ "${id}" == "${known}" ]]; then
      allowed=1
      break
    fi
  done
  if [[ "${allowed}" -eq 0 ]]; then
    unexpected+=("${id}")
  fi
done

if [[ "${#unexpected[@]}" -gt 0 ]]; then
  echo "calipers: unexpected FAIL cases: ${unexpected[*]}" >&2
  exit "${status}"
fi

echo "calipers: only known golden FAILs remain (${failed[*]}); see calipers#38" >&2
exit 0
