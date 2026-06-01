"""Sparkline operations -- ``ws.sparklines.add()``, ``ws.sparklines.delete()``."""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog._unsupported import unsupported_python_path
from mog.errors import NativeApiError
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class SparklinesAPI:
    """Sparkline CRUD operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def _get_sheet_id_str(self) -> str:
        """Extract the raw sheet ID string from the JSON-encoded value."""
        try:
            return json.loads(self._sheet_id_json)
        except (json.JSONDecodeError, TypeError):
            return self._sheet_id_json

    def add(self, config_or_location: Any, data_range: Any = None, sparkline_type: str = "line") -> MutationResult:
        """Add a sparkline.

        Supports two calling conventions:

        - ``add(config_dict)`` -- single dict with all sparkline options.
        - ``add(location_dict, data_range_dict, type_str)`` -- positional args.

        The Rust engine expects the sparkline JSON to have a ``cell`` field
        (with ``sheetId``, ``row``, ``col``) and a ``dataRange`` field.
        """
        sheet_id_str = self._get_sheet_id_str()

        if data_range is not None:
            # Multi-arg form: location dict, data_range dict, type string
            loc = config_or_location
            config = {
                "cell": {
                    "sheetId": sheet_id_str,
                    "row": loc.get("row", 0),
                    "col": loc.get("col", 0),
                },
                "dataRange": data_range,
                "type": sparkline_type,
            }
        else:
            config = dict(config_or_location)

        # Auto-generate an id if not provided
        if "id" not in config:
            config["id"] = uuid.uuid4().hex

        # Auto-fill sheetId from the parent worksheet if not provided
        if "sheetId" not in config:
            config["sheetId"] = sheet_id_str

        # Convert "location" to "cell" format if needed (the Rust struct uses "cell")
        if "location" in config and "cell" not in config:
            loc = config.pop("location")
            if isinstance(loc, dict):
                config["cell"] = {
                    "sheetId": loc.get("sheetId", sheet_id_str),
                    "row": loc.get("row", 0),
                    "col": loc.get("col", 0),
                }

        # Ensure "cell" has sheetId
        if "cell" in config and isinstance(config["cell"], dict):
            if "sheetId" not in config["cell"]:
                config["cell"]["sheetId"] = sheet_id_str

        raw = self._bridge.call_json(
            "compute_add_sparkline",
            self._sheet_id_json,
            json.dumps(config),
        )
        return deserialize_mutation_result(raw)

    def delete(self, sparkline_id: str) -> MutationResult:
        """Delete a sparkline by ID."""
        raw = self._bridge.call_json(
            "compute_delete_sparkline", self._sheet_id_json, sparkline_id
        )
        return deserialize_mutation_result(raw)

    def list(self) -> List[Dict[str, Any]]:
        """Get all sparklines in this sheet."""
        result = self._bridge.call_json(
            "compute_get_sparklines_in_sheet", self._sheet_id_json
        )
        if isinstance(result, list):
            return result
        raise NativeApiError(
            "compute_get_sparklines_in_sheet returned a non-list response"
        )

    def update(self, row: int, col: int, updates: Dict[str, Any]) -> MutationResult:
        """Update a sparkline at the given cell position.

        Uses compute_get_sparkline_at_cell to find the sparkline, then
        compute_update_sparkline to apply updates.
        """
        # Find the sparkline at the given cell
        sparkline = self._bridge.call_json(
            "compute_get_sparkline_at_cell", self._sheet_id_json, row, col
        )
        if sparkline is None:
            # Try finding by listing all and matching position
            all_sparklines = self.list()
            for s in all_sparklines:
                if isinstance(s, dict):
                    cell = s.get("cell", {})
                    if isinstance(cell, dict) and cell.get("row") == row and cell.get("col") == col:
                        sparkline = s
                        break

        if sparkline is None:
            raise ValueError(f"No sparkline found at row={row}, col={col}")

        sparkline_id = sparkline.get("id") if isinstance(sparkline, dict) else None
        if not sparkline_id:
            raise ValueError(f"Sparkline at row={row}, col={col} has no id")

        raw = self._bridge.call_json(
            "compute_update_sparkline",
            self._sheet_id_json,
            sparkline_id,
            json.dumps(updates),
        )
        return deserialize_mutation_result(raw)

    def get_at(self, row: int, col: int) -> Optional[Dict[str, Any]]:
        """Get the sparkline at a specific cell location.

        Uses compute_get_sparkline_at_cell(sheet_id, row, col).
        """
        result = self._bridge.call_json(
            "compute_get_sparkline_at_cell", self._sheet_id_json, row, col
        )
        if isinstance(result, dict):
            return result
        return result

    def clear_all(self) -> MutationResult:
        """Clear all sparklines from this sheet.

        Uses compute_clear_sparklines_for_sheet(sheet_id).
        """
        unsupported_python_path("ws.sparklines.clear_all")
        raw = self._bridge.call_json(
            "compute_clear_sparklines_for_sheet", self._sheet_id_json
        )
        return deserialize_mutation_result(raw)

    def clear_in_range(self, range_obj: Dict[str, Any]) -> MutationResult:
        """Clear sparklines in the specified range.

        Uses compute_clear_sparklines_in_range(sheet_id, start_row, start_col, end_row, end_col).
        """
        sr = range_obj.get("startRow", 0)
        sc = range_obj.get("startCol", 0)
        er = range_obj.get("endRow", 0)
        ec = range_obj.get("endCol", 0)
        raw = self._bridge.call_json(
            "compute_clear_sparklines_in_range",
            self._sheet_id_json,
            sr, sc, er, ec,
        )
        return deserialize_mutation_result(raw)

    def list_groups(self) -> List[Dict[str, Any]]:
        """List all sparkline groups in this sheet.

        Uses compute_get_sparkline_groups_in_sheet(sheet_id).
        """
        result = self._bridge.call_json(
            "compute_get_sparkline_groups_in_sheet", self._sheet_id_json
        )
        if isinstance(result, list):
            return result
        raise NativeApiError(
            "compute_get_sparkline_groups_in_sheet returned a non-list response"
        )
