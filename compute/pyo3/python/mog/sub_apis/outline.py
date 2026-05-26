"""Outline (grouping) operations -- ``ws.outline.group_rows()``, etc."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result, parse_range
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class OutlineAPI:
    """Row/column grouping and outline operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    # ------------------------------------------------------------------
    # Grouping
    # ------------------------------------------------------------------

    def group_rows(self, start: int, end: int) -> MutationResult:
        """Group rows from *start* to *end* (inclusive, 0-based)."""
        raw = self._bridge.call_json(
            "compute_group_rows", self._sheet_id_json, start, end
        )
        return deserialize_mutation_result(raw)

    def group_columns(self, start: int, end: int) -> MutationResult:
        """Group columns from *start* to *end* (inclusive, 0-based)."""
        raw = self._bridge.call_json(
            "compute_group_columns", self._sheet_id_json, start, end
        )
        return deserialize_mutation_result(raw)

    def ungroup_rows(self, start: int, end: int) -> MutationResult:
        """Ungroup rows from *start* to *end* (inclusive, 0-based)."""
        raw = self._bridge.call_json(
            "compute_ungroup_rows", self._sheet_id_json, start, end
        )
        return deserialize_mutation_result(raw)

    def ungroup_columns(self, start: int, end: int) -> MutationResult:
        """Ungroup columns from *start* to *end* (inclusive, 0-based)."""
        raw = self._bridge.call_json(
            "compute_ungroup_columns", self._sheet_id_json, start, end
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # State queries
    # ------------------------------------------------------------------

    def get_state(self) -> Any:
        """Get the full outline state (row/column groups with collapsed status).

        Uses compute_get_groups for both axes and assembles a state dict.
        """
        row_groups = self._bridge.call_json(
            "compute_get_groups", self._sheet_id_json, "row"
        )
        col_groups = self._bridge.call_json(
            "compute_get_groups", self._sheet_id_json, "column"
        )
        return {
            "rowGroups": row_groups if isinstance(row_groups, list) else [],
            "columnGroups": col_groups if isinstance(col_groups, list) else [],
        }

    def get_level(self, axis: str, index: int) -> int:
        """Get the outline level for a specific row or column.

        Uses compute_get_row_outline_levels / compute_get_column_outline_levels
        for a single-element range and returns the level.
        """
        if axis == "row":
            result = self._bridge.call_json(
                "compute_get_row_outline_levels",
                self._sheet_id_json,
                index,
                index,
            )
        else:
            result = self._bridge.call_json(
                "compute_get_column_outline_levels",
                self._sheet_id_json,
                index,
                index,
            )
        if isinstance(result, list) and len(result) > 0:
            val = result[0]
            if isinstance(val, dict):
                level = val.get("level", 0)
                if isinstance(level, (int, float)):
                    return int(level)
            if isinstance(val, (int, float)):
                return int(val)
        if isinstance(result, (int, float)):
            return int(result)
        return 0

    def get_max_level(self, axis: str) -> int:
        """Get the maximum outline level for rows or columns.

        Uses compute_get_max_outline_level(sheet_id, axis).
        """
        result = self._bridge.call_json(
            "compute_get_max_outline_level", self._sheet_id_json, axis
        )
        if isinstance(result, (int, float)):
            return int(result)
        return 0

    # ------------------------------------------------------------------
    # Collapse / expand
    # ------------------------------------------------------------------

    def collapse_all(self) -> MutationResult:
        """Collapse all outline groups.

        Uses compute_collapse_all_groups(sheet_id).
        """
        raw = self._bridge.call_json(
            "compute_collapse_all_groups", self._sheet_id_json
        )
        return deserialize_mutation_result(raw)

    def expand_all(self) -> MutationResult:
        """Expand all outline groups.

        Uses compute_expand_all_groups(sheet_id).
        """
        raw = self._bridge.call_json(
            "compute_expand_all_groups", self._sheet_id_json
        )
        return deserialize_mutation_result(raw)

    def toggle_collapsed(self, group_id: str) -> MutationResult:
        """Toggle the collapsed state of a specific outline group.

        Uses compute_toggle_group_collapsed(sheet_id, group_id).
        """
        raw = self._bridge.call_json(
            "compute_toggle_group_collapsed", self._sheet_id_json, group_id
        )
        return deserialize_mutation_result(raw)

    def set_group_collapsed(self, group_id: str, collapsed: bool) -> MutationResult:
        """Set the collapsed state of a specific outline group."""
        raw = self._bridge.call_json(
            "compute_set_group_collapsed", self._sheet_id_json, group_id, collapsed
        )
        return deserialize_mutation_result(raw)

    def show_outline_levels(self, row_level: int, col_level: int) -> MutationResult:
        """Show rows/columns up to the specified outline levels.

        Groups at level <= the threshold are expanded; groups above are collapsed.
        Level 0 means collapse all groups; a very high level (e.g. 99) means
        expand everything.
        """
        raw = None

        # Handle row levels
        row_max = self.get_max_level("row")
        for lvl in range(1, max(row_max, row_level) + 1):
            collapsed = lvl > row_level
            raw = self._bridge.call_json(
                "compute_set_level_collapsed",
                self._sheet_id_json,
                "row",
                lvl,
                collapsed,
            )

        # Handle column levels
        col_max = self.get_max_level("column")
        for lvl in range(1, max(col_max, col_level) + 1):
            collapsed = lvl > col_level
            raw = self._bridge.call_json(
                "compute_set_level_collapsed",
                self._sheet_id_json,
                "column",
                lvl,
                collapsed,
            )

        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Subtotal
    # ------------------------------------------------------------------

    def subtotal(self, config: Dict[str, Any]) -> Any:
        """Create grouped subtotals from categorized data.

        Uses compute_create_subtotals(sheet_id, start_row, start_col, end_row, end_col, options).
        """
        range_val = config.get("range", {})

        # Handle A1 string range
        if isinstance(range_val, str):
            sr, sc, er, ec = parse_range(range_val)
        elif isinstance(range_val, dict):
            sr = range_val.get("startRow", 0)
            sc = range_val.get("startCol", 0)
            er = range_val.get("endRow", 0)
            ec = range_val.get("endCol", 0)
        else:
            sr, sc, er, ec = 0, 0, 0, 0

        # The remaining config fields are the options
        options = {k: v for k, v in config.items() if k != "range"}

        # Normalize field names for the engine:
        # - totalColumns -> subtotalColumns
        # - functions (list) -> function (first element as string)
        if "totalColumns" in options and "subtotalColumns" not in options:
            options["subtotalColumns"] = options.pop("totalColumns")
        if "functions" in options and "function" not in options:
            funcs = options.pop("functions")
            if isinstance(funcs, list) and len(funcs) > 0:
                options["function"] = funcs[0]
            elif isinstance(funcs, str):
                options["function"] = funcs

        return self._bridge.call_json(
            "compute_create_subtotals",
            self._sheet_id_json,
            sr,
            sc,
            er,
            ec,
            json.dumps(options),
        )

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def get_settings(self) -> Any:
        """Get outline settings (summaryRowsBelow, summaryRight, etc.).

        Uses compute_get_sheet_grouping_config(sheet_id).
        """
        return self._bridge.call_json(
            "compute_get_sheet_grouping_config", self._sheet_id_json
        )

    def set_settings(self, settings: Dict[str, Any]) -> Any:
        """Set outline settings.

        Uses compute_set_outline_settings(sheet_id, settings_json).
        """
        return self._bridge.call_json(
            "compute_set_outline_settings",
            self._sheet_id_json,
            json.dumps(settings),
        )

    # ------------------------------------------------------------------
    # Legacy methods
    # ------------------------------------------------------------------

    def auto_outline(self) -> MutationResult:
        """Automatically create an outline based on formulas.

        Uses compute_auto_outline(sheet_id, start_row, start_col, end_row, end_col).
        Passes a large default range.
        """
        raw = self._bridge.call_json(
            "compute_auto_outline", self._sheet_id_json, 0, 0, 999, 999
        )
        return deserialize_mutation_result(raw)

    def get_render_data(self) -> Any:
        """Get the outline render data for this sheet.

        Uses compute_get_outline_render_data(sheet_id, viewport_json).
        """
        # Pass a large default viewport
        viewport = json.dumps({
            "startRow": 0, "startCol": 0, "endRow": 1000, "endCol": 100
        })
        return self._bridge.call_json(
            "compute_get_outline_render_data", self._sheet_id_json, viewport
        )
