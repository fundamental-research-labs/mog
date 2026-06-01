# Python SDK

> **Status: public-experimental.** Python bindings live in `compute/pyo3`.
> The package is named `mog-sdk`, imports as `mog`, requires Python 3.9+,
> and uses the native PyO3 extension `mog._native`.

Use the Python SDK for trusted same-process workbook automation and file
processing. It wraps the Rust compute engine with synchronous Python methods.
Source-only imports are only a smoke path; real workbook behavior requires the
native extension to be built or installed.

## Prerequisites

- Python 3.9+
- A published `mog-sdk` wheel for your platform, or a Rust toolchain plus
  Maturin for source builds

The PyPI package is covered when it is published. If no compatible wheel is
available for your platform, build the local PyO3 package from a source
checkout.

## Install

When a published wheel is available for your platform:

```bash
pip install mog-sdk
```

From this repository, run the source build from the repo root:

```bash
python3 -m venv compute/pyo3/.venv
compute/pyo3/.venv/bin/python -m pip install "maturin>=1.7,<2.0"
compute/pyo3/.venv/bin/python -m maturin develop --manifest-path compute/pyo3/Cargo.toml
```

## Runnable Quickstart

After installing the package, this should print `84`:

```bash
python - <<'PY'
import mog

wb = mog.create_workbook()

try:
    ws = wb.active_sheet
    ws.set_cell("A1", 42)
    ws.set_cell("A2", "=A1*2")
    wb.calculate()

    print(ws.get_value("A2"))
finally:
    wb.dispose()
PY
```

If you used the source checkout commands above, replace `python` with
`compute/pyo3/.venv/bin/python`.

## Create, Open, and Export Workbooks

```py
import mog
from pathlib import Path

wb = mog.create_workbook()
wb.dispose()

opened = mog.open_workbook("book.xlsx")
try:
    data = opened.to_buffer()
    Path("book-copy.xlsx").write_bytes(data)
finally:
    opened.dispose()
```

`mog.open_workbook()` accepts a filesystem path to an `.xlsx` file.
`wb.to_buffer()` returns native XLSX bytes in a built package. If the native
export bridge is unavailable, it raises `mog.UnsupportedApiError` instead of
returning placeholder bytes.

## Read and Write Cells

Cell addresses can use A1 notation, `(row, col)` tuples, or zero-based
`row, col, value` arguments.

```py
ws.set_cell("A1", "Name")
ws.set_cell((1, 0), "Alice")
ws.set_cell(1, 1, 92)

ws.set_range("A3:B4", [
    ["Bob", 85],
    ["Cora", 97],
])

print(ws.get_value("B2"))
print(ws.get_range("A1:B4"))
```

Strings that start with `=` are stored as formulas. Call `wb.calculate()` before
reading formula results when you need an explicit recalculation point.

## Sheet Export

Worksheets expose lightweight CSV and JSON exports:

```py
csv_text = ws.to_csv()
rows = ws.to_json()
```

`to_csv()` returns a CSV string for the used range. `to_json()` returns a list
of row dictionaries; by default it uses the first used row as headers. Pass
`{"headerRow": "none"}` to use column letters as keys.

## Security Helpers

The Python SDK exposes principal and data-access policy helpers through
`create_workbook(principal=...)`, `wb.set_active_principal()`,
`wb.make_principal()`, `wb.security_active()`, and `wb.security`.

```py
import mog

wb = mog.create_workbook(principal=["mog:owner"])
try:
    policy_id = wb.security.add_policy({
        "principalTag": "agent:*",
        "target": mog.Target.workbook(),
        "level": mog.AccessLevel.READ,
        "priority": 0,
    })
    print(wb.security_active())
    wb.security.remove_policy(policy_id)
finally:
    wb.dispose()
```

These helpers forward to Rust bridge methods for the Python surfaces that use
them. They are not a sandbox for untrusted Python code running in the same
process.

## Surface Notes

Python method names are synchronous and mostly use `snake_case` equivalents of
the TypeScript SDK surface. Generated disposition metadata in
`compute/pyo3/python/mog/_generated/api_surface.json` tracks whether each API
path is implemented, renamed, Python-only, omitted, or explicitly unsupported.

Current backed areas include workbook and worksheet creation, sheet lookup and
management, cell and range reads/writes, formulas and calculation, undo/history,
CSV/JSON sheet export, XLSX path import and byte export, names, formatting,
tables, charts, comments, filters, conditional formats, hyperlinks, layout,
outline, pivots, protection, slicers, sparklines, validation, view helpers, and
security policy helpers.

Some visible accessors intentionally raise `mog.UnsupportedApiError` for
release-deferred paths, including workbook bindings/theme/viewport methods,
worksheet settings/data-table/scenario methods, pictures, form controls, text
boxes, chart image export, validation error queries, and table filter clearing
or auto-expansion helpers.

The repository does not currently expose a Pandas DataFrame API or an async
Python API.

## Related Docs

See [Node SDK](node-sdk.md) for the equivalent Node.js guide.
