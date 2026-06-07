"""Filter operations -- ``ws.filters.set_auto_filter()``, ``ws.filters.get_auto_filter()``, etc."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog._unsupported import unsupported_python_path
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class FiltersAPI:
    """Auto-filter operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_auto_filter_id", "_auto_filter_range", "_auto_filter_range_obj")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._auto_filter_id: Optional[str] = None
        self._auto_filter_range: Optional[str] = None
        self._auto_filter_range_obj: Optional[Dict[str, int]] = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _find_first_filter_id(self) -> Optional[str]:
        """Find the first filter ID in this sheet from the engine."""
        if self._auto_filter_id:
            return self._auto_filter_id
        filters = self._bridge.call_json(
            "compute_get_filters_in_sheet", self._sheet_id_json
        )
        if isinstance(filters, list) and len(filters) > 0:
            f = filters[0]
            if isinstance(f, dict):
                fid = f.get("id") or f.get("filterId")
                if fid:
                    self._auto_filter_id = str(fid)
                    return self._auto_filter_id
            elif isinstance(f, str):
                self._auto_filter_id = f
                return f
        return None

    # ------------------------------------------------------------------
    # Auto-filter lifecycle
    # ------------------------------------------------------------------

    def set_auto_filter(self, range_str: str) -> MutationResult:
        """Create an auto-filter for the given A1 range string."""
        unsupported_python_path("ws.filters.set_auto_filter")
        from mog._serde import parse_range
        sr, sc, er, ec = parse_range(range_str)
        config = {
            "range": {"startRow": sr, "startCol": sc, "endRow": er, "endCol": ec},
            "filterType": "auto",
        }
        raw = self._bridge.create_filter(
            self._sheet_id_json, json.dumps(config)
        )
        result = deserialize_mutation_result(raw)
        # Track the auto-filter id and range
        self._auto_filter_range = range_str
        self._auto_filter_range_obj = {"startRow": sr, "startCol": sc, "endRow": er, "endCol": ec}
        # Try to extract the filter id from the result
        if isinstance(raw, dict):
            fid = raw.get("id") or raw.get("filterId")
            if fid:
                self._auto_filter_id = str(fid)
        elif isinstance(raw, tuple):
            for part in raw:
                if isinstance(part, dict):
                    fid = part.get("id") or part.get("filterId")
                    if fid:
                        self._auto_filter_id = str(fid)
                        break
        # If we still don't have it, query the engine
        if not self._auto_filter_id:
            self._find_first_filter_id()
        return result

    def create_auto_filter(self, range_obj: Dict[str, Any]) -> MutationResult:
        """Create an auto-filter from a range dict."""
        config = {
            "range": range_obj,
            "filterType": "auto",
        }
        raw = self._bridge.create_filter(
            self._sheet_id_json, json.dumps(config)
        )
        result = deserialize_mutation_result(raw)
        # Track the filter id
        self._auto_filter_id = None
        self._find_first_filter_id()
        return result

    def get_auto_filter(self) -> Any:
        """Get the current auto-filter state for this sheet.

        Uses compute_get_filters_in_sheet and compute_get_filter to assemble
        a state dict. Returns None if no filter exists.

        The returned dict always includes a ``range`` key as an A1-style string
        (if the filter has range information).
        """
        unsupported_python_path("ws.filters.get_auto_filter")
        filters = self._bridge.call_json(
            "compute_get_filters_in_sheet", self._sheet_id_json
        )
        if not isinstance(filters, list) or len(filters) == 0:
            self._auto_filter_id = None
            return None

        # Get the first filter's details
        first = filters[0]
        if isinstance(first, dict):
            fid = first.get("id") or first.get("filterId")
        elif isinstance(first, str):
            fid = first
        else:
            return None

        if not fid:
            return first  # Return the dict as-is if it has no id field

        self._auto_filter_id = str(fid)

        # Get full filter details
        try:
            detail = self._bridge.call_json(
                "compute_get_filter", self._sheet_id_json, str(fid)
            )
        except Exception:
            detail = first

        if isinstance(detail, dict):
            # Ensure range is an A1-style string for convenience
            range_obj = detail.get("range")
            if isinstance(range_obj, dict):
                sr = range_obj.get("startRow", 0)
                sc = range_obj.get("startCol", 0)
                er = range_obj.get("endRow", 0)
                ec = range_obj.get("endCol", 0)
                detail["range"] = self._range_to_a1(sr, sc, er, ec)
            elif self._auto_filter_range:
                # Use locally tracked range
                detail["range"] = self._auto_filter_range
            elif self._auto_filter_range_obj:
                ro = self._auto_filter_range_obj
                detail["range"] = self._range_to_a1(
                    ro["startRow"], ro["startCol"], ro["endRow"], ro["endCol"]
                )
            return detail
        # Return minimal state
        return {"id": str(fid), "filters": filters}

    @staticmethod
    def _range_to_a1(sr: int, sc: int, er: int, ec: int) -> str:
        """Convert 0-based range to A1-style string."""
        def col_letter(c: int) -> str:
            result = ""
            while True:
                result = chr(ord("A") + c % 26) + result
                c = c // 26 - 1
                if c < 0:
                    break
            return result
        return f"{col_letter(sc)}{sr+1}:{col_letter(ec)}{er+1}"

    def clear_auto_filter(self) -> MutationResult:
        """Remove the auto-filter from this sheet.

        Uses compute_clear_all_filters(sheet_id) to remove all filters.
        """
        unsupported_python_path("ws.filters.clear_auto_filter")
        raw = self._bridge.call_json(
            "compute_clear_all_filters", self._sheet_id_json
        )
        self._auto_filter_id = None
        self._auto_filter_range = None
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Filter CRUD (by ID)
    # ------------------------------------------------------------------

    def create(self, config: Dict[str, Any]) -> MutationResult:
        """Create a new filter from a configuration dict."""
        raw = self._bridge.create_filter(
            self._sheet_id_json, json.dumps(config)
        )
        return deserialize_mutation_result(raw)

    def delete(self, filter_id: str) -> MutationResult:
        """Delete a filter by ID."""
        raw = self._bridge.delete_filter(self._sheet_id_json, filter_id)
        if self._auto_filter_id == filter_id:
            self._auto_filter_id = None
        return deserialize_mutation_result(raw)

    def remove(self, filter_id: str) -> MutationResult:
        """Remove a filter by ID (alias for ``delete``)."""
        return self.delete(filter_id)

    def apply(self, filter_id: str) -> MutationResult:
        """Evaluate a filter and apply row visibility changes."""
        raw = self._bridge.apply_filter(self._sheet_id_json, filter_id)
        return deserialize_mutation_result(raw)

    def reapply(self, filter_id: str) -> MutationResult:
        """Re-evaluate an existing filter from a user reapply command."""
        raw = self._bridge.reapply_filter(self._sheet_id_json, filter_id)
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Filter listing / info
    # ------------------------------------------------------------------

    def list(self) -> List[Dict[str, Any]]:
        """List all filters in this sheet with full detail.

        Returns detailed information for each filter including resolved
        range and column filter criteria.
        """
        raw = self._bridge.call_json(
            "compute_get_filters_in_sheet", self._sheet_id_json
        )
        if not isinstance(raw, list):
            return []
        detailed: List[Dict[str, Any]] = []
        for f in raw:
            if isinstance(f, dict):
                fid = f.get("id") or f.get("filterId")
            elif isinstance(f, str):
                fid = f
            else:
                detailed.append(f)
                continue
            if fid:
                try:
                    detail = self._bridge.call_json(
                        "compute_get_filter", self._sheet_id_json, str(fid)
                    )
                    if isinstance(detail, dict):
                        detailed.append(detail)
                    else:
                        detailed.append(f if isinstance(f, dict) else {"id": fid})
                except Exception:
                    detailed.append(f if isinstance(f, dict) else {"id": fid})
            else:
                detailed.append(f if isinstance(f, dict) else {})
        return detailed

    def list_details(self) -> List[Dict[str, Any]]:
        """List all filters with detailed information.

        .. deprecated:: Use :meth:`list` instead, which now returns full detail.
        """
        unsupported_python_path("ws.filters.list_details")
        return self.list()

    def get_for_range(self, range_obj: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Get the filter that covers the given range.

        Searches all filters in the sheet and returns the one whose range
        overlaps the given range. Returns None if not found.
        """
        filters = self.list()
        for f in filters:
            if isinstance(f, dict):
                fid = f.get("id") or f.get("filterId")
                if fid:
                    try:
                        detail = self._bridge.call_json(
                            "compute_get_filter", self._sheet_id_json, str(fid)
                        )
                        if isinstance(detail, dict):
                            return detail
                    except Exception:
                        return f
                return f
            elif isinstance(f, str):
                try:
                    detail = self._bridge.call_json(
                        "compute_get_filter", self._sheet_id_json, f
                    )
                    if isinstance(detail, dict):
                        return detail
                except Exception:
                    return {"id": f}
        return None

    def get_info(self, filter_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed info about a filter by ID.

        Uses compute_get_filter(sheet_id, filter_id).
        """
        try:
            result = self._bridge.call_json(
                "compute_get_filter", self._sheet_id_json, filter_id
            )
            if isinstance(result, dict):
                return result
            return {"id": filter_id}
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Column-level filter criteria
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_criteria(criteria: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize filter criteria type names to match Rust enum variants.

        The Rust FilterCriteria enum expects: values, condition, topBottom, dynamic, color.
        Common aliases like "value" are mapped to "values".
        """
        result = dict(criteria)
        ctype = result.get("type")
        if ctype == "value":
            result["type"] = "values"
        return result

    def set_column_filter(self, col: int, criteria: Dict[str, Any]) -> MutationResult:
        """Set filter criteria on a column of the auto-filter.

        Uses compute_set_column_filter(sheet_id, filter_id, header_col, criteria).
        """
        filter_id = self._find_first_filter_id()
        if not filter_id:
            raise ValueError("No auto-filter exists on this worksheet")
        normalized = self._normalize_criteria(criteria)
        raw = self._bridge.call_json(
            "compute_set_column_filter",
            self._sheet_id_json,
            filter_id,
            col,
            json.dumps(normalized),
        )
        return deserialize_mutation_result(raw)

    def clear_column_filter(self, col: int) -> MutationResult:
        """Clear filter criteria from a column of the auto-filter.

        Uses compute_clear_column_filter(sheet_id, filter_id, header_col).
        """
        filter_id = self._find_first_filter_id()
        if not filter_id:
            raise ValueError("No auto-filter exists on this worksheet")
        raw = self._bridge.call_json(
            "compute_clear_column_filter",
            self._sheet_id_json,
            filter_id,
            col,
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Per-filter criteria (by filter ID)
    # ------------------------------------------------------------------

    def set_criteria(
        self, filter_id: str, col: int, criteria: Dict[str, Any]
    ) -> MutationResult:
        """Set filter criteria on a specific column for a given filter.

        Uses compute_set_column_filter(sheet_id, filter_id, header_col, criteria).
        """
        unsupported_python_path("ws.filters.set_criteria")
        normalized = self._normalize_criteria(criteria)
        raw = self._bridge.call_json(
            "compute_set_column_filter",
            self._sheet_id_json,
            filter_id,
            col,
            json.dumps(normalized),
        )
        return deserialize_mutation_result(raw)

    def clear_criteria(self, filter_id: str, col: int) -> MutationResult:
        """Clear filter criteria from a specific column for a given filter.

        Uses compute_clear_column_filter(sheet_id, filter_id, header_col).
        """
        unsupported_python_path("ws.filters.clear_criteria")
        raw = self._bridge.call_json(
            "compute_clear_column_filter",
            self._sheet_id_json,
            filter_id,
            col,
        )
        return deserialize_mutation_result(raw)

    def clear_all_criteria(self, filter_id: str) -> MutationResult:
        """Clear all criteria from a filter.

        Uses compute_clear_all_column_filters(sheet_id, filter_id).
        """
        raw = self._bridge.call_json(
            "compute_clear_all_column_filters",
            self._sheet_id_json,
            filter_id,
        )
        return deserialize_mutation_result(raw)

    # ------------------------------------------------------------------
    # Unique values
    # ------------------------------------------------------------------

    def get_unique_values(self, col: int) -> Any:
        """Get the unique values for a column in the auto-filter.

        Falls back to reading cell values from the column in the filter range.
        """
        # Try using active filters to get unique values
        filter_id = self._find_first_filter_id()
        if filter_id:
            return self.get_filter_unique_values(filter_id, col)
        raise ValueError("No auto-filter exists on this worksheet")

    def get_filter_unique_values(self, filter_id: str, col: int) -> Any:
        """Get the unique values for a column in a specific filter.

        Reads filter details and extracts unique values from the data range.
        """
        unsupported_python_path("ws.filters.get_filter_unique_values")
        # Determine the filter range
        filter_range = None
        try:
            detail = self._bridge.call_json(
                "compute_get_filter", self._sheet_id_json, filter_id
            )
            if isinstance(detail, dict):
                fr = detail.get("range", {})
                if isinstance(fr, dict) and fr.get("endRow", 0) > 0:
                    filter_range = fr
        except Exception:
            pass

        # Fall back to locally tracked range
        if filter_range is None and self._auto_filter_range_obj:
            filter_range = self._auto_filter_range_obj

        if filter_range is None:
            return []

        try:
            sr = filter_range.get("startRow", 0) + 1  # skip header
            sc = filter_range.get("startCol", 0) + col  # col is relative to filter start
            er = filter_range.get("endRow", 0)
            ec = sc
            if er < sr:
                return []
            values = self._bridge.call_json(
                "compute_get_range_values_2d",
                self._sheet_id_json,
                sr, sc, er, ec,
            )
            unique = []
            seen = set()
            if isinstance(values, list):
                for row in values:
                    if isinstance(row, list):
                        for cell in row:
                            v = cell
                            if isinstance(cell, dict):
                                v = cell.get("value", cell.get("formattedValue"))
                            if v is not None and v not in seen:
                                seen.add(v)
                                unique.append(v)
                    else:
                        v = row
                        if isinstance(row, dict):
                            v = row.get("value", row.get("formattedValue"))
                        if v is not None and v not in seen:
                            seen.add(v)
                            unique.append(v)
            return unique
        except Exception:
            pass
        return []

    # ------------------------------------------------------------------
    # Sort state
    # ------------------------------------------------------------------

    def get_sort_state(self, filter_id: str) -> Any:
        """Get the sort state for a filter.

        Uses compute_get_filter_sort_state(sheet_id, filter_id).
        """
        return self._bridge.call_json(
            "compute_get_filter_sort_state",
            self._sheet_id_json,
            filter_id,
        )

    def set_sort_state(self, filter_id: str, state: Dict[str, Any]) -> MutationResult:
        """Set the sort state for a filter.

        Uses compute_set_filter_sort_state(sheet_id, filter_id, state_json).
        """
        raw = self._bridge.call_json(
            "compute_set_filter_sort_state",
            self._sheet_id_json,
            filter_id,
            json.dumps(state),
        )
        return deserialize_mutation_result(raw)
