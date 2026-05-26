#!/usr/bin/env bash
# Build @mog-sdk/wasm (compute-core-wasm crate) for web target.
#
# Usage:
#   bash compute/wasm/build.sh [--profile dev|release]
#
# Profile selection (CLI flag wins, then env var, then default):
#   1. --profile <name>    — explicit CLI flag.
#   2. MOG_WASM_PROFILE    — env var override (e.g. `MOG_WASM_PROFILE=dev`).
#   3. release             — default when neither is set.
#
# Profiles:
#   release (default) — full optimization. Uses wasm-pack with cargo's
#                       `[profile.release]` (fat LTO, codegen-units=1) +
#                       wasm-opt -Oz + Brotli q11. Used by deploy-embed,
#                       the CI publish workflow, and Cloudflare Pages.
#   dev               — fast iteration. Uses cargo's `[profile.wasm-dev]`
#                       (lto=off, codegen-units=16, incremental, opt-level=2)
#                       and skips wasm-opt + Brotli. Used by Vite dev
#                       server, app-eval freshness gate, views-host, and
#                       fleet worker-side rebuild.
#
#   Incremental rebuild times (touch a single Rust source file):
#     release  ≈ 360s   (full LTO + wasm-opt + brotli)
#     dev      ≈ 4s     (no LTO + no post-processing)
#
# Output: npm/ directory containing:
#   - compute_core_wasm.js (ES module glue)
#   - compute_core_wasm_bg.wasm (the WASM binary)
#   - compute_core_wasm.d.ts (TypeScript types)
#   - package.json (tracked — preserved across builds)
#
# Prerequisites:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#   brew install binaryen brotli   (release profile only — dev skips both)
# The fleet image already provides all three via the wasm-builder stage's
# toolchain copy; local dev users install via Homebrew.
#
# Note on the dev path: wasm-pack 0.13.1 has a bug where `--profile <name>`
# still passes `--release` to cargo (the two collide). To use the custom
# `wasm-dev` cargo profile we invoke `cargo build` and `wasm-bindgen-cli`
# directly. wasm-bindgen-cli is borrowed from wasm-pack's cache (populated
# the first time wasm-pack is run); see `find_wasm_bindgen` below.

set -euo pipefail

cd "$(dirname "$0")"

# Pin wasm-pack builds to the workspace's wasm-only target dir so it doesn't contend
# with host-triple builds on the same `.cargo-lock`. Belt-and-suspenders: the
# nested `compute/wasm/.cargo/config.toml` already sets `[build] target-dir`,
# but cargo resolves config relative to CWD and some callers may end up here
# with a different working directory.
export CARGO_TARGET_DIR="$(cd ../.. && pwd)/target-wasm"

# Profile precedence: CLI flag > MOG_WASM_PROFILE env > default.
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

WASM_FILE="npm/compute_core_wasm_bg.wasm"
JS_FILE="npm/compute_core_wasm.js"
DTS_FILE="npm/compute_core_wasm.d.ts"

# Append a `__wbindgen_reset()` export to the generated wasm-pack output so
# the trap-recovery coordinator can clear wasm-bindgen's module-private
# instance cache. Without this, `__wbg_init` short-circuits on subsequent
# calls (`if (wasm !== undefined) return wasm;`) and returns the *dead*
# instance from before the trap — defeating `resetWasmModule()`.
#
# See infra/transport/src/wasm-loader.ts.
patch_wasm_bindgen_reset() {
  # wasm-bindgen emits `new URL('compute_core_wasm_bg.wasm', import.meta.url)`.
  # Webpack/Next treats that bare URL as a package/module request after the glue
  # crosses an npm package boundary. Keep the asset relative to the generated
  # JS module so Vite, Webpack, and Next can all resolve the adjacent .wasm file.
  perl -0pi -e "s/new URL\\('compute_core_wasm_bg\\.wasm', import\\.meta\\.url\\)/new URL('.\\/compute_core_wasm_bg.wasm', import.meta.url)/g" "$JS_FILE"

  if grep -q '__wbindgen_reset' "$JS_FILE"; then
    echo "  __wbindgen_reset already patched in $JS_FILE — skipping"
    return
  fi
  echo "  Patching $JS_FILE with __wbindgen_reset() export..."
  # Append AFTER wasm-pack's existing `export { initSync, __wbg_init as default };`
  # line — same scope as the module-private `let wasmModule, wasm;`
  # at the top, plus the cached typed-array views inside `__wbg_finalize_init`.
  # Resetting all four lets the next `__wbg_init` call run the full
  # instantiation path and finalize against a fresh `WebAssembly.Instance`.
  cat >> "$JS_FILE" <<'EOF'

/**
 * Trap-recovery hook: clear wasm-bindgen's module-private instance cache
 * so the next `__wbg_init` call re-instantiates against a fresh
 * `WebAssembly.Instance` instead of returning the cached (possibly dead)
 * one. See `infra/transport/src/wasm-loader.ts:resetWasmModule()`.
 *
 * Appended by `compute/wasm/build.sh`.
 */
export function __wbindgen_reset() {
  wasm = undefined;
  wasmModule = undefined;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
}
EOF
  # Mirror in the type declaration.
  if ! grep -q '__wbindgen_reset' "$DTS_FILE"; then
    cat >> "$DTS_FILE" <<'EOF'

/**
 * Trap-recovery hook (appended by `compute/wasm/build.sh`).
 * Clears wasm-bindgen's module-private instance cache so subsequent
 * `__wbg_init` calls instantiate a fresh `WebAssembly.Instance`.
 */
export function __wbindgen_reset(): void;
EOF
  fi
}

