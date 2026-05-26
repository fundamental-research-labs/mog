"""Print settings -- ``ws.print_.set_settings()``, ``ws.print_.set_area()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result, parse_range, _col_to_a1
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class PrintAPI:
    """Print settings and print area operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_titles")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._titles: Dict[str, str] = {}

    # Default values for required boolean fields in the Rust PrintSettings struct.
    _PRINT_DEFAULTS: Dict[str, Any] = {
        "gridlines": False,
        "headings": False,
        "hCentered": False,
        "vCentered": False,
        "blackAndWhite": False,
        "draft": False,
    }

    def set_settings(self, settings: Dict[str, Any]) -> MutationResult:
        """Set print settings for this sheet."""
        full = {**self._PRINT_DEFAULTS, **settings}
        raw = self._bridge.call_json(
            "compute_set_print_settings",
            self._sheet_id_json,
            json.dumps(full),
        )
        return deserialize_mutation_result(raw)

    def get_settings(self) -> Dict[str, Any]:
        """Get current print settings for this sheet."""
        result = self._bridge.call_json(
            "compute_get_print_settings", self._sheet_id_json
        )
        if isinstance(result, dict):
            return result
        return {}

    @staticmethod
    def _a1_to_print_range(range_str: str) -> Dict[str, int]:
        """Convert A1-style range to PrintRange dict."""
        sr, sc, er, ec = parse_range(range_str)
        return {"startRow": sr, "startCol": sc, "endRow": er, "endCol": ec}

    @staticmethod
    def _print_range_to_a1(pr: Dict[str, int]) -> str:
        """Convert PrintRange dict to A1-style range string."""
        sr = pr.get("startRow", pr.get("start_row", 0))
        sc = pr.get("startCol", pr.get("start_col", 0))
        er = pr.get("endRow", pr.get("end_row", 0))
        ec = pr.get("endCol", pr.get("end_col", 0))
        start = f"{_col_to_a1(sc)}{sr + 1}"
        end = f"{_col_to_a1(ec)}{er + 1}"
        return f"{start}:{end}"

    def set_area(self, range_str: str) -> MutationResult:
        """Set the print area for this sheet."""
        pr_json = json.dumps(self._a1_to_print_range(range_str))
        raw = self._bridge.call_json(
            "compute_set_print_area", self._sheet_id_json, pr_json
        )
        return deserialize_mutation_result(raw)

    def get_area(self) -> Optional[str]:
        """Get the print area for this sheet, or None if not set."""
        try:
            result = self._bridge.call_json(
                "compute_get_print_area", self._sheet_id_json
            )
            if result is None:
                return None
            if isinstance(result, dict):
                return self._print_range_to_a1(result)
            if isinstance(result, str):
                return result if result else None
        except Exception:
            return None
        return None

    def clear_area(self) -> MutationResult:
        """Clear the print area."""
        raw = self._bridge.call_json(
            "compute_set_print_area", self._sheet_id_json, "null"
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Page breaks
    # ------------------------------------------------------------------

    def add_page_break(self, config: Dict[str, Any]) -> MutationResult:
        """Add a page break.

        Parameters
        ----------
        config:
            Dict with ``type`` (``"horizontal"`` or ``"vertical"``) and ``index``.
        """
        break_type = config.get("type", "horizontal")
        index = config.get("index", 0)
        if break_type == "horizontal":
            raw = self._bridge.call_json(
                "compute_add_horizontal_page_break", self._sheet_id_json, index
            )
        else:
            raw = self._bridge.call_json(
                "compute_add_vertical_page_break", self._sheet_id_json, index
            )
        return deserialize_mutation_result(raw)

    def remove_page_break(self, config: Dict[str, Any]) -> MutationResult:
        """Remove a page break.

        Parameters
        ----------
        config:
            Dict with ``type`` (``"horizontal"`` or ``"vertical"``) and ``index``.
        """
        break_type = config.get("type", "horizontal")
        index = config.get("index", 0)
        if break_type == "horizontal":
            raw = self._bridge.call_json(
                "compute_remove_horizontal_page_break", self._sheet_id_json, index
            )
        else:
            raw = self._bridge.call_json(
                "compute_remove_vertical_page_break", self._sheet_id_json, index
            )
        return deserialize_mutation_result(raw)

    def get_page_breaks(self) -> List[Dict[str, Any]]:
        """Get all page breaks for this sheet."""
        try:
            result = self._bridge.call_json(
                "compute_get_page_breaks", self._sheet_id_json
            )
            if isinstance(result, list):
                return result
            if isinstance(result, dict):
                breaks: List[Dict[str, Any]] = []
                for rb in result.get("rowBreaks", []):
                    idx = rb.get("id", rb.get("index", 0)) if isinstance(rb, dict) else rb
                    breaks.append({"type": "horizontal", "index": idx})
                for cb in result.get("colBreaks", []):
                    idx = cb.get("id", cb.get("index", 0)) if isinstance(cb, dict) else cb
                    breaks.append({"type": "vertical", "index": idx})
                return breaks
        except Exception:
            pass
        return []

    def remove_all_page_breaks(self) -> MutationResult:
        """Remove all page breaks."""
        raw = self._bridge.call_json(
            "compute_clear_all_page_breaks", self._sheet_id_json
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Print titles (repeat rows/columns on every page)
    # ------------------------------------------------------------------

    def set_titles(self, config: Dict[str, str]) -> None:
        """Set print titles (rows/columns to repeat on every printed page)."""
        self._titles.update(config)

    def get_titles(self) -> Dict[str, str]:
        """Get the current print titles configuration."""
        return dict(self._titles)

    def clear_titles(self) -> None:
        """Clear all print titles."""
        self._titles.clear()
