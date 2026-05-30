"""Layout operations -- ``ws.layout.set_row_height()``, ``ws.layout.freeze_rows()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Dict, List, Optional, Set, Tuple, Union

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class LayoutAPI:
    """Layout operations (dimensions, visibility, frozen panes) on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    # ------------------------------------------------------------------
    # Dimensions
    # ------------------------------------------------------------------

    def set_row_height(self, row: int, height: float) -> MutationResult:
        """Set the height of a row (in points)."""
        raw = self._bridge.set_row_height(self._sheet_id_json, row, height)
        return deserialize_mutation_result(raw)

    def set_column_width(self, col: int, width: float) -> MutationResult:
        """Set the width of a column (in character-width units, OOXML convention).

        The default column width is 8.43 character units.
        """
        raw = self._bridge.call_json(
            "compute_set_col_width_chars", self._sheet_id_json, col, width
        )
        return deserialize_mutation_result(raw)

    def set_column_width_px(self, col: int, width: float) -> MutationResult:
        """Set the width of a column (in pixels)."""
        raw = self._bridge.set_col_width(self._sheet_id_json, col, width)
        return deserialize_mutation_result(raw)

    def get_row_height(self, row: int) -> float:
        """Get the height of a row (in points).

        Returns the row height, or the default if not explicitly set.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_row_height_query", self._sheet_id_json, row
            )
            if isinstance(result, (int, float)):
                return float(result)
        except Exception:
            pass
        return self._get_default_row_height()

    def get_column_width(self, col: int) -> float:
        """Get the width of a column (in character-width units, OOXML convention).

        Returns the column width, or the default (8.43) if not explicitly set.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_col_width_chars_query", self._sheet_id_json, col
            )
            if isinstance(result, (int, float)):
                return float(result)
        except Exception:
            pass
        return self._get_default_col_width()

    def get_column_width_px(self, col: int) -> float:
        """Get the width of a column (in pixels).

        Returns the column width in pixels, or the default if not explicitly set.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_col_width_query", self._sheet_id_json, col
            )
            if isinstance(result, (int, float)):
                return float(result)
        except Exception:
            pass
        return 64.0

    def _get_default_row_height(self) -> float:
        try:
            result = self._bridge.call_json(
                "compute_get_default_row_height", self._sheet_id_json
            )
            if isinstance(result, (int, float)):
                return float(result)
        except Exception:
            pass
        return 21.0

    def _get_default_col_width(self) -> float:
        try:
            result = self._bridge.call_json(
                "compute_get_default_col_width_chars", self._sheet_id_json
            )
            if isinstance(result, (int, float)):
                return float(result)
        except Exception:
            pass
        return 8.43

    # ------------------------------------------------------------------
    # Batch dimension queries
    # ------------------------------------------------------------------

    def get_row_heights_batch(self, start: int, end: int) -> List[Tuple[int, float]]:
        """Get row heights for a range of rows.

        Returns a list of ``(row_index, height)`` tuples.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_row_heights_batch", self._sheet_id_json, start, end
            )
            if isinstance(result, list):
                return [(int(pair[0]), float(pair[1])) for pair in result]
        except Exception:
            pass
        # Fallback: query individually
        return [(r, self.get_row_height(r)) for r in range(start, end + 1)]

    def get_col_widths_batch(self, start: int, end: int) -> List[Tuple[int, float]]:
        """Get column widths for a range of columns (in character-width units).

        Returns a list of ``(col_index, width)`` tuples.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_col_widths_batch_chars", self._sheet_id_json, start, end
            )
            if isinstance(result, list):
                return [(int(pair[0]), float(pair[1])) for pair in result]
        except Exception:
            pass
        # Fallback: query individually
        return [(c, self.get_column_width(c)) for c in range(start, end + 1)]

    def get_col_widths_batch_px(self, start: int, end: int) -> List[Tuple[int, float]]:
        """Get column widths for a range of columns (in pixels).

        Returns a list of ``(col_index, width)`` tuples.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_col_widths_batch", self._sheet_id_json, start, end
            )
            if isinstance(result, list):
                return [(int(pair[0]), float(pair[1])) for pair in result]
        except Exception:
            pass
        # Fallback: query individually
        return [(c, self.get_column_width_px(c)) for c in range(start, end + 1)]

    # ------------------------------------------------------------------
    # Reset dimensions
    # ------------------------------------------------------------------

    def reset_column_width(self, col: int) -> MutationResult:
        """Reset a column width to the default value."""
        default = self._get_default_col_width()
        return self.set_column_width(col, default)

    def reset_row_height(self, row: int) -> MutationResult:
        """Reset a row height to the default value."""
        default = self._get_default_row_height()
        return self.set_row_height(row, default)

    # ------------------------------------------------------------------
    # Auto-fit
    # ------------------------------------------------------------------

    def auto_fit_column(self, col: int) -> MutationResult:
        """Auto-fit a single column width based on content."""
        raw = self._bridge.call_json(
            "compute_auto_fit_column_and_set", self._sheet_id_json, col
        )
        return deserialize_mutation_result(raw)

    def auto_fit_columns(self, cols: List[int]) -> MutationResult:
        """Auto-fit multiple column widths based on content."""
        raw = self._bridge.call_json(
            "compute_auto_fit_columns_and_set", self._sheet_id_json, json.dumps(cols)
        )
        return deserialize_mutation_result(raw)

    def auto_fit_row(self, row: int) -> MutationResult:
        """Auto-fit a single row height based on content."""
        raw = self._bridge.call_json(
            "compute_auto_fit_rows_and_set", self._sheet_id_json, json.dumps([row])
        )
        return deserialize_mutation_result(raw)

    def auto_fit_rows(self, rows: List[int]) -> MutationResult:
        """Auto-fit multiple row heights based on content."""
        raw = self._bridge.call_json(
            "compute_auto_fit_rows_and_set", self._sheet_id_json, json.dumps(rows)
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Visibility
    # ------------------------------------------------------------------

    def hide_rows(self, rows: List[int]) -> MutationResult:
        """Hide the specified rows."""
        raw = self._bridge.hide_rows(self._sheet_id_json, json.dumps(rows))
        return deserialize_mutation_result(raw)

    def unhide_rows(
        self,
        rows_or_start: Union[int, List[int], Tuple[int, ...]],
        end: Optional[int] = None,
    ) -> MutationResult:
        """Unhide the specified rows.

        Accepts either a list of row indices or a start/end range.
        """
        if end is not None:
            rows = list(range(int(rows_or_start), int(end) + 1))
        elif isinstance(rows_or_start, (list, tuple)):
            rows = list(rows_or_start)
        else:
            rows = [int(rows_or_start)]
        raw = self._bridge.unhide_rows(self._sheet_id_json, json.dumps(rows))
        return deserialize_mutation_result(raw)

    def hide_columns(self, cols: List[int]) -> MutationResult:
        """Hide the specified columns."""
        raw = self._bridge.hide_columns(self._sheet_id_json, json.dumps(cols))
        return deserialize_mutation_result(raw)

    def unhide_columns(
        self,
        cols_or_start: Union[int, List[int], Tuple[int, ...]],
        end: Optional[int] = None,
    ) -> MutationResult:
        """Unhide the specified columns.

        Accepts either a list of column indices or a start/end range.
        """
        if end is not None:
            cols = list(range(int(cols_or_start), int(end) + 1))
        elif isinstance(cols_or_start, (list, tuple)):
            cols = list(cols_or_start)
        else:
            cols = [int(cols_or_start)]
        raw = self._bridge.unhide_columns(self._sheet_id_json, json.dumps(cols))
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Row / column visibility queries
    # ------------------------------------------------------------------

    def is_row_hidden(self, row: int) -> bool:
        """Return ``True`` if the row is hidden."""
        try:
            result = self._bridge.call_json(
                "compute_is_row_hidden_query", self._sheet_id_json, row
            )
            if isinstance(result, bool):
                return result
        except Exception:
            pass
        return row in self.get_hidden_rows_bitmap()

    def is_column_hidden(self, col: int) -> bool:
        """Return ``True`` if the column is hidden."""
        try:
            result = self._bridge.call_json(
                "compute_is_col_hidden_query", self._sheet_id_json, col
            )
            if isinstance(result, bool):
                return result
        except Exception:
            pass
        return col in self.get_hidden_columns_bitmap()

    def get_hidden_rows_bitmap(self) -> Set[int]:
        """Return the set of hidden row indices."""
        try:
            result = self._bridge.call_json(
                "compute_get_hidden_rows", self._sheet_id_json
            )
            if isinstance(result, list):
                return set(int(r) for r in result)
        except Exception:
            pass
        return set()

    def get_hidden_columns_bitmap(self) -> Set[int]:
        """Return the set of hidden column indices."""
        try:
            result = self._bridge.call_json(
                "compute_get_hidden_columns", self._sheet_id_json
            )
            if isinstance(result, list):
                return set(int(c) for c in result)
        except Exception:
            pass
        return set()

    def set_row_visible(self, row: int, visible: bool) -> MutationResult:
        """Set the visibility of a single row."""
        if visible:
            return self.unhide_rows([row])
        else:
            return self.hide_rows([row])

    def set_column_visible(self, col: int, visible: bool) -> MutationResult:
        """Set the visibility of a single column."""
        if visible:
            return self.unhide_columns([col])
        else:
            return self.hide_columns([col])

    # ------------------------------------------------------------------
    # Frozen panes
    # ------------------------------------------------------------------

    def freeze_rows(self, count: int) -> MutationResult:
        """Freeze a number of rows at the top."""
        raw = self._bridge.set_frozen_panes(self._sheet_id_json, count, 0)
        return deserialize_mutation_result(raw)

    def freeze_columns(self, count: int) -> MutationResult:
        """Freeze a number of columns at the left."""
        raw = self._bridge.set_frozen_panes(self._sheet_id_json, 0, count)
        return deserialize_mutation_result(raw)

    def freeze(self, rows: int, cols: int) -> MutationResult:
        """Freeze a number of rows and columns."""
        raw = self._bridge.set_frozen_panes(self._sheet_id_json, rows, cols)
        return deserialize_mutation_result(raw)
