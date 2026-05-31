# Mog Python SDK

The Python package name is `mog-sdk`; the import name is `mog`.

This package is a native-backed wrapper over the Mog compute engine. Package
health gates build and install `mog._native`; source-only imports are only a
smoke path and do not prove SDK behavior.

## Bootstrap

```bash
cd ../mog
pnpm check:python-sdk
```

## Examples

```python
import mog

wb = mog.create_workbook()
ws = wb.active_sheet
ws.set_cell("A1", 2)
ws.set_cell("A2", "=A1*3")
wb.calculate()
assert ws.get_value("A2") == 6
wb.dispose()
```

Load and export XLSX data through the native-backed package:

```python
from pathlib import Path

import mog

wb = mog.load_workbook("input.xlsx")
try:
    ws = wb.active_sheet
    ws.set_cell("B2", "=SUM(A1:A10)")
    wb.calculate()
    Path("output.xlsx").write_bytes(wb.to_xlsx())
finally:
    wb.dispose()
```

## API Parity Policy

Every generated TypeScript SDK path has a checked Python disposition in
`mog/api_dispositions.json`. Python may expose snake_case names, but the
mapping is explicit and generated artifacts are checked with:

```bash
compute/pyo3/.venv/bin/python compute/pyo3/scripts/generate_python_surface.py --check
compute/pyo3/.venv/bin/python -m mog._tools.verify_surface --strict --json
compute/pyo3/.venv/bin/python -m mog._tools.audit_stubs --strict
```

## Unsupported Behavior

Round 1 removes fake-success behavior. Public paths that are not yet backed by
production workbook state raise `mog.UnsupportedApiError` with `api_path`,
`python_path`, `reason_code`, and `owner_package`.

The supported/renamed/unsupported surface is generated from
`mog/api_dispositions.json`; do not maintain a separate README list. Check the
installed package or run the surface tools above to inspect the current
disposition state.

## Wheel Contents

Wheels must include the native extension, `py.typed`, generated `.pyi` stubs,
`mog/_generated/api_surface.json`, and the disposition manifest. Supported
Python versions are currently `>=3.9`; the release wheel platform matrix is a
release-owner decision before publishing.
