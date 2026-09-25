#!/bin/sh
# Copy the one-page site into website/out. The icon is the shared brand asset.
set -eu
website=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
repo=$(CDPATH= cd -- "$website/.." && pwd)
out="$website/out"
rm -rf "$out"
mkdir -p "$out"
cp "$website/index.html" "$website/style.css" "$out/"
cp "$repo/docs/brand/logo/mog-app-icon.svg" "$out/favicon.svg"
echo "Assembled $out"
