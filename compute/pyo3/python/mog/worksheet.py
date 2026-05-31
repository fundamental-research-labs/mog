"""Worksheet class -- primary interface for reading/writing cells in a sheet."""
from __future__ import annotations

import json
import re as _re
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple, Union

from mog._serde import (
    _col_to_a1,
    deserialize_cell_value,
    deserialize_cell_value_grid,
    deserialize_mutation_result,
    error_dict_to_display_string,
    normalize_value,
    parse_a1,
    parse_range,
)
from mog.errors import AddressError
from mog._unsupported import (
    unsupported_api,
    unsupported_proxy_from_surface,
    unsupported_python_path,
)
from mog.types import CellInfo, CellValue, DataBounds, MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.sub_apis.charts import ChartsAPI
    from mog.sub_apis.comments import CommentsAPI
    from mog.sub_apis.conditional_formats import ConditionalFormatsAPI
    from mog.sub_apis.filters import FiltersAPI
    from mog.sub_apis.formats import FormatsAPI
    from mog.sub_apis.hyperlinks import HyperlinksAPI
    from mog.sub_apis.layout import LayoutAPI
    from mog.sub_apis.objects import ObjectsAPI
    from mog.sub_apis.outline import OutlineAPI
    from mog.sub_apis.pivots import PivotsAPI
    from mog.sub_apis.print_ import PrintAPI
    from mog.sub_apis.protection import ProtectionAPI
    from mog.sub_apis.slicers import SlicersAPI
    from mog.sub_apis.sparklines import SparklinesAPI
    from mog.sub_apis.structure import StructureAPI
    from mog.sub_apis.tables import TablesAPI
    from mog.sub_apis.validation import ValidationAPI
    from mog.sub_apis.view import ViewAPI


# Known series seed values that the engine can extend (day/month names).
# When a single cell contains one of these, auto_fill uses "series" mode
# instead of "copy" mode.
_SERIES_SEEDS = frozenset(s.lower() for s in [
    # Full day names
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    # Abbreviated day names
    "sun", "mon", "tue", "wed", "thu", "fri", "sat",
    # Full month names
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    # Abbreviated month names
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
])


