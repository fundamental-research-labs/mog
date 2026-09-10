#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git -C "${root}" submodule update --init -- calipers
cd "${root}/calipers"
exec go test ./... "$@"
