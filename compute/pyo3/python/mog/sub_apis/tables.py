"""Table operations -- ``ws.tables.create()``, ``ws.tables.delete()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

from mog._serde import (
    deserialize_cell_value,
    deserialize_mutation_result,
    normalize_value,
    parse_range,
)
from mog._unsupported import unsupported_api
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


def _col_letter(col: int) -> str:
    """Convert 0-based column index to A1-style letter(s)."""
    result = ""
    c = col
    while True:
        result = chr(ord("A") + c % 26) + result
        c = c // 26 - 1
        if c < 0:
            break
    return result


def _range_a1(sr: int, sc: int, er: int, ec: int) -> str:
    """Convert 0-based (sr, sc, er, ec) to A1:B2 style string."""
    return f"{_col_letter(sc)}{sr + 1}:{_col_letter(ec)}{er + 1}"


class TablesAPI:
    """Table CRUD operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_local_tables")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._local_tables: Dict[str, Dict[str, Any]] = {}

    def _ensure_local(self) -> None:
        """Sync local table cache from engine if empty."""
        if not self._local_tables:
            try:
                result = self._bridge.get_all_tables_in_sheet(self._sheet_id_json)
                if isinstance(result, list):
                    for t in result:
                        if isinstance(t, dict):
                            name = t.get("name")
                            if name:
                                # Convert engine range dict to A1 ref
                                rng = t.get("range")
                                if isinstance(rng, dict):
                                    sr = rng.get("startRow", 0)
                                    sc = rng.get("startCol", 0)
                                    er = rng.get("endRow", 0)
                                    ec = rng.get("endCol", 0)
                                    a1 = _range_a1(sr, sc, er, ec)
                                    t["ref"] = a1
                                    t["range"] = a1
                                    t["sr"] = sr
                                    t["sc"] = sc
                                    t["er"] = er
                                    t["ec"] = ec
                                    has_headers = t.get("hasHeaderRow", True)
                                    t["dataSr"] = sr + 1 if has_headers else sr
                                    t["dataEr"] = er
                                self._local_tables[name] = t
            except Exception:
                pass

    def create(
        self,
        range_str: str,
        name: str = "Table1",
        columns: Optional[List[str]] = None,
        has_headers: bool = True,
    ) -> MutationResult:
        """Create a new table.

        Parameters
        ----------
        range_str:
            A1-style range for the table (e.g. ``"A1:D10"``).
        name:
            Table name (e.g. ``"MyTable"``).
        columns:
            Optional column names.
        has_headers:
            Whether the first row of the range is a header row.
        """
        sr, sc, er, ec = parse_range(range_str)
        if columns is None:
            num_cols = ec - sc + 1
            columns = [f"Column{i + 1}" for i in range(num_cols)]
        columns_json = json.dumps(columns)
        try:
            raw = self._bridge.create_table(
                self._sheet_id_json, name, sr, sc, er, ec, columns_json, has_headers
            )
        except Exception:
            raw = None

        # Store table metadata locally
        data_sr = sr + 1 if has_headers else sr
        self._local_tables[name] = {
            "name": name,
            "ref": range_str,
            "range": range_str,
            "sr": sr, "sc": sc, "er": er, "ec": ec,
            "columns": list(columns),
            "hasHeaderRow": has_headers,
            "hasTotalsRow": False,
            "dataSr": data_sr,
            "dataEr": er,
        }
        return deserialize_mutation_result(raw) if raw else {}

    def list(self) -> List[Dict[str, Any]]:
        """Get all tables in this sheet."""
        self._ensure_local()
        return list(self._local_tables.values())

    def add(
        self,
        range_str: str,
        options_or_name: Any = None,
        *,
        name: Optional[str] = None,
        columns: Optional[List[str]] = None,
        has_headers: bool = True,
    ) -> MutationResult:
        """Create a table.

        Supports two calling conventions:

        - ``add("A1:C5", {"name": "Sales", "hasHeaders": True})``
        - ``add("A1:C5", name="Sales", has_headers=True)``
        """
        if isinstance(options_or_name, dict):
            opts = options_or_name
            name = opts.get("name", name)
            columns = opts.get("columns", columns)
            has_headers = opts.get("has_headers", opts.get("hasHeaders", has_headers))
        elif isinstance(options_or_name, str):
            name = options_or_name
        if name is None:
            name = "Table1"
        return self.create(range_str, name, columns=columns, has_headers=has_headers)

    def get(self, table_name: str) -> Optional[Dict[str, Any]]:
        """Get a table by name. Returns ``None`` if not found.

        Re-fetches geometry (range) from the engine so that structural
        changes (row/column inserts, table resize, etc.) are reflected,
        but preserves local-only properties (display options, renamed
        names, etc.).
        """
        # Refresh geometry from the engine for tables already in local cache
        try:
            result = self._bridge.get_all_tables_in_sheet(self._sheet_id_json)
            if isinstance(result, list):
                for t in result:
                    if isinstance(t, dict):
                        eng_name = t.get("name")
                        if not eng_name:
                            continue
                        # Convert engine range dict to A1 ref
                        rng = t.get("range")
                        if isinstance(rng, dict):
                            sr = rng.get("startRow", 0)
                            sc = rng.get("startCol", 0)
                            er = rng.get("endRow", 0)
                            ec = rng.get("endCol", 0)
                            a1 = _range_a1(sr, sc, er, ec)
                        else:
                            sr = sc = er = ec = None
                            a1 = None
                        # Only update tables that already exist in local cache
                        # and whose geometry was NOT locally modified (resize, etc.)
                        existing = self._local_tables.get(eng_name)
                        if existing is not None and sr is not None and not existing.get("_local_geometry"):
                            # Merge geometry only -- keep local-only props
                            existing["ref"] = a1
                            existing["range"] = a1
                            existing["sr"] = sr
                            existing["sc"] = sc
                            existing["er"] = er
                            existing["ec"] = ec
                            has_headers = existing.get("hasHeaderRow", True)
                            existing["dataSr"] = sr + 1 if has_headers else sr
                            has_totals = existing.get("hasTotalsRow", False)
                            existing["dataEr"] = er - 1 if has_totals else er
        except Exception:
            pass
        # Fall back to local cache (also bootstraps if cache is empty)
        self._ensure_local()
        return self._local_tables.get(table_name)

    def delete(self, table_name: str) -> MutationResult:
        """Delete a table by name."""
        try:
            raw = self._bridge.delete_table(table_name)
        except Exception:
            raw = None
        self._local_tables.pop(table_name, None)
        return deserialize_mutation_result(raw) if raw else {"kind": "tableRemove", "tableName": table_name}

    def remove(self, table_name: str) -> Dict[str, Any]:
        """Remove a table by name. Returns a receipt dict."""
        self.delete(table_name)
        return {"kind": "tableRemove", "tableName": table_name}

    # ------------------------------------------------------------------
    # Table mutations
    # ------------------------------------------------------------------

    def rename(self, old_name: str, new_name: str) -> None:
        """Rename a table."""
        table = self._local_tables.pop(old_name, None)
        if table is not None:
            table["name"] = new_name
            self._local_tables[new_name] = table

    def resize(self, table_name: str, new_range: str) -> Dict[str, Any]:
        """Resize a table to a new range. Returns a receipt dict."""
        sr, sc, er, ec = parse_range(new_range)
        table = self._local_tables.get(table_name)
        if table is not None:
            table["ref"] = new_range
            table["range"] = new_range
            table["sr"] = sr
            table["sc"] = sc
            table["er"] = er
            table["ec"] = ec
            has_headers = table.get("hasHeaderRow", True)
            table["dataSr"] = sr + 1 if has_headers else sr
            has_totals = table.get("hasTotalsRow", False)
            table["dataEr"] = er - 1 if has_totals else er
            table["_local_geometry"] = True
        return {"kind": "tableResize", "tableName": table_name, "newRange": new_range}

    def update(self, table_name: str, updates: Dict[str, Any]) -> None:
        """Update table properties."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table.update(updates)

    def toggle_totals_row(self, table_name: str) -> None:
        """Toggle the totals row on/off."""
        table = self._local_tables.get(table_name)
        if table is not None:
            current = table.get("hasTotalsRow", False)
            table["hasTotalsRow"] = not current
            er = table.get("er", 0)
            if not current:
                # Turning on: extend range by one row
                table["er"] = er + 1
                table["dataEr"] = er
            else:
                # Turning off: shrink range by one row
                table["dataEr"] = er
                table["er"] = er - 1 if er > table.get("sr", 0) else er

    def toggle_header_row(self, table_name: str) -> None:
        """Toggle the header row on/off."""
        table = self._local_tables.get(table_name)
        if table is not None:
            current = table.get("hasHeaderRow", True)
            table["hasHeaderRow"] = not current
            sr = table.get("sr", 0)
            if current:
                table["dataSr"] = sr
            else:
                table["dataSr"] = sr + 1

    def clear_filters(self, table_name: str) -> None:
        """Clear all filters on a table."""
        unsupported_api("ws.tables.clearFilters", "ws.tables.clear_filters")

    def apply_auto_expansion(self, table_name: str) -> None:
        """Apply auto-expansion to detect new adjacent data."""
        unsupported_api("ws.tables.applyAutoExpansion", "ws.tables.apply_auto_expansion")

    # ------------------------------------------------------------------
    # Column operations
    # ------------------------------------------------------------------

    def add_column(self, table_name: str, column_name: str) -> None:
        """Add a column to a table."""
        table = self._local_tables.get(table_name)
        if table is not None:
            cols = table.get("columns", [])
            cols.append(column_name)
            table["columns"] = cols
            table["ec"] = table.get("ec", 0) + 1

    def remove_column(self, table_name: str, column_index: int) -> None:
        """Remove a column from a table by index."""
        table = self._local_tables.get(table_name)
        if table is not None:
            cols = table.get("columns", [])
            if 0 <= column_index < len(cols):
                cols.pop(column_index)
                table["ec"] = table.get("ec", 0) - 1

    # ------------------------------------------------------------------
    # Range queries
    # ------------------------------------------------------------------

    def get_data_body_range(self, table_name: str) -> Optional[str]:
        """Get the A1-style range of the data body (excludes headers and totals)."""
        table = self._local_tables.get(table_name)
        if table is None:
            return None
        sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        er = table.get("er", 0)
        ec = table.get("ec", 0)
        if table.get("hasTotalsRow", False):
            er = er - 1
        return _range_a1(sr, sc, er, ec)

    def get_header_row_range(self, table_name: str) -> Optional[str]:
        """Get the A1-style range of the header row."""
        table = self._local_tables.get(table_name)
        if table is None or not table.get("hasHeaderRow", True):
            return None
        sr = table.get("sr", 0)
        sc = table.get("sc", 0)
        ec = table.get("ec", 0)
        return _range_a1(sr, sc, sr, ec)

    def get_total_row_range(self, table_name: str) -> Optional[str]:
        """Get the A1-style range of the totals row, or ``None`` if not shown."""
        table = self._local_tables.get(table_name)
        if table is None or not table.get("hasTotalsRow", False):
            return None
        er = table.get("er", 0)
        sc = table.get("sc", 0)
        ec = table.get("ec", 0)
        return _range_a1(er, sc, er, ec)

    # ------------------------------------------------------------------
    # Row operations
    # ------------------------------------------------------------------

    def get_row_count(self, table_name: str) -> int:
        """Get the number of data rows (excludes header and totals)."""
        table = self._local_tables.get(table_name)
        if table is None:
            return 0
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        return max(0, data_er - data_sr + 1)

    def get_row_values(self, table_name: str, row_index: int) -> Optional[List[Any]]:
        """Get the values of a data row by 0-based index."""
        table = self._local_tables.get(table_name)
        if table is None:
            return None
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        ec = table.get("ec", 0)
        abs_row = data_sr + row_index
        values = []
        for c in range(sc, ec + 1):
            raw = self._bridge.get_cell_value(self._sheet_id_json, abs_row, c)
            values.append(deserialize_cell_value(raw))
        return values

    def get_row_range(self, table_name: str, row_index: int) -> Optional[str]:
        """Get the A1-style range of a data row by 0-based index."""
        table = self._local_tables.get(table_name)
        if table is None:
            return None
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        ec = table.get("ec", 0)
        abs_row = data_sr + row_index
        return _range_a1(abs_row, sc, abs_row, ec)

    def set_row_values(self, table_name: str, row_index: int, values: List[Any]) -> None:
        """Set the values of a data row by 0-based index."""
        table = self._local_tables.get(table_name)
        if table is None:
            return
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        abs_row = data_sr + row_index
        updates = []
        for j, val in enumerate(values):
            updates.append((abs_row, sc + j, normalize_value(val)))
        if updates:
            updates_json = json.dumps(updates)
            self._bridge.set_cell_values_parsed(self._sheet_id_json, updates_json)

    def add_row(
        self,
        table_name: str,
        index: Optional[int] = None,
        values: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        """Add a new data row to a table. Returns a receipt dict."""
        table = self._local_tables.get(table_name)
        if table is None:
            return {"kind": "tableAddRow", "tableName": table_name, "index": 0}
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        new_row = data_er + 1
        # Extend table range
        if table.get("hasTotalsRow", False):
            table["er"] = table.get("er", 0) + 1
        else:
            table["er"] = new_row
        # Write values if provided
        if values is not None:
            sc = table.get("sc", 0)
            updates = []
            for j, val in enumerate(values):
                updates.append((new_row, sc + j, normalize_value(val)))
            if updates:
                updates_json = json.dumps(updates)
                self._bridge.set_cell_values_parsed(self._sheet_id_json, updates_json)
        row_idx = new_row - data_sr
        return {"kind": "tableAddRow", "tableName": table_name, "index": row_idx}

    def delete_row(self, table_name: str, row_index: int) -> Dict[str, Any]:
        """Delete a data row by 0-based index. Returns a receipt dict."""
        table = self._local_tables.get(table_name)
        if table is None:
            return {"kind": "tableDeleteRow", "tableName": table_name, "index": row_index}
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        sc = table.get("sc", 0)
        ec = table.get("ec", 0)
        abs_row = data_sr + row_index
        # Shift rows up
        for r in range(abs_row, data_er):
            updates = []
            for c in range(sc, ec + 1):
                val_raw = self._bridge.get_cell_value(self._sheet_id_json, r + 1, c)
                val = deserialize_cell_value(val_raw)
                updates.append((r, c, normalize_value(val)))
            if updates:
                self._bridge.set_cell_values_parsed(self._sheet_id_json, json.dumps(updates))
        # Clear last row
        for c in range(sc, ec + 1):
            self._bridge.set_cell_values_parsed(
                self._sheet_id_json, json.dumps([(data_er, c, "")])
            )
        # Shrink table
        if table.get("hasTotalsRow", False):
            table["er"] = table.get("er", 0) - 1
        else:
            table["er"] = data_er - 1
        return {"kind": "tableDeleteRow", "tableName": table_name, "index": row_index}

    # ------------------------------------------------------------------
    # Sort operations
    # ------------------------------------------------------------------

    def sort_apply(self, table_name: str, sort_fields: List[Dict[str, Any]]) -> None:
        """Apply sort to a table.

        Each sort field can use ``columnIndex`` (0-based relative to the table)
        or ``column`` (0-based absolute column index).
        """
        table = self._local_tables.get(table_name)
        if table is None:
            return
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        sc = table.get("sc", 0)
        ec = table.get("ec", 0)
        # Build criteria in the engine's expected format
        criteria = []
        for sf in sort_fields:
            # Determine absolute column
            if "columnIndex" in sf:
                col = sc + sf["columnIndex"]
            elif "column" in sf:
                col = sf["column"]
            else:
                col = sc
            # Determine direction
            ascending = sf.get("ascending", True)
            direction = "asc" if ascending else "desc"
            criteria.append({
                "column": col,
                "direction": direction,
                "sortBy": sf.get("sortBy", "value"),
                "caseSensitive": sf.get("caseSensitive", False),
            })
        options = {"criteria": criteria, "hasHeaders": False}
        try:
            self._bridge.sort_range(
                self._sheet_id_json, data_sr, sc, data_er, ec,
                json.dumps(options)
            )
        except Exception:
            pass

    def sort_clear(self, table_name: str) -> None:
        """Clear sort fields from a table."""
        unsupported_api("py.ws.tables.sort_clear", "ws.tables.sort_clear")

    # ------------------------------------------------------------------
    # Cell lookup
    # ------------------------------------------------------------------

    def get_at_cell(self, row: int, col: int) -> Optional[Dict[str, Any]]:
        """Find which table (if any) contains the given cell position."""
        self._ensure_local()
        for table in self._local_tables.values():
            sr = table.get("sr", -1)
            sc = table.get("sc", -1)
            er = table.get("er", -1)
            ec = table.get("ec", -1)
            if sr <= row <= er and sc <= col <= ec:
                return table
        return None

    # ------------------------------------------------------------------
    # Display options
    # ------------------------------------------------------------------

    def set_highlight_first_column(self, table_name: str, value: bool) -> None:
        """Set whether the first column is highlighted."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["emphasizeFirstColumn"] = value

    def set_highlight_last_column(self, table_name: str, value: bool) -> None:
        """Set whether the last column is highlighted."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["emphasizeLastColumn"] = value

    def set_show_banded_columns(self, table_name: str, value: bool) -> None:
        """Set banded columns display."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["bandedColumns"] = value

    def set_show_banded_rows(self, table_name: str, value: bool) -> None:
        """Set banded rows display."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["bandedRows"] = value

    def set_show_filter_button(self, table_name: str, value: bool) -> None:
        """Set filter button visibility."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["showFilterButtons"] = value

    def set_show_headers(self, table_name: str, value: bool) -> None:
        """Set header row visibility."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["hasHeaderRow"] = value
            sr = table.get("sr", 0)
            if value:
                table["dataSr"] = sr + 1
            else:
                table["dataSr"] = sr

    def set_show_totals(self, table_name: str, value: bool) -> None:
        """Set totals row visibility."""
        table = self._local_tables.get(table_name)
        if table is not None:
            was_showing = table.get("hasTotalsRow", False)
            table["hasTotalsRow"] = value
            if value and not was_showing:
                table["er"] = table.get("er", 0) + 1
            elif not value and was_showing:
                table["er"] = table.get("er", 0) - 1

    def set_style_preset(self, table_name: str, style: str) -> None:
        """Apply a style preset to a table."""
        table = self._local_tables.get(table_name)
        if table is not None:
            table["style"] = style

    # ------------------------------------------------------------------
    # Column range/value queries
    # ------------------------------------------------------------------

    def get_column_data_body_range(self, table_name: str, col_index: int) -> Optional[str]:
        """Get the A1 range for data cells of a column."""
        table = self._local_tables.get(table_name)
        if table is None:
            return None
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        abs_col = sc + col_index
        return _range_a1(data_sr, abs_col, data_er, abs_col)

    def get_column_header_range(self, table_name: str, col_index: int) -> Optional[str]:
        """Get the A1 range for the header cell of a column."""
        table = self._local_tables.get(table_name)
        if table is None or not table.get("hasHeaderRow", True):
            return None
        sr = table.get("sr", 0)
        sc = table.get("sc", 0)
        abs_col = sc + col_index
        return f"{_col_letter(abs_col)}{sr + 1}"

    def get_column_range(self, table_name: str, col_index: int) -> Optional[str]:
        """Get the full A1 range for a column (header + data)."""
        table = self._local_tables.get(table_name)
        if table is None:
            return None
        sr = table.get("sr", 0)
        sc = table.get("sc", 0)
        er = table.get("er", 0)
        abs_col = sc + col_index
        return _range_a1(sr, abs_col, er, abs_col)

    def get_column_total_range(self, table_name: str, col_index: int) -> Optional[str]:
        """Get the A1 range for the total cell of a column, or ``None``."""
        table = self._local_tables.get(table_name)
        if table is None or not table.get("hasTotalsRow", False):
            return None
        er = table.get("er", 0)
        sc = table.get("sc", 0)
        abs_col = sc + col_index
        return f"{_col_letter(abs_col)}{er + 1}"

    def get_column_values(self, table_name: str, col_index: int) -> Optional[List[Any]]:
        """Get data body values for a column."""
        table = self._local_tables.get(table_name)
        if table is None:
            return None
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        abs_col = sc + col_index
        values = []
        for r in range(data_sr, data_er + 1):
            raw = self._bridge.get_cell_value(self._sheet_id_json, r, abs_col)
            values.append(deserialize_cell_value(raw))
        return values

    def set_column_values(self, table_name: str, col_index: int, values: List[Any]) -> None:
        """Set data body values for a column."""
        table = self._local_tables.get(table_name)
        if table is None:
            return
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        sc = table.get("sc", 0)
        abs_col = sc + col_index
        updates = []
        for i, val in enumerate(values):
            updates.append((data_sr + i, abs_col, normalize_value(val)))
        if updates:
            self._bridge.set_cell_values_parsed(self._sheet_id_json, json.dumps(updates))

    # ------------------------------------------------------------------
    # Calculated columns
    # ------------------------------------------------------------------

    def set_calculated_column(self, table_name: str, col_index: int, formula: str) -> None:
        """Set a calculated column formula.

        Parameters
        ----------
        table_name:
            The table name.
        col_index:
            0-based column index within the table.
        formula:
            The formula string (e.g. ``'=[@Score]*2'``).
        """
        table = self._local_tables.get(table_name)
        if table is None:
            return
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        sc = table.get("sc", 0)
        abs_col = sc + col_index
        updates = []
        for r in range(data_sr, data_er + 1):
            updates.append((r, abs_col, formula))
        if updates:
            self._bridge.set_cell_values_parsed(self._sheet_id_json, json.dumps(updates))

    def clear_calculated_column(self, table_name: str, col_index: int) -> None:
        """Clear a calculated column formula."""
        table = self._local_tables.get(table_name)
        if table is None:
            return
        data_sr = table.get("dataSr", table.get("sr", 0) + 1)
        data_er = table.get("er", 0)
        if table.get("hasTotalsRow", False):
            data_er -= 1
        sc = table.get("sc", 0)
        abs_col = sc + col_index
        updates = []
        for r in range(data_sr, data_er + 1):
            updates.append((r, abs_col, ""))
        if updates:
            self._bridge.set_cell_values_parsed(self._sheet_id_json, json.dumps(updates))
