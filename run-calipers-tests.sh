#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
git -C "${root}" submodule update --init -- vendor/calipers
cd "${root}/vendor/calipers"
exec go test ./... "$@"
