"""Cell formatting operations -- ``ws.formats.set()``, ``ws.formats.clearCell()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple, Union

from mog._serde import deserialize_mutation_result, parse_a1, parse_range
from mog.types import MutationResult


class _FormatMutationResult(dict):
    """A dict that also exposes MutationResult-style attributes.

    We subclass dict so that ``isinstance(result, dict)`` returns True,
    which some scenarios rely on for verification of change_count, etc.
    """

    @property
    def raw(self) -> Dict[str, Any]:
        return dict(self)

    @property
    def data(self) -> Any:
        return self.get("data")


def _mutation_from_raw(raw: Any) -> MutationResult:
    """Convert a raw bridge result (possibly a tuple) to MutationResult.

    The bridge may return ``(bytes, dict)`` tuples for mutation results.
    We extract the dict part and wrap it, enriched with change_count.
    Returns a dict subclass so ``isinstance(result, dict)`` is True.
    """
    result_dict: Dict[str, Any] = {}
    if isinstance(raw, tuple):
        for part in raw:
            if isinstance(part, dict):
                result_dict = part
                break
    elif isinstance(raw, dict):
        result_dict = raw
    elif isinstance(raw, str):
        try:
            result_dict = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            result_dict = {}

    # Enrich with change_count from propertyChanges
    changes = result_dict.get("propertyChanges") or result_dict.get("changes") or []
    if isinstance(changes, list) and len(changes) > 0:
        result_dict["change_count"] = len(changes)

    return _FormatMutationResult(result_dict)

if TYPE_CHECKING:
    from mog._bridge import Bridge


# Map snake_case format keys to camelCase engine keys
_FORMAT_KEY_MAP = {
    "number_format": "numberFormat",
    "font_family": "fontFamily",
    "font_size": "fontSize",
    "font_color": "fontColor",
    "underline_type": "underlineType",
    "horizontal_align": "horizontalAlign",
    "vertical_align": "verticalAlign",
    "wrap_text": "wrapText",
    "background_color": "backgroundColor",
    "indent_level": "indent",
}

# Reverse map for returning results
_FORMAT_KEY_REVERSE = {v: k for k, v in _FORMAT_KEY_MAP.items()}


def _normalize_format_keys(fmt: Dict[str, Any]) -> Dict[str, Any]:
    """Convert snake_case format keys to camelCase for the engine."""
    result = {}
    for k, v in fmt.items():
        result[_FORMAT_KEY_MAP.get(k, k)] = v
    return result


def _coerce_color(val: Any) -> Optional[str]:
    """Convert a color value to a hex string (#RRGGBB).

    The engine may return colors as:
    - hex string (``"#FF0000"``) -- pass through
    - integer ARGB (``0xFFFF0000`` or ``4294901760``) -- convert to #RRGGBB
    - ``None`` / ``0`` -- return ``None``
    """
    if isinstance(val, str) and val.startswith("#"):
        return val
    if isinstance(val, int) and val != 0:
        # ARGB integer: take the low 24 bits as RGB
        r = (val >> 16) & 0xFF
        g = (val >> 8) & 0xFF
        b = val & 0xFF
        return f"#{r:02X}{g:02X}{b:02X}"
    return None


_COLOR_KEYS = {"fontColor", "backgroundColor", "patternForegroundColor"}


def _add_snake_case_aliases(fmt: Dict[str, Any]) -> Dict[str, Any]:
    """Add snake_case aliases for camelCase keys in the result."""
    result = dict(fmt)
    # Coerce color fields that may come back as integers
    for key in _COLOR_KEYS:
        if key in result:
            coerced = _coerce_color(result[key])
            if coerced is not None:
                result[key] = coerced
            # Leave None values as-is (they represent "not set")
    for camel, snake in _FORMAT_KEY_REVERSE.items():
        if camel in result and snake not in result:
            result[snake] = result[camel]
    return result


# Number format pattern categories
_NUMBER_FORMAT_CATEGORIES = [
    ("currency", ["$", "¥", "€", "£", "₹"]),
    ("accounting", ["_("]),
    ("percentage", ["%"]),
    ("scientific", ["E+", "E-", "e+"]),
    ("date", ["yyyy", "yy", "mm", "dd", "d/", "m/"]),
    ("time", ["hh", "h:", "ss", "AM/PM", "am/pm"]),
    ("fraction", ["?/"]),
]


def _categorize_number_format(fmt_str: Optional[str]) -> str:
    """Categorize a number format string."""
    if not fmt_str or fmt_str == "General":
        return "general"
    upper = fmt_str.upper()
    for category, patterns in _NUMBER_FORMAT_CATEGORIES:
        for pat in patterns:
            if pat.upper() in upper:
                return category
    if "#" in fmt_str or "0" in fmt_str:
        return "number"
    return "general"


class FormatsAPI:
    """Cell formatting sub-API for a single worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    # Zero CellId used when no cell exists at a position.
    _ZERO_CELL_ID_JSON = json.dumps("00000000000000000000000000000000")

    def get(self, address: str) -> Dict[str, Any]:
        """Get the effective cell format at an A1 address.

        Returns a dict with format properties (bold, italic, fontSize, etc.).
        Uses the resolved/cascaded format that includes defaults, row-level,
        column-level, and cell-level overrides.
        """
        row, col = parse_a1(address)
        # Use compute_get_resolved_format for full cascade
        result = self._bridge.call_json(
            "compute_get_resolved_format", self._sheet_id_json, row, col
        )
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (json.JSONDecodeError, TypeError):
                return {}
        if isinstance(result, dict):
            return _add_snake_case_aliases(result)
        return {}

    def set(
        self,
        address_or_range: str,
        format: Dict[str, Any],
    ) -> MutationResult:
        """Set format properties for a cell or range.

        Parameters
        ----------
        address_or_range:
            An A1 address (``"A1"``) or range (``"A1:B2"``).
        format:
            Format properties to set, e.g.
            ``{"bold": True, "fontSize": 14, "numberFormat": "#,##0.00"}``.
        """
        if ":" in address_or_range:
            sr, sc, er, ec = parse_range(address_or_range)
            ranges = [(sr, sc, er, ec)]
        else:
            row, col = parse_a1(address_or_range)
            ranges = [(row, col, row, col)]

        ranges_json = json.dumps(ranges)
        format_json = json.dumps(_normalize_format_keys(format))
        raw = self._bridge.set_format_for_ranges(
            self._sheet_id_json, ranges_json, format_json
        )
        return _mutation_from_raw(raw)

    def set_range(
        self,
        range_str: str,
        format: Dict[str, Any],
    ) -> MutationResult:
        """Alias for :meth:`set` -- set format for a range."""
        return self.set(range_str, format)

    def set_ranges(
        self,
        ranges: List[Any],
        format: Dict[str, Any],
    ) -> MutationResult:
        """Set format properties for multiple ranges at once.

        Parameters
        ----------
        ranges:
            List of ranges. Each can be an A1-style string (e.g. ``"A1:A3"``)
            or a dict with ``startRow``, ``startCol``, ``endRow``, ``endCol`` keys.
        format:
            Format properties to set.
        """
        # Check if any range is a full-column or full-row format
        for r in ranges:
            if isinstance(r, dict):
                if r.get("isFullColumn"):
                    col = r.get("startCol", 0)
                    fmt_json = json.dumps(_normalize_format_keys(format))
                    raw = self._bridge.call_json(
                        "compute_set_col_format", self._sheet_id_json, col, fmt_json
                    )
                    return _mutation_from_raw(raw)
                if r.get("isFullRow"):
                    row = r.get("startRow", 0)
                    fmt_json = json.dumps(_normalize_format_keys(format))
                    raw = self._bridge.call_json(
                        "compute_set_row_format", self._sheet_id_json, row, fmt_json
                    )
                    return _mutation_from_raw(raw)

        parsed = []
        for r in ranges:
            if isinstance(r, dict):
                parsed.append((
                    r.get("startRow", 0),
                    r.get("startCol", 0),
                    r.get("endRow", 0),
                    r.get("endCol", 0),
                ))
            elif isinstance(r, str):
                if ":" in r:
                    parsed.append(parse_range(r))
                else:
                    row, col = parse_a1(r)
                    parsed.append((row, col, row, col))
            elif isinstance(r, (list, tuple)) and len(r) == 4:
                parsed.append(tuple(r))
        ranges_json = json.dumps(parsed)
        format_json = json.dumps(_normalize_format_keys(format))
        raw = self._bridge.set_format_for_ranges(
            self._sheet_id_json, ranges_json, format_json
        )
        return _mutation_from_raw(raw)

    def set_number_format(
        self,
        address_or_range: str,
        number_format: str,
    ) -> MutationResult:
        """Set the number format for a cell or range.

        Parameters
        ----------
        address_or_range:
            An A1 address (``"A1"``) or range (``"A1:B2"``).
        number_format:
            The number format string (e.g. ``"#,##0.00"``, ``"0%"``).
        """
        return self.set(address_or_range, {"numberFormat": number_format})

    def clear_cell(self, address_or_range: str) -> MutationResult:
        """Clear formatting for a cell or range (revert to inherited format).

        Parameters
        ----------
        address_or_range:
            An A1 address (``"A1"``) or range (``"A1:B2"``).
        """
        if ":" in address_or_range:
            sr, sc, er, ec = parse_range(address_or_range)
            ranges = [(sr, sc, er, ec)]
        else:
            row, col = parse_a1(address_or_range)
            ranges = [(row, col, row, col)]

        ranges_json = json.dumps(ranges)
        raw = self._bridge.clear_format_for_ranges(
            self._sheet_id_json, ranges_json
        )
        return _mutation_from_raw(raw)

    def toggle(
        self,
        property: str,
        address_or_range: str,
        active_address: Optional[str] = None,
    ) -> MutationResult:
        """Toggle a boolean format property (bold, italic, strikethrough, etc.).

        Parameters
        ----------
        property:
            One of ``"bold"``, ``"italic"``, ``"strikethrough"``,
            ``"wrapText"``, ``"underline"``.
        address_or_range:
            An A1 address or range.
        active_address:
            The active cell for determining toggle direction.  Defaults
            to the top-left of the range.
        """
        if ":" in address_or_range:
            sr, sc, er, ec = parse_range(address_or_range)
            ranges = [(sr, sc, er, ec)]
        else:
            row, col = parse_a1(address_or_range)
            sr, sc = row, col
            ranges = [(row, col, row, col)]

        if active_address:
            active_row, active_col = parse_a1(active_address)
        else:
            active_row, active_col = sr, sc

        ranges_json = json.dumps(ranges)
        raw = self._bridge.toggle_format_property(
            self._sheet_id_json, ranges_json, property, active_row, active_col
        )
        return _mutation_from_raw(raw)

    # ------------------------------------------------------------------
    # Indent operations
    # ------------------------------------------------------------------

    def adjust_indent(
        self,
        address_or_range: str,
        delta: int,
    ) -> MutationResult:
        """Adjust the indent level of a cell or range.

        Parameters
        ----------
        address_or_range:
            An A1 address or range.
        delta:
            The number of indent levels to add (positive) or remove (negative).
        """
        if ":" in address_or_range:
            sr, sc, er, ec = parse_range(address_or_range)
        else:
            row, col = parse_a1(address_or_range)
            sr, sc, er, ec = row, col, row, col

        # Read current indent, apply delta, and write back
        fmt = self.get(
            address_or_range.split(":")[0] if ":" in address_or_range else address_or_range
        )
        current = fmt.get("indent") or fmt.get("indentLevel") or 0
        if not isinstance(current, (int, float)):
            current = 0
        new_indent = max(0, int(current) + delta)
        return self.set(address_or_range, {"indent": new_indent})

    # ------------------------------------------------------------------
    # Fill operations
    # ------------------------------------------------------------------

    def clear_fill(self, address_or_range: str) -> MutationResult:
        """Clear only the fill/background color, preserving all other formatting.

        Parameters
        ----------
        address_or_range:
            An A1 address or range.
        """
        # We need to clear the cell format and re-apply everything
        # except fill-related properties, because set_format_for_ranges
        # cannot set a property to null.
        if ":" in address_or_range:
            sr, sc, er, ec = parse_range(address_or_range)
        else:
            row, col = parse_a1(address_or_range)
            sr, sc, er, ec = row, col, row, col

        _FILL_KEYS = {"backgroundColor", "patternType", "patternForegroundColor", "gradientFill"}
        last_result = None
        for r in range(sr, er + 1):
            for c in range(sc, ec + 1):
                cell_id_raw = self._bridge.get_cell_id_at(self._sheet_id_json, r, c)
                if cell_id_raw is None or cell_id_raw == "null":
                    continue
                # Get current cell-level format
                current = self._bridge.call_json(
                    "compute_get_cell_format", self._sheet_id_json, cell_id_raw, r, c
                )
                if not isinstance(current, dict):
                    continue
                # Clear the cell format
                self._bridge.call_json(
                    "compute_clear_cell_format", self._sheet_id_json, cell_id_raw
                )
                # Re-apply non-fill properties
                restore = {}
                for k, v in current.items():
                    if k not in _FILL_KEYS and v is not None:
                        # Skip default-like values
                        restore[k] = v
                if restore:
                    self._bridge.call_json(
                        "compute_set_cell_format", self._sheet_id_json,
                        cell_id_raw, json.dumps(restore)
                    )
                last_result = {}
        return deserialize_mutation_result(last_result or {})

    # ------------------------------------------------------------------
    # Number format category
    # ------------------------------------------------------------------

    def get_number_format_category(self, address: str) -> str:
        """Get the category of the number format applied to a cell.

        Returns a string like ``"general"``, ``"number"``, ``"currency"``,
        ``"date"``, ``"time"``, ``"percentage"``, ``"fraction"``,
        ``"scientific"``, or ``"accounting"``.
        """
        fmt = self.get(address)
        nf = fmt.get("numberFormat")
        return _categorize_number_format(nf)

    # ------------------------------------------------------------------
    # Format painter / apply pattern
    # ------------------------------------------------------------------

    def apply_pattern(
        self,
        source_format: Dict[str, Any],
        source_range: Dict[str, Any],
        target_range: Dict[str, Any],
    ) -> MutationResult:
        """Apply a format pattern from a source to a target range.

        Parameters
        ----------
        source_format:
            The format dict to apply (e.g. from ``formats.get()``).
        source_range:
            Source range dict with ``startRow``, ``startCol``, ``endRow``, ``endCol``.
        target_range:
            Target range dict with ``startRow``, ``startCol``, ``endRow``, ``endCol``.
        """
        sr = target_range.get("startRow", 0)
        sc = target_range.get("startCol", 0)
        er = target_range.get("endRow", 0)
        ec = target_range.get("endCol", 0)

        # Filter to only known format properties (skip None values and
        # internal fields)
        _FORMAT_PROPS = {
            "bold", "italic", "strikethrough", "underlineType", "underline",
            "fontFamily", "fontSize", "fontColor",
            "backgroundColor", "patternType", "patternForegroundColor",
            "horizontalAlign", "verticalAlign", "wrapText",
            "numberFormat", "indent", "textRotation", "shrinkToFit",
            "locked", "hidden",
            "borders",
        }
        clean_fmt = {}
        for k, v in source_format.items():
            if k in _FORMAT_PROPS and v is not None:
                clean_fmt[k] = v

        ranges = [(sr, sc, er, ec)]
        ranges_json = json.dumps(ranges)
        format_json = json.dumps(_normalize_format_keys(clean_fmt))
        raw = self._bridge.set_format_for_ranges(
            self._sheet_id_json, ranges_json, format_json
        )
        return _mutation_from_raw(raw)
