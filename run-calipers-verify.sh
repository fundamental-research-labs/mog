#!/usr/bin/env bash
# Build Mog and the calipers submodule, then semantically verify the
# mog-owned XLSX roundtrip cases against committed Excel goldens.
#
# Extra arguments are forwarded to `calipers verify`.
#
# Env:
#   MOG_BIN       built mog binary (default: <repo>/target-native/debug/mog)
#   CALIPERS_BIN  calipers binary (default: build vendor/calipers/cmd/calipers)
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

exec "${calipers_bin}" verify --engine "${mog_bin}" \
  --cases-dir "${root}/vendor/calipers/verification/cases" \
  "$@"
