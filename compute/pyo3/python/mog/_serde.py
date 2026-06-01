"""Serialization helpers: Python values <-> bridge JSON strings.

The native bridge methods accept/return JSON strings for complex types
(SheetId, CellFormat, MutationResult, etc.) and primitives for simple
values (row, col).  This module handles all conversions.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from mog.types import CellError, CellInfo, CellValue, DataBounds, MutationResult, UndoState

# ---------------------------------------------------------------------------
# A1 address parsing (Python-side, ~30 LOC)
# ---------------------------------------------------------------------------

_MAX_ROWS = 1_048_576
_MAX_COLS = 16_384

_A1_RE = re.compile(
    r"^\$?([A-Za-z]{1,3})\$?(\d+)$"
)

_RANGE_RE = re.compile(
    r"^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)$"
)


def _col_from_letters(letters: str) -> int:
    """Convert column letters (e.g. ``'A'``, ``'AA'``, ``'XFD'``) to 0-based index."""
    result = 0
    for ch in letters.upper():
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result - 1  # 0-based


def _col_to_a1(col: int) -> str:
    """Convert a 0-based column index to A1-style letters (e.g. 0 -> 'A', 25 -> 'Z', 26 -> 'AA')."""
    letters = ""
    c = col
    while True:
        letters = chr(ord("A") + c % 26) + letters
        c = c // 26 - 1
        if c < 0:
            break
    return letters


def parse_a1(address: str) -> Tuple[int, int]:
    """Parse an A1-style address to 0-based ``(row, col)``.

    Supports absolute markers (``$A$1``), lowercase, and multi-letter columns.

    Raises ``ValueError`` on invalid input.
    """
    m = _A1_RE.match(address.replace("$", ""))
    if not m:
        # Try stripping $ first then matching
        stripped = address.replace("$", "")
        m = _A1_RE.match(stripped)
        if not m:
            raise ValueError(f"Invalid A1 address: {address!r}")
    col = _col_from_letters(m.group(1))
    row_1based = int(m.group(2))
    if row_1based < 1 or row_1based > _MAX_ROWS:
        raise ValueError(
            f"Row {row_1based} out of range (1..{_MAX_ROWS}) in address: {address!r}"
        )
    if col < 0 or col >= _MAX_COLS:
        raise ValueError(
            f"Column out of range in address: {address!r}"
        )
    return (row_1based - 1, col)


def parse_range(range_str: str) -> Tuple[int, int, int, int]:
    """Parse an A1-style range (e.g. ``'A1:B2'``) to 0-based ``(sr, sc, er, ec)``.

    Also accepts a single-cell address (``'A1'``), which is treated as ``'A1:A1'``.
    """
    m = _RANGE_RE.match(range_str.replace("$", ""))
    if not m:
        # Try splitting on ':'
        parts = range_str.split(":")
        if len(parts) == 2:
            sr, sc = parse_a1(parts[0])
            er, ec = parse_a1(parts[1])
            return (sr, sc, er, ec)
        # Single-cell address -- treat as a 1x1 range
        if len(parts) == 1:
            row, col = parse_a1(range_str)
            return (row, col, row, col)
        raise ValueError(f"Invalid range: {range_str!r}")
    sc = _col_from_letters(m.group(1))
    sr = int(m.group(2)) - 1
    ec = _col_from_letters(m.group(3))
    er = int(m.group(4)) - 1
    return (sr, sc, er, ec)


# ---------------------------------------------------------------------------
# Value normalization (Python -> input string for the engine)
# ---------------------------------------------------------------------------

def normalize_value(value: Any) -> str:
    """Convert a Python value to the input string expected by the engine.

    Mirrors the ``SdkValue::to_input_string()`` logic in Rust:
    - ``None`` -> ``""`` (clears the cell)
    - ``bool`` -> ``"TRUE"`` / ``"FALSE"``
    - ``int`` / ``float`` -> string (integer form when lossless)
    - ``str`` -> as-is (formulas start with ``=``)
    - ``""`` -> ``"\\x00"`` (sentinel for explicitly empty text)
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        if math.isnan(value):
            return "NaN"
        # Use integer form when lossless
        if value == int(value) and math.isfinite(value):
            return str(int(value))
        return str(value)
    if isinstance(value, str):
        if value == "":
            return "\x00"
        return value
    # Fallback: stringify
    return str(value)


