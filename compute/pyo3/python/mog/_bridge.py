"""Low-level bridge to the native Rust extension module.

Wraps ``mog._native.ComputeEngine`` with JSON serialization/deserialization
so that higher-level classes (``Workbook``, ``Worksheet``) don't need to
deal with raw JSON strings.

This module is an internal implementation detail; users should not import
it directly.
"""
from __future__ import annotations

import json
from typing import Any, List, Optional, Tuple

from mog.errors import _wrap_native_error


def _get_engine_class():
    """Lazily import the native ComputeEngine class."""
    from mog._native import ComputeEngine
    return ComputeEngine


def _ensure_json_quoted(value: str) -> str:
    """Ensure a string is JSON-quoted (wrapped in double quotes).

    If already quoted, return as-is to avoid double-quoting.
    """
    if isinstance(value, str) and value.startswith('"') and value.endswith('"'):
        return value
    return json.dumps(value)


class Bridge:
    """Low-level bridge to a single ``ComputeEngine`` instance.

    All methods serialize complex parameters to JSON and deserialize
    complex return values from JSON.  Primitive arguments (row, col,
    count, booleans) pass through directly.
    """

    __slots__ = ("_engine",)

    def __init__(self, engine: Any) -> None:
        self._engine = engine

    # ------------------------------------------------------------------
    # Generic call helpers
    # ------------------------------------------------------------------

    def call(self, method_name: str, *args: Any) -> Any:
        """Call a method on the engine, converting native errors to MogError."""
        try:
            fn = getattr(self._engine, method_name)
            return fn(*args)
        except Exception as exc:
            raise _wrap_native_error(exc) from exc

    def call_json(self, method_name: str, *args: Any) -> Any:
        """Call a method and JSON-deserialize any string result."""
        result = self.call(method_name, *args)
        if isinstance(result, str):
            return json.loads(result)
        if isinstance(result, tuple):
            # (bytes, json_str) pattern — return the deserialized json part
            parts = []
            for part in result:
                if isinstance(part, str):
                    parts.append(json.loads(part))
                else:
                    parts.append(part)
            return tuple(parts)
        return result

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @classmethod
    def create_from_snapshot(cls, snapshot_json: str) -> Tuple["Bridge", Any]:
        """Create a new engine from a WorkbookSnapshot JSON string.

        Returns ``(bridge, lifecycle_result_json)`` where the lifecycle
        result contains the initial recalc data.
        """
        ComputeEngine = _get_engine_class()
        try:
            engine = ComputeEngine(snapshot_json, json.dumps(None))
            # The constructor stores the lifecycle result; retrieve it.
            lifecycle_raw = engine.take_lifecycle_result()
            lifecycle = json.loads(lifecycle_raw) if isinstance(lifecycle_raw, str) else lifecycle_raw
        except Exception as exc:
            raise _wrap_native_error(exc) from exc
        return cls(engine), lifecycle

    # ------------------------------------------------------------------
    # Core cell operations (convenience wrappers)
    # ------------------------------------------------------------------

    def set_cell_value_parsed(
        self, sheet_id_json: str, row: int, col: int, input_str: str
    ) -> Any:
        """Set a cell value. Returns the raw (bytes, mutation_json) tuple."""
        if not hasattr(self._engine, "compute_set_cell_value_parsed"):
            cells_json = json.dumps([{"row": row, "col": col, "value": input_str}])
            return self.call_json("compute_set_cells_batch", sheet_id_json, cells_json)
        return self.call_json(
            "compute_set_cell_value_parsed", sheet_id_json, row, col, input_str
        )

    def set_cell_value_as_text(
        self, sheet_id_json: str, row: int, col: int, value: str
    ) -> Any:
        """Set a cell as literal text, bypassing rich input parsing."""
        if not hasattr(self._engine, "compute_set_cell_value_as_text"):
            sheet_id = json.loads(sheet_id_json)
            edits_json = json.dumps(
                [(sheet_id, row, col, {"kind": "literal", "text": value})]
            )
            return self.call_json(
                "compute_batch_set_cells_by_position", edits_json, False
            )
        return self.call_json(
            "compute_set_cell_value_as_text", sheet_id_json, row, col, value
        )

    def set_cell_values_parsed(
        self, sheet_id_json: str, updates_json: str
    ) -> Any:
        """Batch-set cell values."""
        if not hasattr(self._engine, "compute_set_cell_values_parsed"):
            updates = json.loads(updates_json)
            cells = [
                {"row": int(row), "col": int(col), "value": str(value)}
                for row, col, value in updates
            ]
            return self.call_json(
                "compute_set_cells_batch", sheet_id_json, json.dumps(cells)
            )
        return self.call_json(
            "compute_set_cell_values_parsed", sheet_id_json, updates_json
        )

    def get_cell_value(self, sheet_id_json: str, row: int, col: int) -> Any:
        """Get the semantic value of a cell (returns JSON)."""
        return self.call_json("compute_get_cell_value", sheet_id_json, row, col)

    def get_range_values_2d(
        self, sheet_id_json: str, sr: int, sc: int, er: int, ec: int
    ) -> Any:
        """Get a 2D grid of cell values (returns JSON)."""
        return self.call_json(
            "compute_get_range_values_2d", sheet_id_json, sr, sc, er, ec
        )

    def get_display_value(self, sheet_id_json: str, row: int, col: int) -> str:
        """Get the formatted display value of a cell."""
        return self.call("compute_get_display_value", sheet_id_json, row, col)

    def get_raw_value(self, sheet_id_json: str, row: int, col: int) -> str:
        """Get the raw value (formula bar content)."""
        return self.call("compute_get_raw_value", sheet_id_json, row, col)

    def get_cell_data(self, sheet_id_json: str, row: int, col: int) -> Any:
        """Get full cell data as JSON."""
        return self.call_json("compute_get_cell_data", sheet_id_json, row, col)

    def clear_range(
        self, sheet_id_json: str, sr: int, sc: int, er: int, ec: int
    ) -> Any:
        """Clear all cells in a range."""
        return self.call_json("compute_clear_range", sheet_id_json, sr, sc, er, ec)

    # ------------------------------------------------------------------
    # Sheet enumeration
    # ------------------------------------------------------------------

    def get_sheet_order(self) -> List[str]:
        """Return hex sheet IDs in tab order."""
        result = self.call_json("compute_get_sheet_order")
        if isinstance(result, list):
            return result
        return []

    def get_sheet_name(self, sheet_id_json: str) -> Optional[str]:
        """Return the name of a sheet (or None if not found)."""
        result = self.call("compute_get_sheet_name", sheet_id_json)
        # The native module returns a JSON-serialized string — unwrap it.
        if isinstance(result, str):
            try:
                return json.loads(result)
            except (json.JSONDecodeError, TypeError):
                return result
        return result

    # ------------------------------------------------------------------
    # Recalculation
    # ------------------------------------------------------------------

    def full_recalc(self, options_json: str) -> Any:
        """Perform a full recalculation."""
        return self.call_json("compute_full_recalc", options_json)

    # ------------------------------------------------------------------
    # Undo / Redo
    # ------------------------------------------------------------------

    def undo(self) -> Any:
        """Undo the last edit."""
        return self.call_json("compute_undo")

    def redo(self) -> Any:
        """Redo the last undone edit."""
        return self.call_json("compute_redo")

    def can_undo(self) -> bool:
        return self.call("compute_can_undo")

    def can_redo(self) -> bool:
        return self.call("compute_can_redo")

    def get_undo_state(self) -> Any:
        return self.call_json("compute_get_undo_state")

    def begin_undo_group(self) -> Any:
        return self.call_json("compute_begin_undo_group")

    def end_undo_group(self) -> Any:
        return self.call_json("compute_end_undo_group")

    # ------------------------------------------------------------------
    # Sheet CRUD
    # ------------------------------------------------------------------

    def create_sheet(self, name: str) -> Any:
        return self.call_json("compute_create_sheet", name)

    def delete_sheet(self, sheet_id_json: str) -> Any:
        return self.call_json("compute_delete_sheet", sheet_id_json)

    def rename_compute_sheet(self, sheet_id_json: str, name: str) -> Any:
        return self.call_json("compute_rename_compute_sheet", sheet_id_json, name)

    def copy_sheet(self, sheet_id_json: str, new_name: str) -> Any:
        return self.call_json("compute_copy_sheet", sheet_id_json, new_name)

    def set_sheet_hidden(self, sheet_id_json: str, hidden: bool) -> Any:
        return self.call_json("compute_set_sheet_hidden", sheet_id_json, hidden)

    def move_sheet(self, sheet_id_json: str, new_index: int) -> Any:
        return self.call_json("compute_move_sheet", sheet_id_json, new_index)

    # ------------------------------------------------------------------
    # Structural operations
    # ------------------------------------------------------------------

    def structure_change(self, sheet_id_json: str, change_json: str) -> Any:
        return self.call_json("compute_structure_change", sheet_id_json, change_json)

    def merge_range(
        self, sheet_id_json: str, sr: int, sc: int, er: int, ec: int
    ) -> Any:
        return self.call_json(
            "compute_merge_range", sheet_id_json, sr, sc, er, ec
        )

    def unmerge_range(
        self, sheet_id_json: str, sr: int, sc: int, er: int, ec: int
    ) -> Any:
        return self.call_json(
            "compute_unmerge_range", sheet_id_json, sr, sc, er, ec
        )

    # ------------------------------------------------------------------
    # Formatting
    # ------------------------------------------------------------------

    def get_cell_format(
        self, sheet_id_json: str, cell_id_json: str, row: int, col: int
    ) -> Any:
        return self.call_json(
            "compute_get_cell_format", sheet_id_json, cell_id_json, row, col
        )

    def set_cell_format(
        self, sheet_id_json: str, cell_id_json: str, format_json: str
    ) -> Any:
        return self.call_json(
            "compute_set_cell_format", sheet_id_json, cell_id_json, format_json
        )

    def toggle_format_property(
        self,
        sheet_id_json: str,
        ranges_json: str,
        property_name: str,
        active_row: int,
        active_col: int,
    ) -> Any:
        return self.call_json(
            "compute_toggle_format_property",
            sheet_id_json,
            ranges_json,
            property_name,
            active_row,
            active_col,
        )

    def set_format_for_ranges(
        self, sheet_id_json: str, ranges_json: str, format_json: str
    ) -> Any:
        return self.call_json(
            "compute_set_format_for_ranges",
            sheet_id_json,
            ranges_json,
            format_json,
        )

    def clear_format_for_ranges(self, sheet_id_json: str, ranges_json: str) -> Any:
        return self.call_json(
            "compute_clear_format_for_ranges", sheet_id_json, ranges_json
        )

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------

    def set_row_height(self, sheet_id_json: str, row: int, height: float) -> Any:
        return self.call_json("compute_set_row_height", sheet_id_json, row, height)

    def set_col_width(self, sheet_id_json: str, col: int, width: float) -> Any:
        return self.call_json("compute_set_col_width", sheet_id_json, col, width)

    def set_frozen_panes(self, sheet_id_json: str, rows: int, cols: int) -> Any:
        return self.call_json("compute_set_frozen_panes", sheet_id_json, rows, cols)

    def hide_rows(self, sheet_id_json: str, rows_json: str) -> Any:
        return self.call_json("compute_hide_rows", sheet_id_json, rows_json)

    def unhide_rows(self, sheet_id_json: str, rows_json: str) -> Any:
        return self.call_json("compute_unhide_rows", sheet_id_json, rows_json)

    def hide_columns(self, sheet_id_json: str, cols_json: str) -> Any:
        return self.call_json("compute_hide_columns", sheet_id_json, cols_json)

    def unhide_columns(self, sheet_id_json: str, cols_json: str) -> Any:
        return self.call_json("compute_unhide_columns", sheet_id_json, cols_json)

    # ------------------------------------------------------------------
    # Tables
    # ------------------------------------------------------------------

    def create_table(
        self,
        sheet_id_json: str,
        name: str,
        sr: int,
        sc: int,
        er: int,
        ec: int,
        columns_json: str,
        has_headers: bool,
    ) -> Any:
        return self.call_json(
            "compute_create_table",
            sheet_id_json,
            name,
            sr,
            sc,
            er,
            ec,
            columns_json,
            has_headers,
        )

    def delete_table(self, table_name: str) -> Any:
        return self.call_json("compute_delete_table", table_name)

    def get_all_tables_in_sheet(self, sheet_id_json: str) -> Any:
        return self.call_json("compute_get_all_tables_in_sheet", sheet_id_json)

    # ------------------------------------------------------------------
    # Charts
    # ------------------------------------------------------------------

    def create_chart(self, sheet_id_json: str, config_json: str) -> Any:
        return self.call_json("compute_create_chart", sheet_id_json, config_json)

    def update_chart(
        self, sheet_id_json: str, chart_id: str, updates_json: str
    ) -> Any:
        return self.call_json(
            "compute_update_chart", sheet_id_json, chart_id, updates_json
        )

    def delete_chart(self, sheet_id_json: str, chart_id: str) -> Any:
        return self.call_json("compute_delete_chart", sheet_id_json, chart_id)

    def get_all_charts(self, sheet_id_json: str) -> Any:
        return self.call_json("compute_get_all_charts", sheet_id_json)

    # ------------------------------------------------------------------
    # Filters
    # ------------------------------------------------------------------

    def create_filter(self, sheet_id_json: str, config_json: str) -> Any:
        return self.call_json("compute_create_filter", sheet_id_json, config_json)

    def delete_filter(self, sheet_id_json: str, filter_id: str) -> Any:
        return self.call_json("compute_delete_filter", sheet_id_json, filter_id)

    def apply_filter(self, sheet_id_json: str, filter_id: str) -> Any:
        return self.call_json("compute_apply_filter", sheet_id_json, filter_id)

    def reapply_filter(self, sheet_id_json: str, filter_id: str) -> Any:
        return self.call_json("compute_reapply_filter", sheet_id_json, filter_id)

    # ------------------------------------------------------------------
    # Comments
    # ------------------------------------------------------------------

    def add_comment(
        self,
        sheet_id_json: str,
        cell_id: str,
        text: str,
        author: str,
        author_id: Optional[str],
        parent_id: Optional[str],
    ) -> Any:
        # author_id and parent_id are Option<String> (serde-tagged) in Rust,
        # so they need JSON encoding: None -> "null", "x" -> '"x"'
        return self.call_json(
            "compute_add_comment",
            sheet_id_json,
            cell_id,
            text,
            author,
            json.dumps(author_id),
            json.dumps(parent_id),
        )

    def get_all_comments(self, sheet_id_json: str) -> Any:
        return self.call_json("compute_get_all_comments", sheet_id_json)

    def delete_comment(self, sheet_id_json: str, comment_id: str) -> Any:
        return self.call_json("compute_delete_comment", sheet_id_json, comment_id)

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def find_cells_by_value(
        self,
        sheet_id_json: str,
        value: str,
        sr: Optional[int],
        sc: Optional[int],
        er: Optional[int],
        ec: Optional[int],
    ) -> Any:
        # start_row/start_col/end_row/end_col are Option<u32> (serde-tagged),
        # so they need JSON encoding: None -> "null", 5 -> "5"
        return self.call_json(
            "compute_find_cells_by_value",
            sheet_id_json,
            value,
            json.dumps(sr),
            json.dumps(sc),
            json.dumps(er),
            json.dumps(ec),
        )

    # ------------------------------------------------------------------
    # Data bounds
    # ------------------------------------------------------------------

    def get_data_bounds(self, sheet_id_json: str) -> Any:
        return self.call_json("compute_get_data_bounds", sheet_id_json)

    # ------------------------------------------------------------------
    # Named ranges
    # ------------------------------------------------------------------

    def create_named_range(self, input_json: str) -> Any:
        return self.call_json("compute_create_named_range", input_json)

    def remove_named_range(self, name: str) -> Any:
        return self.call_json("compute_remove_named_range", name)

    # ------------------------------------------------------------------
    # Sort
    # ------------------------------------------------------------------

    def sort_range(
        self,
        sheet_id_json: str,
        sr: int,
        sc: int,
        er: int,
        ec: int,
        options_json: str,
    ) -> Any:
        return self.call_json(
            "compute_sort_range",
            sheet_id_json,
            sr,
            sc,
            er,
            ec,
            options_json,
        )

    # ------------------------------------------------------------------
    # Cell ID lookup (for format operations)
    # ------------------------------------------------------------------

    def get_cell_id_at(self, sheet_id_json: str, row: int, col: int) -> Optional[str]:
        return self.call("compute_get_cell_id_at", sheet_id_json, row, col)

    def get_or_create_cell_id(self, sheet_id_json: str, row: int, col: int) -> Any:
        return self.call_json("compute_get_or_create_cell_id", sheet_id_json, row, col)

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def get_workbook_settings(self) -> Any:
        return self.call_json("compute_get_workbook_settings")

    def set_workbook_settings(self, settings_json: str) -> Any:
        return self.call_json("compute_set_workbook_settings", settings_json)

    def set_culture(self, culture: str) -> Any:
        return self.call_json("compute_set_culture", culture)

    def set_calculation_mode(self, mode: str) -> Any:
        return self.call_json("compute_set_calculation_mode", mode)