class Worksheet:
    """A handle to a single sheet within a workbook.

    Obtained via :attr:`Workbook.active_sheet`, :meth:`Workbook.get_sheet`,
    or :meth:`Workbook.get_sheet_by_index`.

    Cell addresses can be given as A1 strings (``"A1"``, ``"$B$3"``,
    ``"AA100"``) or as ``(row, col)`` tuples (0-based).
    """

    __slots__ = (
        "_bridge",
        "_sheet_id",
        "_sheet_id_json",
        "_name",
        # Lazy sub-API caches
        "_formats_api",
        "_structure_api",
        "_layout_api",
        "_tables_api",
        "_charts_api",
        "_filters_api",
        "_comments_api",
        "_conditional_formats_api",
        "_outline_api",
        "_view_api",
        "_protection_api",
        "_pivots_api",
        "_print_api",
        "_sparklines_api",
        "_objects_api",
        "_slicers_api",
        "_hyperlinks_api",
        "_validation_api",
        "_data_table_api",
        "_scenarios_api",
        "_pictures_api",
        "_names_api",
        "_form_controls_api",
        "_text_boxes_api",
        "_visibility_state",
        "_from_xlsx",
    )

    def __init__(self, bridge: Bridge, sheet_id: str, name: str) -> None:
        self._bridge = bridge
        self._sheet_id = sheet_id
        # Guard against double-JSON-quoting
        from mog._bridge import _ensure_json_quoted
        self._sheet_id_json = _ensure_json_quoted(sheet_id)
        self._name = name
        # Lazy sub-API caches
        self._formats_api: Optional[FormatsAPI] = None
        self._structure_api: Optional[StructureAPI] = None
        self._layout_api: Optional[LayoutAPI] = None
        self._tables_api: Optional[TablesAPI] = None
        self._charts_api: Optional[ChartsAPI] = None
        self._filters_api: Optional[FiltersAPI] = None
        self._comments_api: Optional[CommentsAPI] = None
        self._conditional_formats_api: Optional[ConditionalFormatsAPI] = None
        self._outline_api: Optional[OutlineAPI] = None
        self._view_api: Optional[ViewAPI] = None
        self._protection_api: Optional[ProtectionAPI] = None
        self._pivots_api: Optional[PivotsAPI] = None
        self._print_api: Optional[PrintAPI] = None
        self._sparklines_api: Optional[SparklinesAPI] = None
        self._objects_api: Optional[ObjectsAPI] = None
        self._slicers_api: Optional[SlicersAPI] = None
        self._hyperlinks_api: Optional[HyperlinksAPI] = None
        self._validation_api: Optional[ValidationAPI] = None
        self._data_table_api: Optional[Any] = None
        self._scenarios_api: Optional[Any] = None
        self._pictures_api: Optional[Any] = None
        self._names_api: Optional[Any] = None
        self._form_controls_api: Optional[Any] = None
        self._text_boxes_api: Optional[Any] = None
        self._visibility_state: str = "visible"
        self._from_xlsx: bool = False

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        """The sheet's display name."""
        return self._name

    @property
    def sheet_id(self) -> str:
        """The sheet's unique ID (hex string)."""
        return self._sheet_id

    # ------------------------------------------------------------------
    # Visibility
    # ------------------------------------------------------------------

    def is_visible(self) -> bool:
        """Return whether this sheet is visible (not hidden or veryHidden)."""
        hidden = self._bridge.call_json(
            "compute_is_sheet_hidden", self._sheet_id_json
        )
        if isinstance(hidden, bool):
            self._visibility_state = "hidden" if hidden else "visible"
        return self._visibility_state == "visible"

    def set_visible(self, visible: bool) -> bool:
        """Show or hide this sheet. Returns the new visibility state."""
        hidden = not visible
        self._bridge.set_sheet_hidden(self._sheet_id_json, hidden)
        self._visibility_state = "visible" if visible else "hidden"
        return visible

    def get_visibility(self) -> str:
        """Return the visibility state: ``"visible"`` or ``"hidden"``."""
        hidden = self._bridge.call_json(
            "compute_is_sheet_hidden", self._sheet_id_json
        )
        if isinstance(hidden, bool):
            self._visibility_state = "hidden" if hidden else "visible"
        return self._visibility_state

    def set_visibility(self, state: str) -> str:
        """Set the visibility state.

        Parameters
        ----------
        state:
            One of ``"visible"``, ``"hidden"``, or ``"veryHidden"``.

        Returns the new state string.
        """
        if state not in {"visible", "hidden", "veryHidden"}:
            raise ValueError("visibility state must be 'visible', 'hidden', or 'veryHidden'")
        if state == "veryHidden":
            unsupported_api("ws.setVisibility", "ws.set_visibility")
        hidden = state != "visible"
        self._bridge.set_sheet_hidden(self._sheet_id_json, hidden)
        self._visibility_state = state
        return state

    def __repr__(self) -> str:
        return f"Worksheet({self._name!r})"

    def __getattr__(self, name: str) -> Any:
        # Allow ws.print to work (print is a builtin, tricky as @property name)
        if name == "print":
            return self.print_
        raise AttributeError(f"'{type(self).__name__}' object has no attribute {name!r}")

    # ------------------------------------------------------------------
    # Address resolution
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_address(address: Union[str, Tuple[int, int]]) -> Tuple[int, int]:
        """Resolve an address to ``(row, col)``."""
        if isinstance(address, tuple):
            return address
        return parse_a1(address)

    @staticmethod
    def _resolve_range(
        range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> Tuple[int, int, int, int]:
        """Resolve a range to ``(sr, sc, er, ec)``."""
        if isinstance(range_ref, tuple):
            return range_ref
        return parse_range(range_ref)

    def _repair_formulas_in_range(
        self, sr: int, sc: int, er: int, ec: int
    ) -> None:
        """Re-set formula cells whose values aren't computed.

        After sort or redo the engine may not re-register formulas in the
        compute graph.  This helper detects such cells and re-writes them
        to force re-registration.
        """
        try:
            for r in range(sr, er + 1):
                for c in range(sc, ec + 1):
                    raw = self._bridge.get_raw_value(
                        self._sheet_id_json, r, c
                    )
                    if not isinstance(raw, str) or not raw.startswith("="):
                        continue
                    val = self._bridge.get_cell_value(
                        self._sheet_id_json, r, c
                    )
                    formula_body = raw[1:]
                    if val == formula_body:
                        self._bridge.set_cell_value_parsed(
                            self._sheet_id_json, r, c,
                            normalize_value(raw),
                        )
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Cell write operations
    # ------------------------------------------------------------------

    def _uses_text_number_format(self, row: int, col: int) -> bool:
        try:
            fmt = self._bridge.call_json(
                "compute_get_resolved_format", self._sheet_id_json, row, col
            )
            if isinstance(fmt, str):
                fmt = json.loads(fmt)
        except Exception:
            return False
        if not isinstance(fmt, dict):
            return False
        number_format = fmt.get("numberFormat") or fmt.get("number_format")
        number_format_type = fmt.get("numberFormatType") or fmt.get("number_format_type")
        return number_format == "@" or number_format_type == "text"

    def set_cell(
        self,
        address_or_row: Union[str, Tuple[int, int], int],
        value_or_col: Any = None,
        value: Any = None,
    ) -> None:
        """Set a cell's value.

        Supports two calling conventions:

        - ``set_cell("A1", 42)`` or ``set_cell((0, 0), 42)``
        - ``set_cell(0, 0, 42)``  (row, col, value)

        Parameters
        ----------
        address_or_row:
            A1 address, ``(row, col)`` tuple, or 0-based row index.
        value_or_col:
            The value (when using address form), or 0-based column index.
        value:
            The value (when using ``(row, col, value)`` form).
        """
        if value is not None:
            # 3-arg form: (row, col, value)
            row, col = int(address_or_row), int(value_or_col)
            write_value = value
        else:
            row, col = self._resolve_address(address_or_row)
            write_value = value_or_col
        # Check sheet protection before writing
        if self._protection_api is not None and self._protection_api.is_protected():
            if not self._protection_api.can_edit_cell(row, col):
                from mog.errors import MogError
                raise MogError("Cannot edit cell: sheet is protected and cell is locked")
        if isinstance(write_value, str) and self._uses_text_number_format(row, col):
            self._bridge.set_cell_value_as_text(self._sheet_id_json, row, col, write_value)
        else:
            self._bridge.set_cell_value_parsed(
                self._sheet_id_json, row, col, normalize_value(write_value)
            )

    def set_range(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
        values: List[List[Any]],
    ) -> None:
        """Set a range of cells from a 2D grid of values.

        Parameters
        ----------
        range_ref:
            A1-style range (``"A1:B2"``) or 0-based ``(sr, sc, er, ec)`` tuple.
        values:
            Row-major 2D list of values, e.g. ``[[1, 2], [3, 4]]``.
        """
        sr, sc, _er, _ec = self._resolve_range(range_ref)
        # Build updates as (row, col, input_string) triples
        updates = []
        for i, row_values in enumerate(values):
            for j, val in enumerate(row_values):
                updates.append((sr + i, sc + j, normalize_value(val)))
        updates_json = json.dumps(updates)
        self._bridge.set_cell_values_parsed(self._sheet_id_json, updates_json)

    _VALID_CLEAR_TYPES = frozenset({"all", "contents", "formats", "hyperlinks"})

    def clear(self, address_or_range: str, clear_type: str = "all") -> Dict[str, Any]:
        """Clear cells in an address or range.

        Parameters
        ----------
        address_or_range:
            A1 address (``"A1"``) or range (``"A1:B2"``).
        clear_type:
            What to clear: ``"all"`` (default), ``"contents"`` (values only),
            ``"formats"`` (formatting only), or ``"hyperlinks"``.

        Returns
        -------
        dict
            A result dict with ``cellCount`` and ``changes`` keys.

        Raises
        ------
        ValueError
            If *clear_type* is not one of the valid modes.
        """
        if clear_type not in self._VALID_CLEAR_TYPES:
            raise ValueError(
                f"Invalid clear mode {clear_type!r}. "
                f"Valid modes are: {', '.join(sorted(self._VALID_CLEAR_TYPES))}"
            )

        if ":" in address_or_range:
            sr, sc, er, ec = parse_range(address_or_range)
        else:
            row, col = parse_a1(address_or_range)
            sr, sc, er, ec = row, col, row, col

        cell_count = (er - sr + 1) * (ec - sc + 1)

        if clear_type == "contents":
            # Clear only values -- set each cell to empty
            for r in range(sr, er + 1):
                for c in range(sc, ec + 1):
                    self._bridge.set_cell_value_parsed(
                        self._sheet_id_json, r, c, ""
                    )
        elif clear_type == "formats":
            # Clear only formatting
            ranges_json = json.dumps([(sr, sc, er, ec)])
            self._bridge.clear_format_for_ranges(
                self._sheet_id_json, ranges_json
            )
        elif clear_type == "hyperlinks":
            unsupported_api("ws.clear", "ws.clear")
        else:
            # Clear everything
            self._bridge.clear_range(self._sheet_id_json, sr, sc, er, ec)

        return {
            "cellCount": cell_count,
            "count": cell_count,
            "cellsCleared": cell_count,
            "cells_cleared": cell_count,
            "diff": [],
            "changes": [],
            "dirty": [],
        }

    # ------------------------------------------------------------------
    # Cell read operations
    # ------------------------------------------------------------------

    def get_value(self, address: Union[str, Tuple[int, int]]) -> CellValue:
        """Get the computed value of a cell.

        For formula cells, returns the computed result.  For literal cells,
        returns the stored value.  Empty cells return ``None``.
        """
        row, col = self._resolve_address(address)
        raw = self._bridge.get_cell_value(self._sheet_id_json, row, col)
        value = deserialize_cell_value(raw)
        # Convert error dicts to display strings for get_value()
        # (get_cell() preserves the raw error dict in CellInfo.value)
        if isinstance(value, dict) and value.get("type") == "error":
            return error_dict_to_display_string(value)
        return value

    def get_display_value(
        self,
        address_or_row: Union[str, Tuple[int, int], int],
        col: Optional[int] = None,
    ) -> str:
        """Get the formatted display string of a cell (what the user sees).

        Supports ``get_display_value("A1")`` and ``get_display_value(0, 0)``.
        """
        if col is not None:
            row, c = int(address_or_row), col
        else:
            row, c = self._resolve_address(address_or_row)
        return self._bridge.get_display_value(self._sheet_id_json, row, c)

    def _get_compute_formula(self, row: int, col: int) -> Optional[str]:
        """Get the updated formula string from ComputeCore (with leading ``=``).

        After structural operations (insert/delete rows/cols), the Yrs CRDT
        still holds the *original* formula text while ComputeCore holds the
        correctly-adjusted version.  This helper reads from ComputeCore so
        callers always see the up-to-date formula.

        Returns ``None`` for non-formula cells.
        """
        cell_id = self._bridge.get_cell_id_at(self._sheet_id_json, row, col)
        if cell_id is not None:
            # cell_id comes from call() which returns a JSON-encoded string
            # (e.g. '"abc123..."').  compute_get_formula expects the same
            # JSON-encoded form, so pass it through as-is.
            try:
                formula_body = self._bridge.call_json("compute_get_formula", cell_id)
            except Exception:
                # Cell exists but has no formula (e.g. plain value from pivot
                # materialization) -- compute_get_formula may error on null.
                formula_body = None
            if isinstance(formula_body, str):
                # Rust may return the formula with or without the leading '='
                if formula_body.startswith("="):
                    return formula_body
                return "=" + formula_body
        # Fallback: read from Yrs raw value (e.g. if ComputeCore hasn't
        # registered the cell yet).
        raw = self._bridge.get_raw_value(self._sheet_id_json, row, col)
        if isinstance(raw, str) and raw.startswith("="):
            while raw.startswith("=="):
                raw = raw[1:]
            return raw
        return None

    def get_formula(self, address: Union[str, Tuple[int, int]]) -> Optional[str]:
        """Get the formula string if the cell is a formula cell.

        Returns ``None`` for non-formula cells.  The returned string
        includes the leading ``=``.
        """
        row, col = self._resolve_address(address)
        return self._get_compute_formula(row, col)

    def get_cell(self, address_or_row: Union[str, Tuple[int, int], int], col: Optional[int] = None) -> CellInfo:
        """Get full information about a cell.

        Supports ``get_cell("A1")``, ``get_cell((0, 0))``, and ``get_cell(0, 0)``.

        Returns a :class:`CellInfo` with value, formula, display_value,
        and raw_value.
        """
        if col is not None:
            row, col = int(address_or_row), int(col)
        else:
            row, col = self._resolve_address(address_or_row)

        # Fetch all pieces
        value_raw = self._bridge.get_cell_value(self._sheet_id_json, row, col)
        raw_value = self._bridge.get_raw_value(self._sheet_id_json, row, col)
        display_value = self._bridge.get_display_value(
            self._sheet_id_json, row, col
        )

        value = deserialize_cell_value(value_raw)
        # Preserve error dicts as-is in get_cell() so callers can inspect
        # type/value/message fields.  get_value() converts to display strings.
        formula = self._get_compute_formula(row, col)

        return CellInfo(
            value=value,
            formula=formula,
            display_value=display_value,
            raw_value=raw_value,
        )

    def get_range(
        self, range_ref: Union[str, Tuple[int, int, int, int]]
    ) -> List[List[Any]]:
        """Get a 2D grid of CellInfo dicts for a range.

        Each cell is a :class:`CellInfo` dict with ``value``, ``formula``,
        ``display_value``, ``raw_value``, ``formatted``, and ``format`` keys.
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        result: List[List[Any]] = []
        for r in range(sr, er + 1):
            row_cells: List[Any] = []
            for c in range(sc, ec + 1):
                value_raw = self._bridge.get_cell_value(self._sheet_id_json, r, c)
                raw_value = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                display_value = self._bridge.get_display_value(self._sheet_id_json, r, c)
                value = deserialize_cell_value(value_raw)
                # Preserve error dicts as-is (consistent with get_cell)
                formula = raw_value if isinstance(raw_value, str) and raw_value.startswith("=") else None
                if isinstance(formula, str):
                    while formula.startswith("=="):
                        formula = formula[1:]
                # Include format data (fontColor, bold, etc.) for parity with TS getRange
                fmt = self.formats.get(_col_to_a1(c) + str(r + 1))
                info = CellInfo(
                    value=value,
                    formula=formula,
                    display_value=display_value or "",
                    raw_value=raw_value or "",
                )
                info["format"] = fmt if fmt else {}
                row_cells.append(info)
            result.append(row_cells)
        return result

    def get_data_bounds(self) -> Optional[DataBounds]:
        """Get the used range (data bounds) of this sheet.

        Returns ``None`` if the sheet is empty.
        """
        raw = self._bridge.get_data_bounds(self._sheet_id_json)
        if raw is None:
            return None
        if isinstance(raw, dict):
            return DataBounds(
                min_row=raw.get("minRow", raw.get("min_row", 0)),
                min_col=raw.get("minCol", raw.get("min_col", 0)),
                max_row=raw.get("maxRow", raw.get("max_row", 0)),
                max_col=raw.get("maxCol", raw.get("max_col", 0)),
            )
        return None

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def find_by_value(
        self,
        value: str,
        range_ref: Optional[Union[str, Tuple[int, int, int, int]]] = None,
    ) -> List[Tuple[int, int]]:
        """Find all cells whose value loosely matches the given string.

        Parameters
        ----------
        value:
            The value to search for.  ``"42"`` matches ``Number(42.0)``.
        range_ref:
            Optional range to limit the search.  If omitted, the entire
            sheet is searched.

        Returns a list of ``(row, col)`` pairs.
        """
        if range_ref is not None:
            sr, sc, er, ec = self._resolve_range(range_ref)
            raw = self._bridge.find_cells_by_value(
                self._sheet_id_json, value, sr, sc, er, ec
            )
        else:
            raw = self._bridge.find_cells_by_value(
                self._sheet_id_json, value, None, None, None, None
            )
        if isinstance(raw, list):
            return [(r, c) for r, c in raw]
        return []

    # ------------------------------------------------------------------
    # Cell ID lookup (needed for some sub-APIs)
    # ------------------------------------------------------------------

    def get_cell_id(self, address: Union[str, Tuple[int, int]]) -> Optional[str]:
        """Get the internal CellId (hex) at an address, or ``None``."""
        row, col = self._resolve_address(address)
        return self._bridge.get_cell_id_at(self._sheet_id_json, row, col)

    # ------------------------------------------------------------------
    # Aliases and convenience methods expected by scenarios
    # ------------------------------------------------------------------

    def get_name(self) -> str:
        """Alias for the :attr:`name` property."""
        return self._name

    def set_name(self, name: str) -> None:
        """Rename this sheet."""
        self._bridge.rename_compute_sheet(self._sheet_id_json, name)
        self._name = name

    def get_sheet_id(self) -> str:
        """Alias for the :attr:`sheet_id` property."""
        unsupported_python_path("ws.get_sheet_id")

    def set_cells(self, cells: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Batch-set cells from a list of dicts.

        Each dict should have ``"address"`` (or ``"addr"`` or ``"row"``/``"col"``)
        and ``"value"`` keys.  Example::

            ws.set_cells([
                {"address": "A1", "value": 1},
                {"addr": "A2", "value": 2},
                {"row": 2, "col": 0, "value": 3},
            ])

        Returns a dict with ``cellsWritten``, ``errors``, and optionally
        ``warnings`` keys.
        """
        # Resolve all cells to (row, col, input_str) and detect duplicates
        resolved: Dict[Tuple[int, int], str] = {}  # key -> last value (last-write-wins)
        order: List[Tuple[int, int]] = []
        duplicate_count = 0

        for cell in cells:
            addr_key = cell.get("address") or cell.get("addr")
            if addr_key is not None:
                row, col = self._resolve_address(addr_key)
            elif "row" in cell and "col" in cell:
                row, col = int(cell["row"]), int(cell["col"])
            else:
                continue
            key = (row, col)
            if key in resolved:
                duplicate_count += 1
            else:
                order.append(key)
            resolved[key] = normalize_value(cell.get("value"))

        # Build updates in order (deduped)
        updates = [(r, c, resolved[(r, c)]) for r, c in order]
        if updates:
            updates_json = json.dumps(updates)
            self._bridge.set_cell_values_parsed(self._sheet_id_json, updates_json)

        result: Dict[str, Any] = {
            "cellsWritten": len(updates),
            "errors": None,
        }

        if duplicate_count > 0:
            result["warnings"] = [{
                "code": "API_DUPLICATE_COORDINATES",
                "message": f"{duplicate_count} duplicate coordinate(s) removed (last-write-wins)",
                "context": {
                    "duplicatesRemoved": duplicate_count,
                },
            }]
        else:
            result["warnings"] = None

        return result

    def sort_range(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
        options: Dict[str, Any],
    ) -> MutationResult:
        """Sort a range of cells.

        Parameters
        ----------
        range_ref:
            A1-style range or 0-based ``(sr, sc, er, ec)`` tuple.
        options:
            Sort options. Accepts either the engine format
            ``{"criteria": [...], "hasHeaders": True}`` or a simplified format
            ``{"column": 0, "ascending": True, "hasHeaders": True}``.
            For multi-column sort, pass ``{"columns": [...], "hasHeaders": True}``
            where each element is ``{"column": N, "ascending": bool}``.
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        # Transform simplified options to engine format
        if "criteria" not in options:
            criteria = []
            if "columns" in options:
                for col_spec in options["columns"]:
                    criteria.append({
                        "column": col_spec.get("column", 0),
                        "direction": "asc" if col_spec.get("ascending", True) else "desc",
                        "sortBy": "value",
                        "caseSensitive": col_spec.get("caseSensitive", False),
                    })
            elif "column" in options:
                criteria.append({
                    "column": options["column"],
                    "direction": "asc" if options.get("ascending", True) else "desc",
                    "sortBy": "value",
                    "caseSensitive": options.get("caseSensitive", False),
                })
            engine_opts = {
                "criteria": criteria,
                "hasHeaders": options.get("hasHeaders", False),
            }
        else:
            engine_opts = options
        raw = self._bridge.sort_range(
            self._sheet_id_json, sr, sc, er, ec, json.dumps(engine_opts)
        )
        # Workaround: After sort, formula cells may lose compute-graph
        # registration.  Re-set any formula cells in the sorted range to
        # force re-registration so their values are computed.
        self._repair_formulas_in_range(sr, sc, er, ec)
        return deserialize_mutation_result(raw)

    def auto_fill(self, source: str, target: str) -> Dict[str, Any]:
        """Auto-fill from a source range into a target range.

        Uses the native engine's auto-fill which supports:
        - Numeric series detection and extension
        - Day/month name series
        - Formula reference adjustment
        - Pattern detection from multiple source cells

        Returns an info dict with ``status`` and ``cells_filled``.
        """
        unsupported_python_path("ws.auto_fill")

    def _auto_fill_fallback(
        self, sr, sc, ser, sec, tr, tc, ter, tec
    ) -> Dict[str, Any]:
        """Fallback auto-fill: tile source values into target range."""
        source_raw = self._bridge.get_range_values_2d(
            self._sheet_id_json, sr, sc, ser, sec
        )
        source_vals = deserialize_cell_value_grid(source_raw)
        if not source_vals:
            return {"status": "empty_source"}
        src_rows = len(source_vals)
        src_cols = len(source_vals[0]) if source_vals else 1
        updates = []
        for i in range(ter - tr + 1):
            for j in range(tec - tc + 1):
                val = source_vals[i % src_rows][j % src_cols]
                updates.append((tr + i, tc + j, normalize_value(val)))
        if updates:
            updates_json = json.dumps(updates)
            self._bridge.set_cell_values_parsed(self._sheet_id_json, updates_json)
        return {"status": "ok", "cells_filled": len(updates)}

    def describe_range(self, range_ref: str) -> str:
        """Return a human-readable string describing the contents of a range.

        For small ranges, returns a markdown table.  For large ranges,
        returns a cell listing.  For absurdly large ranges, returns a
        bounding-box message.
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        num_rows = er - sr + 1
        num_cols = ec - sc + 1
        total_cells = num_rows * num_cols

        # Hard cap for absurdly large ranges
        if total_cells > 500_000:
            return (
                f"Range {range_ref} spans {num_rows} rows x {num_cols} cols "
                f"({total_cells:,} cells) which exceeds the bounding box hard cap. "
                f"Please narrow the range."
            )

        # Gather non-empty cells
        lines: List[str] = []
        start_a1 = f"{_col_to_a1(sc)}{sr + 1}"
        end_a1 = f"{_col_to_a1(ec)}{er + 1}"
        lines.append(f"Range {start_a1}:{end_a1} ({num_rows} rows x {num_cols} cols)")

        # Build markdown table for small ranges, cell listing for larger
        if total_cells <= 5000:
            # Header row
            col_headers = [_col_to_a1(c) for c in range(sc, ec + 1)]
            header = "| |" + "|".join(col_headers) + "|"
            separator = "|---|" + "|".join(["---"] * num_cols) + "|"
            lines.append(header)
            lines.append(separator)
            for r in range(sr, er + 1):
                row_cells = []
                for c in range(sc, ec + 1):
                    raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                    if raw is None or raw == "":
                        row_cells.append("")
                    elif isinstance(raw, str) and raw.startswith("="):
                        # Show formula and computed value
                        value_raw = self._bridge.get_cell_value(self._sheet_id_json, r, c)
                        value = deserialize_cell_value(value_raw)
                        row_cells.append(str(value))
                    else:
                        row_cells.append(str(raw))
                lines.append(f"|{r + 1}|" + "|".join(row_cells) + "|")
        else:
            # Cell listing for large but not absurd ranges
            for r in range(sr, er + 1):
                for c in range(sc, ec + 1):
                    raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                    if raw is not None and raw != "":
                        addr = f"{_col_to_a1(c)}{r + 1}"
                        lines.append(f"  {addr}: {raw}")

        return "\n".join(lines)

    def summarize(self, options: Optional[Dict[str, Any]] = None) -> Any:
        """Return a human-readable summary string describing this worksheet.

        Parameters
        ----------
        options:
            Optional dict.  Pass ``{"includeData": True}`` to include full
            cell data instead of just a sample.
        """
        opts = options or {}
        include_data = opts.get("includeData", False)
        bounds = self.get_data_bounds()

        lines: list = []
        lines.append(f"Sheet: {self._name}")

        if bounds is None:
            lines.append("(empty sheet)")
            return "\n".join(lines)

        rows = bounds.max_row - bounds.min_row + 1
        cols = bounds.max_col - bounds.min_col + 1
        lines.append(f"Dimensions: {rows} rows x {cols} cols ({bounds.min_row}:{bounds.max_row}, {bounds.min_col}:{bounds.max_col})")

        # Detect headers (first row)
        header_vals = []
        for c in range(bounds.min_col, bounds.max_col + 1):
            v = self._bridge.get_cell_value(self._sheet_id_json, bounds.min_row, c)
            from mog._serde import deserialize_cell_value
            header_vals.append(deserialize_cell_value(v))
        if any(isinstance(h, str) for h in header_vals):
            lines.append("Headers: " + ", ".join(str(h) for h in header_vals if h is not None))

        # Content breakdown
        nums = 0
        strings = 0
        formulas_count = 0
        empties = 0
        for r in range(bounds.min_row, bounds.max_row + 1):
            for c in range(bounds.min_col, bounds.max_col + 1):
                raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                if raw is None or raw == "":
                    empties += 1
                elif isinstance(raw, str) and raw.startswith("="):
                    formulas_count += 1
                else:
                    try:
                        float(raw)
                        nums += 1
                    except (ValueError, TypeError):
                        strings += 1
        lines.append(f"Content: {nums} numbers, {strings} strings, {formulas_count} formulas, {empties} empty")

        # Data or sample
        if include_data:
            lines.append("--- Cell Data ---")
            for r in range(bounds.min_row, bounds.max_row + 1):
                for c in range(bounds.min_col, bounds.max_col + 1):
                    raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                    if raw is not None and raw != "":
                        from mog._serde import _col_to_a1
                        addr = f"{_col_to_a1(c)}{r + 1}"
                        lines.append(f"  {addr}: {raw}")
        else:
            lines.append("--- Sample Data ---")
            sample_rows = min(5, bounds.max_row - bounds.min_row + 1)
            for r in range(bounds.min_row, bounds.min_row + sample_rows):
                for c in range(bounds.min_col, bounds.max_col + 1):
                    raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                    if raw is not None and raw != "":
                        from mog._serde import _col_to_a1
                        addr = f"{_col_to_a1(c)}{r + 1}"
                        lines.append(f"  {addr}: {raw}")

        return "\n".join(lines)

    def get_raw_cell_data(self, address: Union[str, Tuple[int, int]], include_formula: bool = False) -> Any:
        """Get raw cell data (full engine JSON) for a cell.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        include_formula:
            When ``True``, ensure the ``formula`` key is populated in the
            returned dict.

        Returns a dict with at least ``value``, ``rawValue``, ``displayValue``.
        """
        row, col = self._resolve_address(address)

        # Always build a rich dict from the available bridge data
        value_raw = self._bridge.get_cell_value(self._sheet_id_json, row, col)
        raw_val = self._bridge.get_raw_value(self._sheet_id_json, row, col)
        display = self._bridge.get_display_value(self._sheet_id_json, row, col)
        value = deserialize_cell_value(value_raw)
        if isinstance(value, dict) and value.get("type") == "error":
            value = error_dict_to_display_string(value)

        data: Dict[str, Any] = {
            "value": value,
            "rawValue": raw_val,
            "displayValue": display,
        }

        # Try to merge in any extra engine data
        try:
            engine_data = self._bridge.get_cell_data(self._sheet_id_json, row, col)
            if isinstance(engine_data, dict):
                for k, v in engine_data.items():
                    if k not in data:
                        data[k] = v
        except Exception:
            pass

        if include_formula or (isinstance(raw_val, str) and raw_val.startswith("=")):
            if isinstance(raw_val, str) and raw_val.startswith("="):
                data["formula"] = raw_val

        # When include_formula is True, also include the resolved format
        if include_formula:
            try:
                resolved_fmt = self._bridge.call_json(
                    "compute_get_resolved_format", self._sheet_id_json, row, col
                )
                if isinstance(resolved_fmt, str):
                    resolved_fmt = json.loads(resolved_fmt)
                if isinstance(resolved_fmt, dict):
                    # Filter out null/None values to keep format sparse
                    sparse_fmt = {k: v for k, v in resolved_fmt.items() if v is not None}
                    if sparse_fmt:
                        data["format"] = sparse_fmt
            except Exception:
                pass

        return data

    def clear_data(self, address_or_range: str) -> Dict[str, Any]:
        """Alias for :meth:`clear`."""
        return self.clear(address_or_range)

    def get_data(self) -> List[List[CellValue]]:
        """Get all data in this sheet as a 2D grid of raw values.

        Returns a row-major list of lists covering the used range.
        Empty sheets return an empty list.
        """
        bounds = self.get_data_bounds()
        if bounds is None:
            return []
        result: List[List[CellValue]] = []
        for r in range(bounds.min_row, bounds.max_row + 1):
            row_vals: List[CellValue] = []
            for c in range(bounds.min_col, bounds.max_col + 1):
                value_raw = self._bridge.get_cell_value(self._sheet_id_json, r, c)
                value = deserialize_cell_value(value_raw)
                if isinstance(value, dict) and value.get("type") == "error":
                    value = error_dict_to_display_string(value)
                row_vals.append(value)
            result.append(row_vals)
        return result

    def get_formulas(
        self, range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> List[List[Optional[str]]]:
        """Get a 2D grid of formula strings for a range.

        Non-formula cells appear as ``None``.
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        result: List[List[Optional[str]]] = []
        for r in range(sr, er + 1):
            row_formulas: List[Optional[str]] = []
            for c in range(sc, ec + 1):
                row_formulas.append(self._get_compute_formula(r, c))
            result.append(row_formulas)
        return result

    def get_index(self) -> int:
        """Get the 0-based tab index of this sheet."""
        sheet_ids = self._bridge.get_sheet_order()
        for i, sid in enumerate(sheet_ids):
            if sid == self._sheet_id:
                return i
        return 0

    def create_table(self, name: str, config: Dict[str, Any]) -> None:
        """Convenience method to write headers/data and create a named table.

        Parameters
        ----------
        name:
            Table name.
        config:
            Dict with ``headers`` (list of strings) and ``data`` (2D list).
        """
        headers = config.get("headers", [])
        data = config.get("data", [])
        num_cols = len(headers) if headers else (len(data[0]) if data else 0)
        num_rows = len(data)

        # Write headers
        if headers:
            for j, h in enumerate(headers):
                self.set_cell((0, j), h)

        # Write data
        start_row = 1 if headers else 0
        for i, row_vals in enumerate(data):
            for j, val in enumerate(row_vals):
                self.set_cell((start_row + i, j), val)

        # Create the table
        end_row = start_row + num_rows - 1
        end_col = num_cols - 1
        range_str = f"A1:{chr(ord('A') + end_col)}{end_row + 1}"
        self.tables.add(range_str, {"name": name, "hasHeaders": bool(headers)})

    @property
    def settings(self):
        """Sheet-level settings."""
        return _SheetSettingsUnsupported(self._bridge, self._sheet_id_json)

    @property
    def changes(self):
        """Change tracking sub-API."""
        return _ChangesAPI(self)

    # ------------------------------------------------------------------
    # Sub-APIs (lazy properties)
    # ------------------------------------------------------------------

    @property
    def formats(self) -> FormatsAPI:
        """Cell formatting operations (bold, italic, number format, etc.)."""
        if self._formats_api is None:
            from mog.sub_apis.formats import FormatsAPI
            self._formats_api = FormatsAPI(self._bridge, self._sheet_id_json)
        return self._formats_api

    @property
    def structure(self) -> StructureAPI:
        """Structural operations (insert/delete rows/cols, merges)."""
        if self._structure_api is None:
            from mog.sub_apis.structure import StructureAPI

            def _prot_check(op: str) -> bool:
                if self._protection_api is not None and self._protection_api.is_protected():
                    return self._protection_api.can_do_structure_op(op)
                return True

            self._structure_api = StructureAPI(
                self._bridge, self._sheet_id_json, protection_check=_prot_check
            )
        return self._structure_api

    @property
    def layout(self) -> LayoutAPI:
        """Layout operations (row heights, column widths, frozen panes)."""
        if self._layout_api is None:
            from mog.sub_apis.layout import LayoutAPI
            self._layout_api = LayoutAPI(self._bridge, self._sheet_id_json)
        return self._layout_api

    @property
    def tables(self) -> TablesAPI:
        """Table CRUD operations."""
        if self._tables_api is None:
            from mog.sub_apis.tables import TablesAPI
            self._tables_api = TablesAPI(self._bridge, self._sheet_id_json)
        return self._tables_api

    @property
    def charts(self) -> ChartsAPI:
        """Chart CRUD operations."""
        if self._charts_api is None:
            from mog.sub_apis.charts import ChartsAPI
            self._charts_api = ChartsAPI(self._bridge, self._sheet_id_json)
        return self._charts_api

    @property
    def filters(self) -> FiltersAPI:
        """Auto-filter operations."""
        if self._filters_api is None:
            from mog.sub_apis.filters import FiltersAPI
            self._filters_api = FiltersAPI(self._bridge, self._sheet_id_json)
        return self._filters_api

    @property
    def comments(self) -> CommentsAPI:
        """Threaded comment operations."""
        if self._comments_api is None:
            from mog.sub_apis.comments import CommentsAPI
            self._comments_api = CommentsAPI(self._bridge, self._sheet_id_json)
        return self._comments_api

    @property
    def conditional_formats(self) -> ConditionalFormatsAPI:
        """Conditional formatting operations."""
        if self._conditional_formats_api is None:
            from mog.sub_apis.conditional_formats import ConditionalFormatsAPI
            self._conditional_formats_api = ConditionalFormatsAPI(self._bridge, self._sheet_id_json)
        return self._conditional_formats_api

    @property
    def outline(self) -> OutlineAPI:
        """Row/column grouping and outline operations."""
        if self._outline_api is None:
            from mog.sub_apis.outline import OutlineAPI
            self._outline_api = OutlineAPI(self._bridge, self._sheet_id_json)
        return self._outline_api

    @property
    def view(self) -> ViewAPI:
        """View options (gridlines, headers, zoom, etc.)."""
        if self._view_api is None:
            from mog.sub_apis.view import ViewAPI
            self._view_api = ViewAPI(self._bridge, self._sheet_id_json)
        return self._view_api

    @property
    def protection(self) -> ProtectionAPI:
        """Sheet protection operations."""
        if self._protection_api is None:
            from mog.sub_apis.protection import ProtectionAPI
            self._protection_api = ProtectionAPI(self._bridge, self._sheet_id_json)
        return self._protection_api

    @property
    def pivots(self) -> PivotsAPI:
        """Pivot table operations."""
        if self._pivots_api is None:
            from mog.sub_apis.pivots import PivotsAPI
            self._pivots_api = PivotsAPI(self._bridge, self._sheet_id_json)
        return self._pivots_api

    @property
    def print_(self) -> PrintAPI:
        """Print settings and print area operations."""
        if self._print_api is None:
            from mog.sub_apis.print_ import PrintAPI
            self._print_api = PrintAPI(self._bridge, self._sheet_id_json)
        return self._print_api

    @property
    def sparklines(self) -> SparklinesAPI:
        """Sparkline operations."""
        if self._sparklines_api is None:
            from mog.sub_apis.sparklines import SparklinesAPI
            self._sparklines_api = SparklinesAPI(self._bridge, self._sheet_id_json)
        return self._sparklines_api

    @property
    def objects(self) -> ObjectsAPI:
        """Floating object (shapes, images) operations."""
        if self._objects_api is None:
            from mog.sub_apis.objects import ObjectsAPI
            self._objects_api = ObjectsAPI(self._bridge, self._sheet_id_json)
        return self._objects_api

    @property
    def shapes(self) -> ObjectsAPI:
        """Alias for :attr:`objects`."""
        from mog.sub_apis.objects import ObjectsAPI
        return ObjectsAPI(self._bridge, self._sheet_id_json, python_prefix="ws.shapes")

    @property
    def slicers(self) -> SlicersAPI:
        """Slicer operations."""
        if self._slicers_api is None:
            from mog.sub_apis.slicers import SlicersAPI
            self._slicers_api = SlicersAPI(self._bridge, self._sheet_id_json)
        return self._slicers_api

    @property
    def hyperlinks(self) -> HyperlinksAPI:
        """Hyperlink operations."""
        if self._hyperlinks_api is None:
            from mog.sub_apis.hyperlinks import HyperlinksAPI
            self._hyperlinks_api = HyperlinksAPI(self._bridge, self._sheet_id_json)
        return self._hyperlinks_api

    @property
    def validation(self) -> ValidationAPI:
        """Data validation operations."""
        if self._validation_api is None:
            from mog.sub_apis.validation import ValidationAPI
            self._validation_api = ValidationAPI(self._bridge, self._sheet_id_json)
        return self._validation_api

    @property
    def data_table(self) -> "_DataTableUnsupported":
        """Data table (what-if) operations."""
        if self._data_table_api is None:
            self._data_table_api = _DataTableUnsupported(self._bridge, self._sheet_id_json)
        return self._data_table_api

    @property
    def scenarios(self) -> "_ScenariosUnsupported":
        """What-if scenario operations."""
        if self._scenarios_api is None:
            self._scenarios_api = _ScenariosUnsupported(self._bridge, self._sheet_id_json)
        return self._scenarios_api

    @property
    def pictures(self) -> "_PicturesUnsupported":
        """Pictures/images on this sheet."""
        if self._pictures_api is None:
            self._pictures_api = _PicturesUnsupported(self._bridge, self._sheet_id_json, self)
        return self._pictures_api

    @property
    def names(self) -> "_SheetScopedNamesAPI":
        """Sheet-scoped named range operations."""
        if self._names_api is None:
            self._names_api = _SheetScopedNamesAPI(self._bridge, self._sheet_id)
        return self._names_api

    @property
    def form_controls(self) -> "_FormControlsUnsupported":
        """Form control operations on this sheet."""
        if self._form_controls_api is None:
            self._form_controls_api = _FormControlsUnsupported(self._bridge, self._sheet_id_json)
        return self._form_controls_api

    @property
    def text_boxes(self) -> "_TextBoxesUnsupported":
        """Text box operations on this sheet."""
        if self._text_boxes_api is None:
            self._text_boxes_api = _TextBoxesUnsupported(self._bridge, self._sheet_id_json, self)
        return self._text_boxes_api

    # ------------------------------------------------------------------
    # Additional methods expected by scenarios
    # ------------------------------------------------------------------

    def get_raw_range_data(
        self,
        range_ref: str,
        include_format: bool = False,
    ) -> List[List[Any]]:
        """Return raw cell data for a range.

        Parameters
        ----------
        range_ref:
            A1-style range (e.g. ``"A1:B3"``).
        include_format:
            When ``True``, each entry is a dict with ``value``, ``rawValue``,
            ``displayValue``, and ``format`` keys.  When ``False``, each entry
            is the raw value string.
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        result: List[List[Any]] = []
        for r in range(sr, er + 1):
            row_data: List[Any] = []
            for c in range(sc, ec + 1):
                raw_val = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                if include_format:
                    value_raw = self._bridge.get_cell_value(self._sheet_id_json, r, c)
                    display = self._bridge.get_display_value(self._sheet_id_json, r, c)
                    # Use the resolved format (full cascade) instead of raw cell data
                    fmt = None
                    try:
                        resolved_fmt = self._bridge.call_json(
                            "compute_get_resolved_format", self._sheet_id_json, r, c
                        )
                        if isinstance(resolved_fmt, str):
                            resolved_fmt = json.loads(resolved_fmt)
                        if isinstance(resolved_fmt, dict):
                            # Only include format if there are explicitly-set
                            # properties beyond the defaults
                            _DEFAULT_ONLY = {"fontFamily", "fontSize", "numberFormat"}
                            sparse = {k: v for k, v in resolved_fmt.items() if v is not None}
                            non_default_keys = set(sparse.keys()) - _DEFAULT_ONLY
                            if non_default_keys:
                                fmt = sparse
                    except Exception:
                        pass
                    row_data.append({
                        "value": deserialize_cell_value(value_raw),
                        "rawValue": raw_val,
                        "displayValue": display,
                        "format": fmt,
                    })
                else:
                    row_data.append(raw_val)
            result.append(row_data)
        return result

    def get_used_range(self) -> Optional[str]:
        """Return the used range as an A1-style range string, or ``None`` if empty."""
        bounds = self.get_data_bounds()
        if bounds is None:
            return None
        start = f"{_col_to_a1(bounds.min_col)}{bounds.min_row + 1}"
        end = f"{_col_to_a1(bounds.max_col)}{bounds.max_row + 1}"
        return f"{start}:{end}"

    def to_csv(self, options: Optional[Dict[str, Any]] = None) -> str:
        """Export this sheet's data as a CSV string.

        Parameters
        ----------
        options:
            Optional dict with ``separator`` (default ``","``).
        """
        opts = options or {}
        sep = opts.get("separator", ",")
        bounds = self.get_data_bounds()
        if bounds is None:
            return ""
        lines: List[str] = []
        for r in range(bounds.min_row, bounds.max_row + 1):
            cells: List[str] = []
            for c in range(bounds.min_col, bounds.max_col + 1):
                raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                if raw is None:
                    cells.append("")
                else:
                    s = str(raw)
                    if sep in s or '"' in s or "\n" in s:
                        s = '"' + s.replace('"', '""') + '"'
                    cells.append(s)
            lines.append(sep.join(cells))
        return "\n".join(lines)

    def to_json(self, options: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Export this sheet's data as a list of dicts (one per data row).

        Parameters
        ----------
        options:
            Optional dict with ``headerRow`` (default ``"first"``).
            ``"first"`` uses the first row as keys, ``"none"`` uses column
            letters as keys.
        """
        opts = options or {}
        header_mode = opts.get("headerRow", "first")
        bounds = self.get_data_bounds()
        if bounds is None:
            return []

        # Read all raw values
        def _read_value(r: int, c: int) -> Any:
            raw = self._bridge.get_cell_value(self._sheet_id_json, r, c)
            return deserialize_cell_value(raw)

        if header_mode == "none":
            # Use column letters as keys
            headers = [_col_to_a1(c) for c in range(bounds.min_col, bounds.max_col + 1)]
            start_row = bounds.min_row
        else:
            # Use first row as headers
            headers = []
            for c in range(bounds.min_col, bounds.max_col + 1):
                val = _read_value(bounds.min_row, c)
                headers.append(str(val) if val is not None else _col_to_a1(c))
            start_row = bounds.min_row + 1

        result: List[Dict[str, Any]] = []
        for r in range(start_row, bounds.max_row + 1):
            row_dict: Dict[str, Any] = {}
            for i, c in enumerate(range(bounds.min_col, bounds.max_col + 1)):
                key = headers[i] if i < len(headers) else _col_to_a1(c)
                row_dict[key] = _read_value(r, c)
            result.append(row_dict)
        return result

    def format_values(self, entries: List[Dict[str, Any]]) -> List[str]:
        """Format values with number format codes.

        Parameters
        ----------
        entries:
            List of dicts with ``value`` and ``formatCode`` keys.

        Returns
        -------
        list of str
            The formatted string representations.
        """
        unsupported_python_path("ws.format_values")

    # ------------------------------------------------------------------
    # Query / Navigation methods
    # ------------------------------------------------------------------

    def get_current_region(self, row: int, col: int) -> Dict[str, int]:
        """Find the contiguous data region around ``(row, col)``.

        Flood-fills outward from the given cell, stopping at empty
        rows/columns.  Returns a dict with ``startRow``, ``startCol``,
        ``endRow``, ``endCol``.
        """
        # Expand upward
        start_row = row
        while start_row > 0:
            if self._is_row_empty(start_row - 1, col, col):
                break
            start_row -= 1

        # Expand downward
        end_row = row
        while end_row < 1_048_575:
            if self._is_row_empty(end_row + 1, col, col):
                break
            end_row += 1

        # Now expand left/right across the full row range
        start_col = col
        while start_col > 0:
            if self._is_col_empty(start_col - 1, start_row, end_row):
                break
            start_col -= 1

        end_col = col
        while end_col < 16_383:
            if self._is_col_empty(end_col + 1, start_row, end_row):
                break
            end_col += 1

        # Re-expand rows based on discovered columns
        changed = True
        while changed:
            changed = False
            if start_row > 0 and not self._is_row_empty(start_row - 1, start_col, end_col):
                start_row -= 1
                changed = True
            if end_row < 1_048_575 and not self._is_row_empty(end_row + 1, start_col, end_col):
                end_row += 1
                changed = True
            if start_col > 0 and not self._is_col_empty(start_col - 1, start_row, end_row):
                start_col -= 1
                changed = True
            if end_col < 16_383 and not self._is_col_empty(end_col + 1, start_row, end_row):
                end_col += 1
                changed = True

        return {
            "startRow": start_row,
            "startCol": start_col,
            "endRow": end_row,
            "endCol": end_col,
        }

    def _is_row_empty(self, row: int, min_col: int, max_col: int) -> bool:
        """Check if all cells in a row segment are empty."""
        for c in range(min_col, max_col + 1):
            raw = self._bridge.get_raw_value(self._sheet_id_json, row, c)
            if raw is not None and raw != "":
                return False
        return True

    def _is_col_empty(self, col: int, min_row: int, max_row: int) -> bool:
        """Check if all cells in a column segment are empty."""
        for r in range(min_row, max_row + 1):
            raw = self._bridge.get_raw_value(self._sheet_id_json, r, col)
            if raw is not None and raw != "":
                return False
        return True

    def find_data_edge(self, row: int, col: int, direction: str) -> Dict[str, int]:
        """Find the edge of data from a cell in a given direction.

        Parameters
        ----------
        direction:
            ``"up"``, ``"down"``, ``"left"``, or ``"right"``.

        Returns a dict with ``row`` and ``col``.
        """
        r, c = row, col
        dr = {"up": -1, "down": 1, "left": 0, "right": 0}.get(direction, 0)
        dc = {"up": 0, "down": 0, "left": -1, "right": 1}.get(direction, 0)

        # Walk in direction until we find an empty cell, then back up
        while True:
            nr, nc = r + dr, c + dc
            if nr < 0 or nc < 0 or nr > 1_048_575 or nc > 16_383:
                break
            raw = self._bridge.get_raw_value(self._sheet_id_json, nr, nc)
            if raw is None or raw == "":
                break
            r, c = nr, nc
        return {"row": r, "col": c}

    def get_dependents(self, address: Union[str, Tuple[int, int]]) -> List[str]:
        """Get cells that depend on the given cell (its dependents).

        Returns a list of A1-style addresses.
        """
        row, col = self._resolve_address(address)
        bounds = self.get_data_bounds()
        if bounds is None:
            return []
        target_a1 = f"{_col_to_a1(col)}{row + 1}"
        results: List[str] = []
        for r in range(bounds.min_row, bounds.max_row + 1):
            for c in range(bounds.min_col, bounds.max_col + 1):
                raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                if isinstance(raw, str) and raw.startswith("="):
                    # Check if the formula references our target cell
                    formula_upper = raw.upper()
                    target_upper = target_a1.upper()
                    if target_upper in formula_upper:
                        cell_a1 = f"{_col_to_a1(c)}{r + 1}"
                        results.append(cell_a1)
                    else:
                        # Check if target is within a range reference in the formula
                        # e.g. =SUM(B2:B3) references B2 and B3
                        import re as _re_inner
                        for m in _re_inner.finditer(r'([A-Z]+\d+):([A-Z]+\d+)', formula_upper):
                            try:
                                rsr, rsc = parse_a1(m.group(1))
                                rer, rec = parse_a1(m.group(2))
                                if rsr <= row <= rer and rsc <= col <= rec:
                                    cell_a1 = f"{_col_to_a1(c)}{r + 1}"
                                    if cell_a1 not in results:
                                        results.append(cell_a1)
                            except ValueError:
                                pass
        return results

    def get_precedents(self, address: Union[str, Tuple[int, int]]) -> List[str]:
        """Get cells that the given cell depends on (its precedents).

        Returns a list of A1-style addresses.
        """
        row, col = self._resolve_address(address)
        raw = self._bridge.get_raw_value(self._sheet_id_json, row, col)
        if not isinstance(raw, str) or not raw.startswith("="):
            return []
        results: List[str] = []
        formula_upper = raw.upper()
        # Extract range references (e.g. B2:B3)
        for m in _re.finditer(r'([A-Z]+\d+):([A-Z]+\d+)', formula_upper):
            try:
                rsr, rsc = parse_a1(m.group(1))
                rer, rec = parse_a1(m.group(2))
                for r_ in range(rsr, rer + 1):
                    for c_ in range(rsc, rec + 1):
                        a1 = f"{_col_to_a1(c_)}{r_ + 1}"
                        if a1 not in results:
                            results.append(a1)
            except ValueError:
                pass
        # Extract single-cell references (not already covered by ranges)
        for m in _re.finditer(r'(?<![A-Z:])([A-Z]+\d+)(?![\d:])', formula_upper):
            a1 = m.group(1)
            if a1 not in results:
                try:
                    parse_a1(a1)  # Validate
                    results.append(a1)
                except ValueError:
                    pass
        return results

    def find_by_formula(self, pattern: str) -> List[Tuple[int, int]]:
        """Find cells whose formula matches the given pattern string.

        Parameters
        ----------
        pattern:
            A substring or regex pattern to match against formula text.

        Returns a list of ``(row, col)`` pairs.
        """
        bounds = self.get_data_bounds()
        if bounds is None:
            return []
        try:
            regex = _re.compile(pattern, _re.IGNORECASE)
        except _re.error:
            regex = None
        results: List[Tuple[int, int]] = []
        for r in range(bounds.min_row, bounds.max_row + 1):
            for c in range(bounds.min_col, bounds.max_col + 1):
                raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                if isinstance(raw, str) and raw.startswith("="):
                    if regex is not None:
                        if regex.search(raw):
                            results.append((r, c))
                    elif pattern.upper() in raw.upper():
                        results.append((r, c))
        return results

    def regex_search(
        self,
        patterns: List[str],
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Search cells using regex patterns.

        Parameters
        ----------
        patterns:
            List of regex pattern strings.
        options:
            Optional search settings. Supports the public TypeScript option
            names (``matchCase``, ``entireCell``, ``searchFormulas``,
            ``range``) and Python snake_case aliases.

        Returns a list of match dictionaries with row, col, address, value, and
        matchedPattern fields.
        """
        if not patterns:
            return []

        opts = dict(options or {})
        native_options: Dict[str, Any] = {
            "patterns": list(patterns),
        }
        case_sensitive = opts.get("caseSensitive", opts.get("case_sensitive"))
        case_sensitive = opts.get("matchCase", opts.get("match_case", case_sensitive))
        if case_sensitive is not None:
            native_options["caseSensitive"] = bool(case_sensitive)

        whole_cell = opts.get("wholeCell", opts.get("whole_cell"))
        whole_cell = opts.get("entireCell", opts.get("entire_cell", whole_cell))
        if whole_cell is not None:
            native_options["wholeCell"] = bool(whole_cell)

        include_formulas = opts.get("includeFormulas", opts.get("include_formulas"))
        include_formulas = opts.get("searchFormulas", opts.get("search_formulas", include_formulas))
        if include_formulas is not None:
            native_options["includeFormulas"] = bool(include_formulas)

        range_ref = opts.get("range")
        if isinstance(range_ref, str) and range_ref:
            if ":" in range_ref:
                sr, sc, er, ec = parse_range(range_ref)
            else:
                sr, sc = parse_a1(range_ref)
                er, ec = sr, sc
            native_options.update(
                {
                    "startRow": sr,
                    "startCol": sc,
                    "endRow": er,
                    "endCol": ec,
                }
            )

        result = self._bridge.call_json(
            "compute_regex_search",
            self._sheet_id_json,
            json.dumps(native_options),
        )
        if isinstance(result, dict) and isinstance(result.get("matches"), list):
            return result["matches"]
        return []

    def text_to_columns(
        self, address: str, options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Split text in cells into multiple columns.

        Parameters
        ----------
        address:
            A1-style address or range (e.g. ``"A1"`` or ``"A1:A5"``).
        options:
            Dict with ``type`` (``"delimited"`` or ``"fixedWidth"``),
            ``delimiter`` (for delimited), ``positions`` (for fixedWidth).
        """
        unsupported_python_path("ws.text_to_columns")

    def get_range_with_identity(
        self, sr: int, sc: int, er: int, ec: int,
    ) -> List[Dict[str, Any]]:
        """Return a flat list of non-empty cells with their identity info.

        Each entry is a dict with ``cellId``, ``row``, ``col``, ``address``,
        ``value``, ``formula``, and ``displayValue`` keys.
        """
        results: List[Dict[str, Any]] = []
        for r in range(sr, er + 1):
            for c in range(sc, ec + 1):
                raw = self._bridge.get_raw_value(self._sheet_id_json, r, c)
                if raw is None or raw == "":
                    continue
                value_raw = self._bridge.get_cell_value(self._sheet_id_json, r, c)
                display = self._bridge.get_display_value(self._sheet_id_json, r, c)
                cell_id = self._bridge.get_cell_id_at(self._sheet_id_json, r, c)
                value = deserialize_cell_value(value_raw)
                formula = self._get_compute_formula(r, c)
                addr = f"{_col_to_a1(c)}{r + 1}"
                results.append({
                    "cellId": cell_id or f"{r}:{c}",
                    "row": r,
                    "col": c,
                    "address": addr,
                    "value": value,
                    "formula": formula,
                    "displayValue": display,
                })
        return results

    def describe(self, topic: Optional[str] = None) -> str:
        """Describe a cell or the sheet's API surface.

        Parameters
        ----------
        topic:
            When an A1 address is given, returns a description of that cell
            (value, formula, display value).  When ``None`` or a topic
            string, returns a human-readable sheet overview.
        """
        if topic is not None:
            # Try to interpret as a cell address
            try:
                row, col = parse_a1(topic)
                raw_val = self._bridge.get_raw_value(self._sheet_id_json, row, col)
                value_raw = self._bridge.get_cell_value(self._sheet_id_json, row, col)
                display = self._bridge.get_display_value(self._sheet_id_json, row, col)
                value = deserialize_cell_value(value_raw)
                parts = [f"Cell {topic}:"]
                if isinstance(raw_val, str) and raw_val.startswith("="):
                    parts.append(f"  formula: {raw_val}")
                parts.append(f"  value: {value}")
                if display and str(display) != str(value):
                    parts.append(f"  display: {display}")
                parts.append(f"  rawValue: {raw_val}")
                return "\n".join(parts)
            except (ValueError, Exception):
                pass
        # Fall back to summarize
        return self.summarize()


class _DataTableUnsupported:
    """Unsupported data-table (what-if analysis) sub-API."""

    def __init__(self, bridge: Any, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def create(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Create a data table (what-if table).

        Parameters
        ----------
        config:
            Dict with ``range``, ``rowInputCell``, and optionally ``columnInputCell``.
        """
        unsupported_api("py.ws.data_table.create", "ws.data_table.create")

    def list(self) -> List[Dict[str, Any]]:
        unsupported_api("py.ws.data_table.list", "ws.data_table.list")

    def delete(self, table_id: str) -> None:
        unsupported_api("py.ws.data_table.delete", "ws.data_table.delete")


class _ScenariosUnsupported:
    """Unsupported what-if scenarios sub-API."""

    def __init__(self, bridge: Any, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def add(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Add a what-if scenario."""
        unsupported_api("py.ws.scenarios.add", "ws.scenarios.add")

    def list(self) -> List[Dict[str, Any]]:
        unsupported_api("py.ws.scenarios.list", "ws.scenarios.list")

    def update(self, name: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update a scenario by name."""
        unsupported_api("py.ws.scenarios.update", "ws.scenarios.update")

    def delete(self, name: str) -> None:
        unsupported_api("py.ws.scenarios.delete", "ws.scenarios.delete")

    def apply(self, name: str) -> Optional[Dict[str, Any]]:
        unsupported_api("py.ws.scenarios.apply", "ws.scenarios.apply")


class _PicturesUnsupported:
    """Unsupported pictures sub-API."""

    def __init__(self, bridge: Any, sheet_id_json: str, worksheet: Any) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._ws = worksheet

    def add(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Add a picture/image object."""
        unsupported_api("ws.pictures.add", "ws.pictures.add")

    def list(self) -> List[Dict[str, Any]]:
        """List all picture objects on this sheet."""
        unsupported_api("ws.pictures.list", "ws.pictures.list")

    def get(self, picture_id: str) -> Optional[Dict[str, Any]]:
        """Get a picture by ID."""
        unsupported_api("ws.pictures.get", "ws.pictures.get")


class _SheetSettingsUnsupported:
    """Unsupported sheet-level settings API."""

    def __init__(self, bridge, sheet_id_json):
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def get(self) -> Dict[str, Any]:
        unsupported_api("ws.settings.get", "ws.settings.get")

    def set(self, settings: Dict[str, Any]) -> None:
        unsupported_api("ws.settings.set", "ws.settings.set")

    def update(self, settings: Dict[str, Any]) -> None:
        unsupported_api("py.ws.settings.update", "ws.settings.update")

    def get_standard_column_width(self) -> float:
        """Get the standard column width (default 64.0)."""
        unsupported_api("py.ws.settings.get_standard_column_width", "ws.settings.get_standard_column_width")

    def get_standard_width(self) -> float:
        unsupported_api("ws.settings.getStandardWidth", "ws.settings.get_standard_width")

    def get_standard_row_height(self) -> float:
        """Get the standard row height (default 20.0)."""
        unsupported_api("py.ws.settings.get_standard_row_height", "ws.settings.get_standard_row_height")

    def get_standard_height(self) -> float:
        unsupported_api("ws.settings.getStandardHeight", "ws.settings.get_standard_height")

    def set_standard_width(self, width: float) -> None:
        unsupported_api("ws.settings.setStandardWidth", "ws.settings.set_standard_width")


class _ChangesAPI:
    """Change-tracking sub-API that snapshots cell values before/after writes."""

    def __init__(self, ws: "Worksheet") -> None:
        self._ws = ws

    def track(self) -> "_ChangeTracker":
        return _ChangeTracker(self._ws)


class _ChangeTracker:
    """Tracks cell changes by snapshotting values and comparing on ``collect()``.

    Distinguishes *direct* writes (cells whose raw value changed) from
    *cascade* recalculations (formula cells whose computed value changed
    but whose formula text did not).
    """

    def __init__(self, ws: "Worksheet") -> None:
        self._ws = ws
        # Snapshot all non-empty cells
        self._snapshot: Dict[Tuple[int, int], Any] = {}
        bounds = ws.get_data_bounds()
        if bounds is not None:
            for r in range(bounds.min_row, bounds.max_row + 1):
                for c in range(bounds.min_col, bounds.max_col + 1):
                    value_raw = ws._bridge.get_cell_value(ws._sheet_id_json, r, c)
                    value = deserialize_cell_value(value_raw)
                    raw = ws._bridge.get_raw_value(ws._sheet_id_json, r, c)
                    self._snapshot[(r, c)] = {
                        "value": value,
                        "raw": raw,
                        "is_formula": isinstance(raw, str) and raw.startswith("="),
                    }

    def collect(self) -> List[Dict[str, Any]]:
        """Collect all changes since tracking started."""
        ws = self._ws
        changes: List[Dict[str, Any]] = []

        # Determine the full range to check (union of old and new bounds)
        bounds = ws.get_data_bounds()
        checked: set = set()
        if bounds is not None:
            for r in range(bounds.min_row, bounds.max_row + 1):
                for c in range(bounds.min_col, bounds.max_col + 1):
                    checked.add((r, c))
                    value_raw = ws._bridge.get_cell_value(ws._sheet_id_json, r, c)
                    value = deserialize_cell_value(value_raw)
                    raw = ws._bridge.get_raw_value(ws._sheet_id_json, r, c)
                    old = self._snapshot.get((r, c))
                    old_value = old["value"] if old else None
                    old_raw = old["raw"] if old else None
                    is_formula = isinstance(raw, str) and raw.startswith("=")
                    was_formula = old is not None and old.get("is_formula", False)

                    if value != old_value or raw != old_raw:
                        addr = f"{_col_to_a1(c)}{r + 1}"
                        # Direct if raw value (formula text or literal) changed;
                        # cascade if only the computed value changed (formula
                        # cell recalculated).
                        if raw != old_raw:
                            origin = "direct"
                        elif is_formula and value != old_value:
                            origin = "cascade"
                        else:
                            origin = "direct"
                        changes.append({
                            "address": addr,
                            "row": r,
                            "col": c,
                            "oldValue": _change_record_value(old_value, old_raw, was_formula),
                            "newValue": _change_record_value(value, raw, is_formula),
                            "origin": origin,
                        })

        # Check cells that were in snapshot but might be gone now
        for (r, c), old in self._snapshot.items():
            if (r, c) not in checked:
                if old["value"] is not None:
                    addr = f"{_col_to_a1(c)}{r + 1}"
                    changes.append({
                        "address": addr,
                        "row": r,
                        "col": c,
                        "oldValue": _change_record_value(
                            old["value"],
                            old.get("raw"),
                            old.get("is_formula", False),
                        ),
                        "newValue": None,
                        "origin": "direct",
                    })

        return changes

    def close(self) -> None:
        """No-op (nothing to restore)."""
        pass


def _change_record_value(value: Any, raw: Any, is_formula: bool) -> Any:
    if isinstance(value, str) and not is_formula:
        return None
    return value


class _SheetScopedNamesAPI:
    """Sheet-scoped named range operations.

    The worksheet scoped-name family is not production-backed in Python yet.
    """

    __slots__ = ("_bridge", "_sheet_id")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.names"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.names"

    def __init__(self, bridge: Any, sheet_id: str) -> None:
        self._bridge = bridge
        self._sheet_id = sheet_id

    def __getattr__(self, name: str) -> Any:
        return unsupported_proxy_from_surface(
            self._UNSUPPORTED_ACCESSOR_API_PATH,
            self._UNSUPPORTED_ACCESSOR_PYTHON_PATH,
        ).__getattr__(name)

    def __dir__(self) -> list[str]:
        proxy = unsupported_proxy_from_surface(
            self._UNSUPPORTED_ACCESSOR_API_PATH,
            self._UNSUPPORTED_ACCESSOR_PYTHON_PATH,
        )
        return sorted(set(super().__dir__()) | set(dir(proxy)))

    def add(
        self,
        name: str,
        refers_to: str,
        comment: Optional[str] = None,
    ) -> Any:
        """Create a sheet-scoped named range."""
        unsupported_python_path("ws.names.add")

    def remove(self, name: str) -> Any:
        """Remove a sheet-scoped named range by name."""
        unsupported_python_path("ws.names.remove")

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a sheet-scoped named range by name."""
        unsupported_python_path("ws.names.get")

    def list(self) -> List[Dict[str, Any]]:
        """Return all sheet-scoped named ranges."""
        unsupported_python_path("ws.names.list")


class _FormControlsUnsupported:
    """Unsupported form controls sub-API for a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Any, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def add(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Add a form control."""
        unsupported_api("ws.formControls.add", "ws.form_controls.add")

    def add_checkbox(self, options: Dict[str, Any]) -> Dict[str, Any]:
        unsupported_api("ws.formControls.addCheckbox", "ws.form_controls.add_checkbox")

    def add_combo_box(self, options: Dict[str, Any]) -> Dict[str, Any]:
        unsupported_api("ws.formControls.addComboBox", "ws.form_controls.add_combo_box")

    def get(self, control_id: str) -> Optional[Dict[str, Any]]:
        """Get a form control by ID."""
        unsupported_api("ws.formControls.get", "ws.form_controls.get")

    def get_at_position(self, row: int, col: int) -> List[Dict[str, Any]]:
        unsupported_api("ws.formControls.getAtPosition", "ws.form_controls.get_at_position")

    def list(self) -> List[Dict[str, Any]]:
        """List all form controls on this sheet."""
        unsupported_api("ws.formControls.list", "ws.form_controls.list")

    def update(self, control_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        unsupported_api("ws.formControls.update", "ws.form_controls.update")

    def move(self, control_id: str, new_anchor: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        unsupported_api("ws.formControls.move", "ws.form_controls.move")

    def resize(self, control_id: str, width: float, height: float) -> Optional[Dict[str, Any]]:
        unsupported_api("ws.formControls.resize", "ws.form_controls.resize")

    def remove(self, control_id: str) -> None:
        """Remove a form control by ID."""
        unsupported_api("ws.formControls.remove", "ws.form_controls.remove")


class _TextBoxesUnsupported:
    """Unsupported text boxes sub-API."""

    __slots__ = ("_bridge", "_sheet_id_json", "_ws")

    def __init__(self, bridge: Any, sheet_id_json: str, worksheet: Any) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._ws = worksheet

    def add(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Add a text box object.

        Returns a dict containing at least ``{"id": "..."}``.
        """
        unsupported_api("ws.textBoxes.add", "ws.text_boxes.add")

    def get(self, text_box_id: str) -> Optional[Dict[str, Any]]:
        """Get a text box by ID."""
        unsupported_api("ws.textBoxes.get", "ws.text_boxes.get")

    def list(self) -> List[Dict[str, Any]]:
        """List all text box objects on this sheet."""
        unsupported_api("ws.textBoxes.list", "ws.text_boxes.list")

    def remove(self, text_box_id: str) -> Any:
        """Remove a text box by ID."""
        unsupported_api("py.ws.text_boxes.remove", "ws.text_boxes.remove")
