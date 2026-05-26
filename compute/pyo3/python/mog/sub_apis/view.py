"""View options -- ``ws.view.set_option()``, ``ws.view.get_options()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, Optional, Tuple

from mog._serde import deserialize_mutation_result, parse_a1
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class ViewAPI:
    """View options (gridlines, headers, zoom, frozen panes, etc.) on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_frozen_rows", "_frozen_cols")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._frozen_rows = 0
        self._frozen_cols = 0

    def set_option(self, key: str, value: Any) -> MutationResult:
        """Set a single view option."""
        raw = self._bridge.call_json(
            "compute_set_view_option",
            self._sheet_id_json,
            key,
            value,
        )
        return deserialize_mutation_result(raw)

    def get_options(self) -> Dict[str, Any]:
        """Get all view options for this sheet."""
        result = self._bridge.call_json(
            "compute_get_view_options_query", self._sheet_id_json
        )
        if isinstance(result, dict):
            return result
        return {}

    # Convenience aliases
    def get_view_options(self) -> Dict[str, Any]:
        """Alias for :meth:`get_options`."""
        return self.get_options()

    # ------------------------------------------------------------------
    # Gridlines / headings helpers
    # ------------------------------------------------------------------

    def set_gridlines(self, show: bool) -> MutationResult:
        """Toggle gridlines visibility."""
        return self.set_option("showGridlines", show)

    def set_headings(self, show: bool) -> MutationResult:
        """Toggle row/column headings visibility."""
        # Set both row and column headers
        self.set_option("showRowHeaders", show)
        return self.set_option("showColumnHeaders", show)

    # ------------------------------------------------------------------
    # Tab color
    # ------------------------------------------------------------------

    def set_tab_color(self, color: str) -> MutationResult:
        """Set the tab color for this sheet."""
        # Native expects a JSON-quoted string
        raw = self._bridge.call_json(
            "compute_set_tab_color", self._sheet_id_json, json.dumps(color)
        )
        return deserialize_mutation_result(raw)

    def get_tab_color(self) -> Optional[str]:
        """Get the tab color for this sheet, or None if not set."""
        try:
            result = self._bridge.call_json(
                "compute_get_tab_color_query", self._sheet_id_json
            )
            if result is None:
                return None
            if isinstance(result, str):
                return result if result else None
            if isinstance(result, dict):
                return result.get("color") or result.get("value")
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # Scroll position
    # ------------------------------------------------------------------

    def get_scroll_position(self) -> Dict[str, int]:
        """Get the current scroll position.

        Returns dict with ``topRow`` and ``leftCol``.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_scroll_position_query", self._sheet_id_json
            )
            if isinstance(result, dict):
                return {
                    "topRow": result.get("topRow", result.get("top_row", 0)),
                    "leftCol": result.get("leftCol", result.get("left_col", 0)),
                }
        except Exception:
            pass
        return {"topRow": 0, "leftCol": 0}

    def set_scroll_position(self, top_row: int, left_col: int) -> MutationResult:
        """Set the scroll position."""
        raw = self._bridge.call_json(
            "compute_set_scroll_position", self._sheet_id_json, top_row, left_col
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Split config
    # ------------------------------------------------------------------

    def get_split_config(self) -> Optional[Dict[str, Any]]:
        """Get the current split configuration, or None if not split."""
        try:
            result = self._bridge.call_json(
                "compute_get_split_config", self._sheet_id_json
            )
            if result is None or result == "" or result == "null":
                return None
            if isinstance(result, dict):
                return result if result else None
        except Exception:
            pass
        return None

    def set_split_config(self, config: Optional[Dict[str, Any]]) -> MutationResult:
        """Set or clear the split configuration."""
        config_json = json.dumps(config) if config is not None else "null"
        raw = self._bridge.call_json(
            "compute_set_split_config", self._sheet_id_json, config_json
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Frozen panes
    # ------------------------------------------------------------------

    def freeze_rows(self, count: int) -> MutationResult:
        """Freeze a number of rows at the top."""
        self._frozen_rows = count
        raw = self._bridge.set_frozen_panes(
            self._sheet_id_json, count, self._frozen_cols
        )
        return deserialize_mutation_result(raw)

    def freeze_columns(self, count: int) -> MutationResult:
        """Freeze a number of columns at the left."""
        self._frozen_cols = count
        raw = self._bridge.set_frozen_panes(
            self._sheet_id_json, self._frozen_rows, count
        )
        return deserialize_mutation_result(raw)

    def freeze_at(self, address: str) -> MutationResult:
        """Freeze panes at a given cell address."""
        row, col = parse_a1(address)
        self._frozen_rows = row
        self._frozen_cols = col
        raw = self._bridge.set_frozen_panes(self._sheet_id_json, row, col)
        return deserialize_mutation_result(raw)

    def unfreeze(self) -> MutationResult:
        """Unfreeze all panes (set frozen rows and cols to 0)."""
        self._frozen_rows = 0
        self._frozen_cols = 0
        raw = self._bridge.set_frozen_panes(self._sheet_id_json, 0, 0)
        return deserialize_mutation_result(raw)

    def get_frozen_panes(self) -> Dict[str, int]:
        """Get the current frozen pane state."""
        return {"rows": self._frozen_rows, "cols": self._frozen_cols}
