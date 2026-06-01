#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${MOG_PYO3_VENV:-$ROOT/compute/pyo3/.venv}"
WHEEL_DIR="${MOG_PYO3_WHEEL_DIR:-$ROOT/compute/pyo3/dist/wheels}"
SKIP_WHEEL_SMOKE=0

for arg in "$@"; do
  case "$arg" in
    --skip-wheel-smoke)
      SKIP_WHEEL_SMOKE=1
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install maturin pytest pyright
export VIRTUAL_ENV="$VENV_DIR"
export PATH="$VENV_DIR/bin:$PATH"

cd "$ROOT"

cargo test -p compute-core-pyo3
cargo clippy -p compute-core-pyo3

"$VENV_DIR/bin/python" -m maturin develop --manifest-path compute/pyo3/Cargo.toml
"$VENV_DIR/bin/python" -m pytest compute/pyo3/tests -q
"$VENV_DIR/bin/python" -m mog._tools.smoke --json
"$VENV_DIR/bin/python" compute/pyo3/scripts/generate_python_surface.py --check
"$VENV_DIR/bin/python" -m mog._tools.verify_surface --strict --json
"$VENV_DIR/bin/python" -m mog._tools.audit_stubs --strict
PYTHONPATH="$ROOT/compute/pyo3/python" "$VENV_DIR/bin/python" -m pyright --verifytypes mog

if [[ "$SKIP_WHEEL_SMOKE" -eq 0 ]]; then
  rm -rf "$WHEEL_DIR"
  "$VENV_DIR/bin/python" -m maturin build --manifest-path compute/pyo3/Cargo.toml --out "$WHEEL_DIR"
  WHEEL_SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mog-pyo3-wheel-smoke.XXXXXX")"
  "$PYTHON_BIN" -m venv "$WHEEL_SMOKE_DIR"
  "$WHEEL_SMOKE_DIR/bin/python" -m pip install --upgrade pip
  "$WHEEL_SMOKE_DIR/bin/python" -m pip install --force-reinstall "$WHEEL_DIR"/*.whl
  "$WHEEL_SMOKE_DIR/bin/python" -m pip install pyright
  WHEEL_SMOKE_DIR="$WHEEL_SMOKE_DIR" "$WHEEL_SMOKE_DIR/bin/python" - <<'PY'
import os
import sysconfig
from pathlib import Path

import mog

pkg = Path(mog.__file__).resolve().parent
site_packages = Path(sysconfig.get_paths()["purelib"]).resolve()
smoke_root = Path(os.environ["WHEEL_SMOKE_DIR"]).resolve()
assert site_packages in pkg.parents, mog.__file__
assert smoke_root in pkg.parents, mog.__file__
assert (pkg / "py.typed").is_file()
assert any(pkg.glob("*.pyi"))
assert (pkg / "_generated" / "api_surface.json").is_file()
assert next(pkg.glob("_native*.so"), None) or next(pkg.glob("_native*.pyd"), None)

wb = mog.create_workbook()
try:
    ws = wb.active_sheet
    ws.set_cell("A1", 2)
    ws.set_cell("A2", "=A1*3")
    wb.calculate()
    assert ws.get_value("A2") == 6
finally:
    wb.dispose()
PY
  WHEEL_SITE_PACKAGES="$("$WHEEL_SMOKE_DIR/bin/python" - <<'PY'
import sysconfig

print(sysconfig.get_paths()["purelib"])
PY
)"
  (
    cd "$WHEEL_SMOKE_DIR"
    PYTHONPATH="$WHEEL_SITE_PACKAGES" "$WHEEL_SMOKE_DIR/bin/python" -m pyright --verifytypes mog
  )
fi
