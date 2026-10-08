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
# Every selected case is strict. The MOG-owned helper uses a temporary,
# supported Calipers numeric band for one RANDBETWEEN cell, then checks its
# exact formula, numeric type, integer result and bounds independently.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git -C "${root}" submodule update --init -- vendor/calipers

mog_bin="${MOG_BIN:-}"
if [[ -z "${mog_bin}" ]]; then
  if [[ -x "${root}/target-native/release/mog" ]]; then
    mog_bin="${root}/target-native/release/mog"
  else
    mog_bin="${root}/target-native/debug/mog"
  fi
fi
if [[ ! -x "${mog_bin}" ]]; then
  (cd "${root}" && cargo build -p mog --locked --release)
  mog_bin="${root}/target-native/release/mog"
fi
if [[ ! -x "${mog_bin}" ]]; then
  echo "mog: built binary not found at ${mog_bin}" >&2
  exit 1
fi

source "${root}/scripts/calipers-mog/build.sh"

if [[ -n "${CALIPERS_BIN:-}" ]]; then
  calipers_bin="${CALIPERS_BIN}"
else
  mkdir -p "${root}/target-native"
  (cd "${root}/vendor/calipers" && go build -o "${root}/target-native/calipers" ./cmd/calipers)
  calipers_bin="${root}/target-native/calipers"
fi

exec python3 "${root}/scripts/calipers-verify/verify.py" \
  --calipers "${calipers_bin}" --engine "${calipers_mog}" \
  --cases-dir "${root}/vendor/calipers/verification/cases" "$@"
