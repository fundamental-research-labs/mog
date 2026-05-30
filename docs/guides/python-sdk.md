# Python SDK

> **Status:** Python bindings live in `compute/pyo3`. The package is named `mog-sdk`, requires Python 3.9+, and imports as `mog`.

Use a published wheel when one is available for your platform:

```bash
pip install mog-sdk
```

For a source checkout, build and install the local PyO3 package with Maturin:

```bash
cd compute/pyo3
python -m pip install "maturin>=1.7,<2.0"
maturin develop
```

```py
import mog

wb = mog.create_workbook()
ws = wb.active_sheet

ws.set_cell("A1", 42)
ws.set_cell("A2", "=A1*2")
wb.calculate()

print(ws.get_value("A2"))
wb.dispose()
```

Open an XLSX workbook with `mog.open_workbook("book.xlsx")`. Export workbook bytes with `wb.to_buffer()` and write the returned bytes to a `.xlsx` file.

The current Python surface covers workbook and worksheet creation, cell and range reads and writes, formulas, CSV/JSON sheet export, XLSX import/export bytes, security principal helpers, and workbook/sheet sub-APIs under `mog.sub_apis`. The repository does not currently expose a Pandas DataFrame API or an async Python API.

See [Node SDK](node-sdk.md) for the equivalent Node.js guide.
