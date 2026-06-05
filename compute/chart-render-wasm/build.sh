#!/usr/bin/env bash
# Build @mog-sdk/chart-raster-wasm for web target.
#
# Usage:
#   bash compute/chart-render-wasm/build.sh [--profile dev|release]

set -euo pipefail

cd "$(dirname "$0")"

export CARGO_TARGET_DIR="$(cd ../.. && pwd)/target-wasm"

restore_preserved_files() {
  if [[ -f npm/package.json.bak ]]; then
    mv npm/package.json.bak npm/package.json
  fi
  if [[ -f npm/.gitignore.bak ]]; then
    mv npm/.gitignore.bak npm/.gitignore
  fi
}

PROFILE="${MOG_WASM_PROFILE:-release}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --profile=*)
      PROFILE="${1#--profile=}"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--profile dev|release]" >&2
      exit 1
      ;;
  esac
done

case "$PROFILE" in
  dev)
    WASM_PACK_FLAG="--dev"
    ;;
  release)
    WASM_PACK_FLAG="--release"
    ;;
  *)
    echo "Unknown profile: $PROFILE" >&2
    echo "Usage: $0 [--profile dev|release]" >&2
    exit 1
    ;;
esac

mkdir -p npm
if [[ -f npm/package.json ]]; then
  cp npm/package.json npm/package.json.bak
fi
if [[ -f npm/.gitignore ]]; then
  cp npm/.gitignore npm/.gitignore.bak
fi

trap restore_preserved_files EXIT
wasm-pack build --target web --out-dir npm "$WASM_PACK_FLAG"
restore_preserved_files
trap - EXIT
