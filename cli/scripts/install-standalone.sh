#!/bin/sh
set -eu

BASE_URL="${MOG_CLI_BASE_URL:-https://github.com/fundamental-research-labs/mog/releases/latest/download}"
INSTALL_DIR="${MOG_CLI_INSTALL_DIR:-$HOME/.mog/cli}"
BIN_DIR="${MOG_CLI_BIN_DIR:-$HOME/.local/bin}"

if ! command -v node >/dev/null 2>&1; then
  echo "Mog CLI requires Node.js 18+ on PATH." >&2
  echo "Install Node.js first, then rerun this installer." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
  echo "Mog CLI requires Node.js 18+ on PATH. Found: $(node -v)" >&2
  exit 1
fi

platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$platform:$arch" in
  darwin:arm64) target="darwin-arm64" ;;
  darwin:x86_64) target="darwin-x64" ;;
  linux:x86_64)
    if ldd --version 2>&1 | grep -qi musl; then
      target="linux-x64-musl"
    else
      target="linux-x64-gnu"
    fi
    ;;
  linux:aarch64|linux:arm64)
    if ldd --version 2>&1 | grep -qi musl; then
      target="linux-arm64-musl"
    else
      target="linux-arm64-gnu"
    fi
    ;;
  msys*:x86_64|mingw*:x86_64|cygwin*:x86_64) target="win32-x64-msvc" ;;
  *) echo "Unsupported platform: $platform/$arch" >&2; exit 1 ;;
esac

url="${MOG_CLI_TARBALL_URL:-$BASE_URL/mog-cli-$target.tar.gz}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
curl -fsSL "$url" -o "$tmp/mog-cli.tar.gz"
rm -rf "$INSTALL_DIR"/*
tar -xzf "$tmp/mog-cli.tar.gz" -C "$INSTALL_DIR" --strip-components=1

ln -sf "$INSTALL_DIR/bin/mog.cjs" "$BIN_DIR/mog"

echo "Installed mog to $BIN_DIR/mog"
echo "If needed, add $BIN_DIR to PATH."