# Read the wasm-bindgen crate version selected by Cargo. The generated
# wasm-bindgen CLI must match exactly or it fails with an opaque schema-version
# error after spending time compiling the Rust crate.
required_wasm_bindgen_version() {
  local lock_file="../../Cargo.lock"
  if [[ ! -f "$lock_file" ]]; then
    return
  fi
  awk '
    BEGIN { in_package = 0 }
    /^\[\[package\]\]/ { in_package = 0 }
    /^name = "wasm-bindgen"$/ { in_package = 1 }
    in_package && /^version = / {
      gsub(/"/, "", $3)
      print $3
      exit
    }
  ' "$lock_file"
}

wasm_bindgen_cli_version() {
  "$1" --version 2>/dev/null | awk '{ print $2 }'
}

# Locate the wasm-bindgen-cli binary needed by the dev path. We only accept an
# exact version match against Cargo.lock. Stale PATH binaries are intentionally
# ignored so local machines don't fail after a long Rust compile.
find_wasm_bindgen() {
  local required_version="$1"
  local candidate
  local candidate_version

  if command -v wasm-bindgen &>/dev/null; then
    candidate="$(command -v wasm-bindgen)"
    candidate_version="$(wasm_bindgen_cli_version "$candidate")"
    if [[ "$candidate_version" == "$required_version" ]]; then
      echo "$candidate"
      return
    fi
    echo "  Ignoring wasm-bindgen on PATH ($candidate_version; need $required_version): $candidate" >&2
  fi

  local cache_dirs=(
    "$HOME/Library/Caches/.wasm-pack"
    "$HOME/.cache/.wasm-pack"
  )
  local cache_root
  for cache_root in "${cache_dirs[@]}"; do
    if [[ -d "$cache_root" ]]; then
      local found
      while IFS= read -r found; do
        [[ -x "$found" ]] || continue
        candidate_version="$(wasm_bindgen_cli_version "$found")"
        if [[ "$candidate_version" == "$required_version" ]]; then
          echo "$found"
          return
        fi
      done < <(find "$cache_root" -maxdepth 2 -name 'wasm-bindgen' -type f 2>/dev/null)
    fi
  done
}

# Both paths (wasm-pack for release, wasm-bindgen-cli for dev) generate their
# own package.json in the output dir. The tracked npm/package.json (@mog-sdk/wasm)
# is saved before and restored after each tool invocation.

case "$PROFILE" in
  dev)
    echo "Building @mog-sdk/wasm (--profile dev → cargo profile.wasm-dev)..."
    REQUIRED_WBG_VERSION="$(required_wasm_bindgen_version)"
    if [[ -z "$REQUIRED_WBG_VERSION" ]]; then
      cargo metadata --format-version=1 >/dev/null
      REQUIRED_WBG_VERSION="$(required_wasm_bindgen_version)"
    fi
    if [[ -z "$REQUIRED_WBG_VERSION" ]]; then
      echo "✗ Could not determine wasm-bindgen version from Cargo metadata." >&2
      exit 1
    fi

    WBG=$(find_wasm_bindgen "$REQUIRED_WBG_VERSION")
    if [[ -z "$WBG" ]]; then
      echo "✗ wasm-bindgen-cli $REQUIRED_WBG_VERSION not found." >&2
      echo "  Either:" >&2
      echo "    - run \`bash compute/wasm/build.sh --profile release\` once to populate wasm-pack's cache, OR" >&2
      echo "    - \`cargo install -f wasm-bindgen-cli --version $REQUIRED_WBG_VERSION\`" >&2
      exit 1
    fi
    echo "  Using wasm-bindgen-cli $REQUIRED_WBG_VERSION: $WBG"

    # Direct cargo invocation — see header note about wasm-pack 0.13.1's
    # `--profile` bug. The `wasm-dev` cargo profile is defined in the
    # workspace Cargo.toml.
    cargo build --lib --target wasm32-unknown-unknown --profile wasm-dev

    RAW_WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/wasm-dev/compute_core_wasm.wasm"

    # wasm-bindgen-cli generates its own package.json in the output dir, which
    # would clobber the tracked npm/package.json (@mog-sdk/wasm). Save and restore.
    cp npm/package.json npm/package.json.bak
    "$WBG" --target web --out-dir npm "$RAW_WASM"
    mv npm/package.json.bak npm/package.json

    # Drop any leftover Brotli-compressed wasm from a prior release build —
    # it'd be older than this dev .wasm and is never used by the dev server.
    rm -f "$WASM_FILE.br"

    RAW_SIZE=$(wc -c < "$WASM_FILE" | tr -d ' ')
    echo "  WASM size: $(( RAW_SIZE / 1024 / 1024 ))MB ($RAW_SIZE bytes)"
    echo "  Skipping wasm-opt and Brotli (dev profile)."
    patch_wasm_bindgen_reset
    ;;
  release)
    echo "Building @mog-sdk/wasm (--profile release)..."

    # wasm-pack generates its own package.json and .gitignore that would clobber
    # the tracked files in npm/. Save before wasm-pack, restore after.
    cp npm/package.json npm/package.json.bak
    cp npm/.gitignore npm/.gitignore.bak
    wasm-pack build --target web --out-dir npm --release
    mv npm/package.json.bak npm/package.json
    mv npm/.gitignore.bak npm/.gitignore

    RAW_SIZE=$(wc -c < "$WASM_FILE" | tr -d ' ')
    echo "  Raw WASM size: $(( RAW_SIZE / 1024 / 1024 ))MB ($RAW_SIZE bytes)"

    # Post-process with wasm-opt for size optimization.
    # Note: compute/wasm/Cargo.toml disables wasm-pack's built-in wasm-opt
    # ([package.metadata.wasm-pack.profile.release] wasm-opt = false) so
    # we can pass --enable-simd here (xlsx-parser enables SIMD128).
    if command -v wasm-opt &>/dev/null; then
      echo "Running wasm-opt -Oz..."
      wasm-opt -Oz --enable-simd --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext "$WASM_FILE" -o "$WASM_FILE"
      OPT_SIZE=$(wc -c < "$WASM_FILE" | tr -d ' ')
      echo "  Optimized WASM size: $(( OPT_SIZE / 1024 / 1024 ))MB ($OPT_SIZE bytes)"
      echo "  Saved: $(( (RAW_SIZE - OPT_SIZE) / 1024 ))KB ($(( (RAW_SIZE - OPT_SIZE) * 100 / RAW_SIZE ))%)"
    else
      echo "  wasm-opt not found — skipping size optimization (brew install binaryen)"
    fi

    # Pre-compress with Brotli for CDN delivery (3-4MB vs 15MB uncompressed)
    if command -v brotli &>/dev/null; then
      echo "Compressing with Brotli (quality 11)..."
      brotli -q 11 -f -o "$WASM_FILE.br" "$WASM_FILE"
      BR_SIZE=$(wc -c < "$WASM_FILE.br" | tr -d ' ')
      echo "  Brotli size: $(( BR_SIZE / 1024 / 1024 ))MB ($BR_SIZE bytes)"
    else
      echo "  brotli not found — skipping pre-compression (brew install brotli)"
    fi

    patch_wasm_bindgen_reset
    ;;
  *)
    echo "Unknown profile: $PROFILE (expected: dev | release)" >&2
    exit 1
    ;;
esac

echo ""
echo "Build complete. Output in npm/"
echo "  npm/compute_core_wasm.js"
echo "  npm/compute_core_wasm_bg.wasm"
if [[ "$PROFILE" == "release" ]]; then
  echo "  npm/compute_core_wasm_bg.wasm.br  (upload to R2 alongside .wasm)"
fi
echo "  npm/compute_core_wasm.d.ts"
