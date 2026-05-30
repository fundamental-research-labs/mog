"""Native-backed package contract tests for the Mog Python SDK."""
from __future__ import annotations

import pytest

import mog
from mog._generated.api_surface import API_SURFACE
from mog._native import ComputeEngine  # noqa: F401
from mog.errors import UnsupportedApiError


def _disposition(api_path: str) -> dict:
    return next(item for item in API_SURFACE["dispositions"] if item["apiPath"] == api_path)


def test_native_workbook_formula_and_dispose() -> None:
    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        ws.set_cell("A1", 2)
        ws.set_cell("A2", "=A1*3")
        wb.calculate()
        assert ws.get_value("A2") == 6
    finally:
        wb.dispose()

    with pytest.raises(Exception):
        wb.sheet_names


def test_to_buffer_is_real_export_or_explicit_unsupported() -> None:
    wb = mog.create_workbook()
    try:
        status = _disposition("wb.toXlsx")["status"]
        if status in {"implemented", "renamed"}:
            data = wb.to_buffer()
            assert isinstance(data, bytes)
            assert data.startswith(b"PK")
            assert b"[Content_Types].xml" in data
        else:
            with pytest.raises(UnsupportedApiError) as exc_info:
                wb.to_buffer()
            assert exc_info.value.api_path == "wb.toXlsx"
    finally:
        wb.dispose()


def test_known_fake_success_paths_raise_unsupported() -> None:
    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        checks = [
            (lambda: wb.theme.get_workbook_theme(), "wb.theme.getWorkbookTheme"),
            (lambda: wb.viewport.create_region(ws.sheet_id, {}), "wb.viewport.createRegion"),
            (lambda: wb.bindings.list(), "py.wb.bindings.list"),
            (lambda: ws.settings.get(), "ws.settings.get"),
            (lambda: ws.data_table.list(), "py.ws.data_table.list"),
            (lambda: ws.scenarios.list(), "py.ws.scenarios.list"),
            (lambda: ws.pictures.list(), "ws.pictures.list"),
            (lambda: ws.form_controls.list(), "ws.formControls.list"),
            (lambda: ws.text_boxes.list(), "ws.textBoxes.list"),
            (lambda: ws.charts.export_image("chart-1"), "ws.charts.exportImage"),
            (lambda: ws.validation.get_errors_in_range(0, 0, 1, 1), "ws.validations.getErrorsInRange"),
            (lambda: ws.tables.clear_filters("Table1"), "ws.tables.clearFilters"),
            (lambda: ws.tables.apply_auto_expansion("Table1"), "ws.tables.applyAutoExpansion"),
        ]
        for call, api_path in checks:
            with pytest.raises(UnsupportedApiError) as exc_info:
                call()
            assert exc_info.value.api_path == api_path
    finally:
        wb.dispose()


def test_generated_artifacts_are_packaged_in_source_tree() -> None:
    from pathlib import Path

    pkg = Path(mog.__file__).resolve().parent
    assert (pkg / "py.typed").is_file()
    assert any(pkg.glob("*.pyi"))
    assert (pkg / "_generated" / "api_surface.json").is_file()
    assert API_SURFACE["counts"]["dispositions"] >= API_SURFACE["counts"]["functions"]
