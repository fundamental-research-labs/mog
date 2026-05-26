"""Structural operations -- ``ws.structure.insert_rows()``, ``ws.structure.delete_columns()``."""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple, Union

from mog._serde import _col_to_a1, deserialize_mutation_result, parse_a1, parse_range
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


def _unwrap_mutation(raw: Any) -> Any:
    """Extract the dict portion from a (bytes, dict) tuple if needed."""
    if isinstance(raw, tuple):
        for part in raw:
            if isinstance(part, dict):
                return part
    return raw


def _range_to_a1(sr: int, sc: int, er: int, ec: int) -> str:
    """Convert 0-based (sr, sc, er, ec) to A1 range string like 'A1:C3'."""
    return f"{_col_to_a1(sc)}{sr + 1}:{_col_to_a1(ec)}{er + 1}"


class StructureAPI:
    """Structural mutations (insert/delete rows/cols, merges) on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_protection_check")

    def __init__(self, bridge: Bridge, sheet_id_json: str, protection_check=None) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._protection_check = protection_check

    def _check_protection(self, op: str = "structural") -> None:
        """Raise if the sheet is protected and the operation is blocked."""
        if self._protection_check is not None and not self._protection_check(op):
            from mog.errors import MogError
            raise MogError(f"Cannot perform {op}: sheet is protected")

    # ------------------------------------------------------------------
    # Row / column insertion and deletion
    # ------------------------------------------------------------------

    def _sheet_id_hex(self) -> str:
        """Return the hex sheet ID (without JSON quotes)."""
        return json.loads(self._sheet_id_json)

    def insert_rows(self, at: int, count: int = 1) -> MutationResult:
        """Insert *count* rows at the given 0-based position.

        Returns a MutationResult with kind='insertRows'.
        """
        self._check_protection("insertRows")
        new_row_ids = [str(uuid.uuid4()) for _ in range(count)]
        change = {
            "InsertRows": {"at": at, "count": count, "new_row_ids": new_row_ids}
        }
        raw = self._bridge.structure_change(
            self._sheet_id_json, json.dumps(change)
        )
        result = deserialize_mutation_result(_unwrap_mutation(raw))
        # Enrich with structured receipt fields
        result.raw["kind"] = "insertRows"
        result.raw["sheetId"] = self._sheet_id_hex()
        result.raw["insertedAt"] = at
        result.raw["count"] = count
        return result

    def delete_rows(self, at: int, count: int = 1) -> MutationResult:
        """Delete *count* rows starting at the given 0-based position.

        Returns a MutationResult with kind='deleteRows'.
        """
        self._check_protection("deleteRows")
        change = {
            "DeleteRows": {"at": at, "count": count, "deleted_cell_ids": []}
        }
        raw = self._bridge.structure_change(
            self._sheet_id_json, json.dumps(change)
        )
        result = deserialize_mutation_result(_unwrap_mutation(raw))
        result.raw["kind"] = "deleteRows"
        result.raw["sheetId"] = self._sheet_id_hex()
        result.raw["deletedAt"] = at
        result.raw["count"] = count
        return result

    def insert_columns(self, at: int, count: int = 1) -> MutationResult:
        """Insert *count* columns at the given 0-based position.

        Returns a MutationResult with kind='insertColumns'.
        """
        self._check_protection("insertColumns")
        new_col_ids = [str(uuid.uuid4()) for _ in range(count)]
        change = {
            "InsertCols": {"at": at, "count": count, "new_col_ids": new_col_ids}
        }
        raw = self._bridge.structure_change(
            self._sheet_id_json, json.dumps(change)
        )
        result = deserialize_mutation_result(_unwrap_mutation(raw))
        result.raw["kind"] = "insertColumns"
        result.raw["sheetId"] = self._sheet_id_hex()
        result.raw["insertedAt"] = at
        result.raw["count"] = count
        return result

    def delete_columns(self, at: int, count: int = 1) -> MutationResult:
        """Delete *count* columns starting at the given 0-based position.

        Returns a MutationResult with kind='deleteColumns'.
        """
        self._check_protection("deleteColumns")
        change = {
            "DeleteCols": {"at": at, "count": count, "deleted_cell_ids": []}
        }
        raw = self._bridge.structure_change(
            self._sheet_id_json, json.dumps(change)
        )
        result = deserialize_mutation_result(_unwrap_mutation(raw))
        result.raw["kind"] = "deleteColumns"
        result.raw["sheetId"] = self._sheet_id_hex()
        result.raw["deletedAt"] = at
        result.raw["count"] = count
        return result

    # ------------------------------------------------------------------
    # Cell shift operations
    # ------------------------------------------------------------------

    def insert_cells_with_shift(
        self, sr: int, sc: int, er: int, ec: int, direction: str = "down"
    ) -> MutationResult:
        """Insert cells in a range and shift existing cells.

        Parameters
        ----------
        sr, sc, er, ec:
            0-based range coordinates.
        direction:
            ``"down"`` or ``"right"`` -- direction to shift existing cells.
        """
        shift_right = direction.lower() == "right"
        row_count = er - sr + 1
        col_count = ec - sc + 1
        raw = self._bridge.call_json(
            "compute_insert_cells_with_shift",
            self._sheet_id_json,
            sr, sc, row_count, col_count, shift_right,
        )
        result = deserialize_mutation_result(_unwrap_mutation(raw))
        result.raw["kind"] = "insertCells"
        result.raw["sheetId"] = self._sheet_id_hex()
        result.raw["range"] = {
            "startRow": sr, "startCol": sc, "endRow": er, "endCol": ec
        }
        result.raw["direction"] = direction
        return result

    def delete_cells_with_shift(
        self, sr: int, sc: int, er: int, ec: int, direction: str = "up"
    ) -> MutationResult:
        """Delete cells in a range and shift remaining cells.

        Parameters
        ----------
        sr, sc, er, ec:
            0-based range coordinates.
        direction:
            ``"up"`` or ``"left"`` -- direction to shift remaining cells.
        """
        shift_left = direction.lower() == "left"
        row_count = er - sr + 1
        col_count = ec - sc + 1
        raw = self._bridge.call_json(
            "compute_delete_cells_with_shift",
            self._sheet_id_json,
            sr, sc, row_count, col_count, shift_left,
        )
        result = deserialize_mutation_result(_unwrap_mutation(raw))
        result.raw["kind"] = "deleteCells"
        result.raw["sheetId"] = self._sheet_id_hex()
        result.raw["range"] = {
            "startRow": sr, "startCol": sc, "endRow": er, "endCol": ec
        }
        result.raw["direction"] = direction
        return result

    # ------------------------------------------------------------------
    # Remove duplicates
    # ------------------------------------------------------------------

    def remove_duplicates(
        self,
        range_str: str,
        columns: List[int],
        has_header: bool = False,
    ) -> Dict[str, Any]:
        """Remove duplicate rows from a range.

        Parameters
        ----------
        range_str:
            A1-style range string (e.g. ``"A1:B6"``).
        columns:
            List of 0-based column indices to check for duplicates.
        has_header:
            Whether the first row is a header row.

        Returns a dict with ``removedCount`` and ``remainingCount``.
        """
        sr, sc, er, ec = parse_range(range_str)
        raw = self._bridge.call_json(
            "compute_remove_duplicates",
            self._sheet_id_json,
            sr, sc, er, ec,
            json.dumps(columns),
            has_header,
        )
        # Extract data from the mutation result
        if isinstance(raw, dict):
            data = raw.get("data", {})
            if isinstance(data, dict):
                return {
                    "removedCount": data.get("duplicatesRemoved", 0),
                    "remainingCount": data.get("uniqueValuesRemaining", 0),
                }
        return {"removedCount": 0, "remainingCount": 0}

    # ------------------------------------------------------------------
    # Row / column counts
    # ------------------------------------------------------------------

    def get_row_count(self) -> int:
        """Return the number of rows containing data (uses data bounds)."""
        bounds = self._bridge.get_data_bounds(self._sheet_id_json)
        if bounds is None:
            return 0
        if isinstance(bounds, dict):
            max_row = bounds.get("maxRow", bounds.get("max_row", -1))
            if isinstance(max_row, (int, float)) and max_row >= 0:
                return int(max_row) + 1
        return 0

    def get_column_count(self) -> int:
        """Return the number of columns containing data (uses data bounds)."""
        bounds = self._bridge.get_data_bounds(self._sheet_id_json)
        if bounds is None:
            return 0
        if isinstance(bounds, dict):
            max_col = bounds.get("maxCol", bounds.get("max_col", -1))
            if isinstance(max_col, (int, float)) and max_col >= 0:
                return int(max_col) + 1
        return 0

    # ------------------------------------------------------------------
    # Merge operations
    # ------------------------------------------------------------------

    def merge(self, range_or_sr, sc=None, er=None, ec=None) -> MutationResult:
        """Merge cells in the given range.

        Accepts either an A1 range string (``"A1:C3"``) or four integer
        arguments ``(start_row, start_col, end_row, end_col)``.

        Returns a MutationResult with kind='merge' and range in A1 notation.
        """
        if sc is not None:
            sr, sc, er, ec = int(range_or_sr), int(sc), int(er), int(ec)
        else:
            sr, sc, er, ec = parse_range(range_or_sr)
        raw = self._bridge.merge_range(self._sheet_id_json, sr, sc, er, ec)
        result = deserialize_mutation_result(raw)
        result.raw["kind"] = "merge"
        result.raw["range"] = _range_to_a1(sr, sc, er, ec)
        return result

    def unmerge(self, range_or_sr, sc=None, er=None, ec=None) -> MutationResult:
        """Unmerge cells in the given range.

        Accepts either an A1 range string or four integer arguments.

        Returns a MutationResult with kind='unmerge' and range in A1 notation.
        """
        if sc is not None:
            sr, sc, er, ec = int(range_or_sr), int(sc), int(er), int(ec)
        else:
            sr, sc, er, ec = parse_range(range_or_sr)
        raw = self._bridge.unmerge_range(self._sheet_id_json, sr, sc, er, ec)
        result = deserialize_mutation_result(raw)
        result.raw["kind"] = "unmerge"
        result.raw["range"] = _range_to_a1(sr, sc, er, ec)
        return result

    def get_merged_regions(self) -> List[Any]:
        """Return a list of merged regions in this sheet."""
        result = self._bridge.call_json(
            "compute_get_all_merges_in_sheet", self._sheet_id_json
        )
        if isinstance(result, list):
            return result
        return []

    def get_merge_at_cell(
        self, address: Union[str, Tuple[int, int]]
    ) -> Optional[Dict[str, Any]]:
        """Get the merge region containing the given cell, or ``None``.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        """
        if isinstance(address, tuple):
            row, col = address
        else:
            row, col = parse_a1(address)
        result = self._bridge.call_json(
            "compute_get_merge_at_cell_query", self._sheet_id_json, row, col
        )
        if isinstance(result, dict):
            return result
        return None
