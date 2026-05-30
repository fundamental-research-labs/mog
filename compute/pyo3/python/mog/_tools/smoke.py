"""Native-backed smoke test for the installed Mog Python SDK."""
from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path
from typing import Any

from mog._generated.api_surface import API_SURFACE
from mog._tools.provenance import provenance
from mog.errors import UnsupportedApiError


def _disposition(api_path: str) -> dict[str, Any]:
    for item in API_SURFACE["dispositions"]:
        if item["apiPath"] == api_path:
            return item
    raise AssertionError(f"missing disposition for {api_path}")


def run_smoke() -> dict[str, Any]:
    import mog
    import mog._native  # noqa: F401

    wb = mog.create_workbook()
    export_result: dict[str, Any] = {"status": "not_checked"}
    try:
        ws = wb.active_sheet
        ws.set_cell("A1", 2)
        ws.set_cell("A2", "=A1*3")
        wb.calculate()
        value = ws.get_value("A2")
        assert value == 6, value

        export_disposition = _disposition("wb.toXlsx")
        if export_disposition["status"] in {"implemented", "renamed"}:
            data = wb.to_buffer()
            assert isinstance(data, bytes) and data.startswith(b"PK"), type(data)
            with tempfile.TemporaryDirectory(prefix="mog-pyo3-smoke-") as tmp:
                xlsx_path = Path(tmp) / "smoke.xlsx"
                xlsx_path.write_bytes(data)
                reopened = mog.open_workbook(str(xlsx_path))
                try:
                    reopened_value = reopened.active_sheet.get_value("A2")
                    assert reopened_value == 6, reopened_value
                finally:
                    reopened.dispose()
            export_result = {"status": "implemented", "bytes": len(data)}
        elif export_disposition["status"] == "unsupported":
            try:
                wb.to_buffer()
            except UnsupportedApiError as exc:
                assert exc.api_path == "wb.toXlsx", exc.to_dict()
                export_result = {"status": "unsupported", **exc.to_dict()}
            else:
                raise AssertionError("wb.to_buffer did not raise UnsupportedApiError")
        else:
            export_result = {"status": export_disposition["status"]}
        return {
            "ok": True,
            "formula_value": value,
            "export": export_result,
            "provenance": provenance(),
        }
    finally:
        wb.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args()
    result = run_smoke()
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print("Mog Python SDK smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