# ---------------------------------------------------------------------------
# Return value deserialization (engine JSON -> Python)
# ---------------------------------------------------------------------------

def deserialize_cell_value(raw: Any) -> CellValue:
    """Deserialize a CellValue from the engine's JSON representation.

    The Rust engine returns cell values as JSON with these shapes:
    - ``"Null"`` or ``null`` -> ``None``
    - ``{"Number": 42.0}`` -> ``42`` or ``42.0``
    - ``{"String": "hello"}`` -> ``"hello"``
    - ``{"Bool": true}`` -> ``True``
    - ``"Empty"`` -> ``None``
    - ``{"Error": {"kind": "VALUE", ...}}`` -> ``CellError``
    """
    if raw is None or raw == "Null" or raw == "Empty":
        return None

    if isinstance(raw, str):
        if raw == "":
            return None
        if raw == "\x00":
            return ""
        # Bridge.call_json already unwraps native JSON once. If the result is
        # a Python str, it is a text cell value and must not be decoded again
        # (e.g. text "11" is not the number 11).
        if raw.startswith(('"', "{", "[")):
            try:
                decoded = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw
            if isinstance(decoded, str):
                return "" if decoded == "\x00" else decoded
            raw = decoded
        else:
            return raw

    if isinstance(raw, dict):
        # Handle engine error format: {"type": "error", "value": "Div0", "message": "..."}
        if raw.get("type") == "error":
            return raw  # Return as-is for CellInfo.value (dict with type/value/message)
        if "Number" in raw:
            n = raw["Number"]
            # Return int when the number is an exact integer
            if isinstance(n, float) and n == int(n) and math.isfinite(n):
                i = int(n)
                # Only collapse to int if it fits comfortably
                if abs(i) <= 2**53:
                    return i
            return n
        if "String" in raw:
            return "" if raw["String"] == "\x00" else raw["String"]
        if "Bool" in raw:
            return raw["Bool"]
        if "Error" in raw:
            err = raw["Error"]
            if isinstance(err, dict):
                return CellError(
                    kind=err.get("kind", err.get("type", "UNKNOWN")),
                    message=err.get("message", ""),
                )
            return CellError(kind=str(err))
        # Fallback for other dict shapes
        if "Text" in raw:
            return raw["Text"]
        if "Blank" in raw:
            return None

    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        # Collapse float to int when lossless
        if isinstance(raw, float) and raw == int(raw) and math.isfinite(raw):
            i = int(raw)
            if abs(i) <= 2**53:
                return i
        return raw

    return raw


# Map engine error codes to Excel-style display strings
_ERROR_DISPLAY_MAP = {
    "Div0": "#DIV/0!",
    "Value": "#VALUE!",
    "Ref": "#REF!",
    "Name": "#NAME?",
    "Num": "#NUM!",
    "Null": "#NULL!",
    "Na": "#N/A",
    "NA": "#N/A",
    "Calc": "#CALC!",
    "Spill": "#SPILL!",
    "GettingData": "#GETTING_DATA",
    "Circ": "#CIRC!",
}


def error_dict_to_display_string(error_dict: dict) -> str:
    """Convert an error dict like ``{"type": "error", "value": "Div0"}``
    to its Excel display string like ``"#DIV/0!"``."""
    code = error_dict.get("value", "")
    return _ERROR_DISPLAY_MAP.get(code, f"#{code}!")


def deserialize_cell_value_grid(raw: Any) -> list:
    """Deserialize a 2D grid of cell values from JSON."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, list):
        return []
    result = []
    for row in raw:
        if isinstance(row, list):
            result.append([deserialize_cell_value(v) for v in row])
        else:
            result.append([deserialize_cell_value(row)])
    return result


def deserialize_mutation_result(raw: Any) -> MutationResult:
    """Wrap a raw JSON result into a MutationResult."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raw = {}
    if not isinstance(raw, dict):
        raw = {}
    return MutationResult(raw=raw)


def deserialize_undo_state(raw: Any) -> UndoState:
    """Deserialize an UndoState from JSON."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, dict):
        return UndoState(can_undo=False, can_redo=False)
    return UndoState(
        can_undo=raw.get("canUndo", raw.get("can_undo", False)),
        can_redo=raw.get("canRedo", raw.get("can_redo", False)),
        undo_depth=raw.get("undoDepth", raw.get("undo_depth", 0)),
        redo_depth=raw.get("redoDepth", raw.get("redo_depth", 0)),
    )
