"""Slicer operations -- ``ws.slicers.add()``, ``ws.slicers.get()``."""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class SlicersAPI:
    """Slicer CRUD operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add(self, config: Optional[Dict[str, Any]] = None, **kwargs: Any) -> MutationResult:
        """Create a slicer.

        Parameters
        ----------
        config:
            A dict describing the slicer (source table/pivot, field, position, etc.).
            Alternatively, pass keyword arguments which will be merged into *config*.
        **kwargs:
            Keyword arguments (``table_name``, ``column_name``, ``name``, ``caption``,
            ``source``, ``position``, ``id``, ``sheet_id``, ``style``, ``z_index``,
            ``locked``, ``show_header``, ``multi_select``, ``selected_values``, etc.)
            that are merged into the config dict.  Snake-case keys are converted to
            camelCase for the engine.
        """
        merged: Dict[str, Any] = dict(config) if config else {}
        # Merge keyword arguments, converting snake_case to camelCase
        _SNAKE_TO_CAMEL = {
            "table_name": "tableName",
            "column_name": "columnName",
            "sheet_id": "sheetId",
            "z_index": "zIndex",
            "show_header": "showHeader",
            "multi_select": "multiSelect",
            "selected_values": "selectedValues",
        }
        for key, value in kwargs.items():
            camel_key = _SNAKE_TO_CAMEL.get(key, key)
            merged[camel_key] = value
        raw = self._bridge.call_json(
            "compute_create_slicer",
            self._sheet_id_json,
            json.dumps(merged),
        )
        return deserialize_mutation_result(raw)

    def create(self, config: Optional[Dict[str, Any]] = None, **kwargs: Any) -> MutationResult:
        """Alias for :meth:`add`."""
        return self.add(config, **kwargs)

    def get(self, slicer_id: str) -> Optional[Dict[str, Any]]:
        """Get a slicer by ID.

        Returns the slicer dict or ``None`` if not found.
        """
        try:
            result = self._bridge.call_json(
                "compute_get_slicer_state", self._sheet_id_json, slicer_id
            )
            if isinstance(result, dict):
                # Ensure columnName is populated from source
                if "columnName" not in result and "source" in result:
                    src = result["source"]
                    if isinstance(src, dict):
                        result["columnName"] = src.get("columnCellId", "")
                return result
        except Exception:
            pass
        return None

    def remove(self, slicer_id: str) -> MutationResult:
        """Delete a slicer by ID."""
        raw = self._bridge.call_json(
            "compute_delete_slicer", self._sheet_id_json, slicer_id
        )
        return deserialize_mutation_result(raw)

    def delete(self, slicer_id: str) -> MutationResult:
        """Alias for :meth:`remove`."""
        return self.remove(slicer_id)

    def list(self) -> List[Dict[str, Any]]:
        """Get all slicers in this sheet."""
        result = self._bridge.call_json(
            "compute_get_all_slicers", self._sheet_id_json
        )
        if isinstance(result, list):
            for s in result:
                if isinstance(s, dict):
                    # Ensure each slicer has columnName
                    if "columnName" not in s and "source" in s:
                        src = s["source"]
                        if isinstance(src, dict):
                            s["columnName"] = src.get("columnCellId", "")
                    # Ensure each slicer has a name field (engine stores caption)
                    if "name" not in s:
                        s["name"] = s.get("caption", s.get("id", ""))
            return result
        return []

    # ------------------------------------------------------------------
    # Selection
    # ------------------------------------------------------------------

    def set_selection(self, slicer_id: str, values: List[str]) -> None:
        """Set the selected values on a slicer.

        Clears the current selection then toggles each value on.
        """
        # Clear first
        self._bridge.call(
            "compute_clear_slicer_selection", self._sheet_id_json, slicer_id
        )
        # Toggle each value on (value must be JSON-encoded)
        for val in values:
            self._bridge.call(
                "compute_toggle_slicer_item", self._sheet_id_json, slicer_id,
                json.dumps(val),
            )

    def get_selection(self, slicer_id: str) -> List[str]:
        """Get the currently selected values of a slicer."""
        state = self.get(slicer_id)
        if isinstance(state, dict):
            sel = state.get("selectedValues", [])
            if isinstance(sel, list):
                return sel
        return []

    def clear_selection(self, slicer_id: str) -> None:
        """Clear all selections from a slicer."""
        self._bridge.call(
            "compute_clear_slicer_selection", self._sheet_id_json, slicer_id
        )

    # ------------------------------------------------------------------
    # Items
    # ------------------------------------------------------------------

    def get_items(self, slicer_id: str) -> List[Dict[str, Any]]:
        """Get the available items for a slicer.

        Returns a list of dicts with at minimum ``value`` and ``selected`` keys.
        """
        state = self.get(slicer_id)
        if not isinstance(state, dict):
            return []

        selected_values = set(state.get("selectedValues", []))
        source = state.get("source", {})

        # Get items by reading the source table data column
        if isinstance(source, dict) and source.get("type") == "table":
            table_id = source.get("tableId", "")
            column_name = source.get("columnCellId", "")
            items = self._get_table_column_values(table_id, column_name)
            if items is not None:
                # Deduplicate while preserving order
                seen: set = set()
                unique_items: List[str] = []
                for v in items:
                    if v not in seen:
                        seen.add(v)
                        unique_items.append(v)
                return [
                    {
                        "value": v,
                        "name": v,
                        "selected": v in selected_values,
                        "isSelected": v in selected_values,
                    }
                    for v in unique_items
                ]

        return []

    def _get_table_column_values(self, table_id: str, column_name: str) -> Optional[List[str]]:
        """Read column values from a table source."""
        try:
            tables = self._bridge.call_json(
                "compute_get_all_tables_in_sheet", self._sheet_id_json
            )
            if not isinstance(tables, list):
                return None
            for table in tables:
                if not isinstance(table, dict):
                    continue
                if table.get("id") != table_id and table.get("name") != table_id:
                    continue
                # Found the table
                rng = table.get("range", {})
                sr = rng.get("startRow", 0)
                sc = rng.get("startCol", 0)
                er = rng.get("endRow", 0)
                ec = rng.get("endCol", 0)
                has_header = table.get("hasHeaderRow", True)

                # Find the column index by matching column name in table columns
                col_idx = None
                columns = table.get("columns", [])
                for col in columns:
                    if isinstance(col, dict) and col.get("name") == column_name:
                        col_idx = col.get("index", 0)
                        break

                # If column name not found in table columns, try to find it
                # by reading the header row
                if col_idx is None and has_header:
                    header_vals = self._bridge.get_range_values_2d(
                        self._sheet_id_json, sr, sc, sr, ec
                    )
                    if isinstance(header_vals, list) and len(header_vals) > 0:
                        header_row = header_vals[0] if isinstance(header_vals[0], list) else header_vals
                        for idx, hv in enumerate(header_row):
                            if hv == column_name or str(hv) == column_name:
                                col_idx = idx
                                break

                if col_idx is None:
                    return None

                # Read values from data rows (skip header)
                data_start = sr + (1 if has_header else 0)
                values = self._bridge.get_range_values_2d(
                    self._sheet_id_json, data_start, sc + col_idx, er, sc + col_idx
                )
                if isinstance(values, list):
                    result = []
                    for row in values:
                        if isinstance(row, list) and len(row) > 0:
                            v = row[0]
                            if v is not None:
                                result.append(str(v) if not isinstance(v, str) else v)
                        elif row is not None:
                            result.append(str(row) if not isinstance(row, str) else row)
                    return result
        except Exception:
            pass
        return None

    def get_item(self, slicer_id: str, key: str) -> Dict[str, Any]:
        """Get a specific item by key. Raises KeyError if not found."""
        items = self.get_items(slicer_id)
        for item in items:
            val = item.get("value", item.get("name", ""))
            if val == key:
                return item
        raise KeyError(f"Slicer item not found: {key!r}")

    def get_item_or_null_object(self, slicer_id: str, key: str) -> Optional[Dict[str, Any]]:
        """Get a specific item by key. Returns None if not found."""
        try:
            return self.get_item(slicer_id, key)
        except KeyError:
            return None

    # ------------------------------------------------------------------
    # State and config
    # ------------------------------------------------------------------

    def get_state(self, slicer_id: str) -> Optional[Dict[str, Any]]:
        """Get the full state of a slicer."""
        return self.get(slicer_id)

    def update_config(self, slicer_id: str, updates: Dict[str, Any]) -> MutationResult:
        """Update slicer configuration."""
        raw = self._bridge.call_json(
            "compute_update_slicer_config",
            self._sheet_id_json,
            slicer_id,
            json.dumps(updates),
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Duplicate
    # ------------------------------------------------------------------

    def duplicate(self, slicer_id: str) -> Optional[str]:
        """Duplicate a slicer. Returns the new slicer's ID."""
        # Get the existing slicer state
        state = self.get(slicer_id)
        if not isinstance(state, dict):
            return None

        # Create a new slicer with a new ID and offset position
        new_id = f"slicer-dup-{uuid.uuid4().hex[:8]}"
        new_config = dict(state)
        new_config["id"] = new_id

        # Offset position slightly
        pos = new_config.get("position", {})
        if isinstance(pos, dict):
            new_config["position"] = {
                **pos,
                "x": pos.get("x", 0) + 20,
                "y": pos.get("y", 0) + 20,
            }

        # Remove fields that shouldn't be in create config
        new_config.pop("columnName", None)

        try:
            self._bridge.call_json(
                "compute_create_slicer",
                self._sheet_id_json,
                json.dumps(new_config),
            )
            return new_id
        except Exception:
            return None
