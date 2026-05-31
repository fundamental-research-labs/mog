"""Native-backed package contract tests for the Mog Python SDK."""
from __future__ import annotations

import pytest

import mog
from mog._generated.api_surface import API_SURFACE
from mog._native import ComputeEngine  # noqa: F401
from mog.errors import NativeApiError, UnsupportedApiError


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


def test_text_formatted_cells_store_string_inputs_without_apostrophe() -> None:
    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        ws.formats.set("A1", {"numberFormat": "@"})
        ws.set_cell("A1", "11")
        assert ws.get_value("A1") == "11"
        assert ws.get_cell("A1").raw_value == "11"
        assert ws.get_formula("A1") is None

        ws.formats.set("B1", {"numberFormat": "@"})
        ws.set_cell("B1", "=A1+1")
        assert ws.get_value("B1") == "=A1+1"
        assert ws.get_cell("B1").raw_value == "=A1+1"
        assert ws.get_formula("B1") is None
    finally:
        wb.dispose()


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


def test_comments_address_paths_use_native_position_bridge() -> None:
    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        created = ws.comments.add("B2", "hello", author="Tester")
        assert created["text"] == "hello"

        by_cell = ws.comments.get_for_cell("B2")
        assert [comment["text"] for comment in by_cell] == ["hello"]
        assert ws.comments.get("B2")["text"] == "hello"

        ws.comments.add_note("C3", "note text")
        assert ws.comments.get_note("C3") == "note text"

        with pytest.raises(UnsupportedApiError) as exc_info:
            ws.comments.set_note("C3", "replacement", author="Alice")
        assert exc_info.value.api_path == "ws.comments.setNote"

        ws.comments.remove_note("C3")
        ws.comments.add_note("C3", {"text": "replacement", "author": "Alice"})
        by_cell = ws.comments.get_for_cell("C3")
        assert len(by_cell) == 1
        assert by_cell[0]["author"] == "Alice"
        assert ws.comments.get_note("C3") == "replacement"
        ws.comments.remove_note("C3")
        assert ws.comments.get_note("C3") is None
        with pytest.raises(ValueError, match="No note found"):
            ws.comments.remove_note("C3")
    finally:
        wb.dispose()


def test_layout_queries_are_native_backed_and_do_not_swallow_failures() -> None:
    from mog.sub_apis.layout import LayoutAPI

    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        ws.layout.set_row_height(2, 33.0)
        ws.layout.set_column_width(1, 12.5)
        ws.layout.hide_rows([4])
        ws.layout.hide_columns([3])

        assert ws.layout.get_row_height(2) == pytest.approx(33.0)
        assert ws.layout.get_column_width(1) == pytest.approx(12.5)
        assert ws.layout.get_column_width_px(1) > 0
        assert ws.layout.get_row_heights_batch(2, 2) == [(2, pytest.approx(33.0))]
        assert ws.layout.get_col_widths_batch(1, 1) == [(1, pytest.approx(12.5))]
        assert ws.layout.get_col_widths_batch_px(1, 1)[0][1] > 0
        assert ws.layout.is_row_hidden(4) is True
        assert ws.layout.is_column_hidden(3) is True
        assert 4 in ws.layout.get_hidden_rows_bitmap()
        assert 3 in ws.layout.get_hidden_columns_bitmap()
    finally:
        wb.dispose()

    class FailingBridge:
        def call_json(self, *_args: object) -> object:
            raise NativeApiError("native failure")

    failing_layout = LayoutAPI(FailingBridge(), '"sheet"')  # type: ignore[arg-type]
    failing_calls = [
        lambda: failing_layout.get_row_height(0),
        lambda: failing_layout.get_column_width(0),
        lambda: failing_layout.get_column_width_px(0),
        lambda: failing_layout.get_row_heights_batch(0, 1),
        lambda: failing_layout.get_col_widths_batch(0, 1),
        lambda: failing_layout.get_col_widths_batch_px(0, 1),
        lambda: failing_layout.is_row_hidden(0),
        lambda: failing_layout.is_column_hidden(0),
        lambda: failing_layout.get_hidden_rows_bitmap(),
        lambda: failing_layout.get_hidden_columns_bitmap(),
    ]
    for call in failing_calls:
        with pytest.raises(NativeApiError, match="native failure"):
            call()


def test_mutation_helpers_do_not_report_success_for_missing_native_targets() -> None:
    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        with pytest.raises(ValueError, match="No comment found"):
            ws.comments.update("D4", "missing")

        with pytest.raises(ValueError, match="No sparkline found"):
            ws.sparklines.update(9, 9, {"type": "column"})

        with pytest.raises(ValueError, match="No auto-filter exists"):
            ws.filters.set_column_filter(0, {"type": "values", "values": ["x"]})

        with pytest.raises(ValueError, match="No auto-filter exists"):
            ws.filters.clear_column_filter(0)

        with pytest.raises(ValueError, match="No auto-filter exists"):
            ws.filters.get_unique_values(0)
    finally:
        wb.dispose()


def test_pivot_detect_fields_preserves_duplicate_header_identity() -> None:
    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        ws.set_cell("A1", "Region")
        ws.set_cell("B1", "Region")
        ws.set_cell("A2", "East")
        ws.set_cell("B2", 10)

        fields = ws.pivots.detect_fields(
            ws.sheet_id,
            {"startRow": 0, "startCol": 0, "endRow": 1, "endCol": 1},
        )
        assert [field["id"] for field in fields] == ["field_0", "field_1"]
        assert [field["name"] for field in fields] == ["Region", "Region"]
    finally:
        wb.dispose()
