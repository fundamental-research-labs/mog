"""Public types for the Mog Python SDK.

These are plain Python types (dataclasses / TypedDicts) that mirror the
Rust-side types returned by the engine.  They are independent of the
native extension so users can reference them without importing ``_native``.
"""
from __future__ import annotations

import collections.abc
import dataclasses
from typing import Any, Dict, List, Optional, Union


# ---------------------------------------------------------------------------
# CellValue — the semantic value of a cell
# ---------------------------------------------------------------------------

#: A cell value as seen by the SDK.
#: - ``None`` means the cell is empty.
#: - ``bool``, ``int``, ``float``, ``str`` are the four primitive types.
#: - ``CellError`` represents a formula error (#VALUE!, #REF!, etc.).
CellValue = Union[None, bool, int, float, str, "CellError"]


@dataclasses.dataclass(frozen=True)
class CellError:
    """A formula error value (e.g., #VALUE!, #REF!, #NAME?)."""

    kind: str
    """Error type string, e.g. ``"VALUE"``, ``"REF"``, ``"NAME"``."""

    message: str = ""
    """Optional human-readable description."""

    def __repr__(self) -> str:
        return f"CellError(#{self.kind}!)"


# ---------------------------------------------------------------------------
# CellInfo — full cell metadata
# ---------------------------------------------------------------------------

class CellInfo(dict[str, Any]):
    """Full information about a single cell.

    Inherits from ``dict`` so that ``isinstance(info, dict)`` returns
    ``True`` (required by scenario compatibility).  Supports both
    dict-style access (``info["value"]``) and attribute access
    (``info.value``).
    """

    __slots__ = ()  # No extra per-instance dict; data lives in the dict itself.

    def __init__(
        self,
        value: CellValue = None,
        formula: Optional[str] = None,
        display_value: str = "",
        raw_value: str = "",
    ) -> None:
        super().__init__(
            value=value,
            formula=formula,
            display_value=display_value,
            raw_value=raw_value,
            # Alias: scenarios may use "formatted" instead of "display_value"
            formatted=display_value,
        )

    # --- Attribute-style access ---

    @property
    def value(self) -> CellValue:
        return self["value"]

    @value.setter
    def value(self, v: CellValue) -> None:
        self["value"] = v

    @property
    def formula(self) -> Optional[str]:
        return self["formula"]

    @formula.setter
    def formula(self, v: Optional[str]) -> None:
        self["formula"] = v

    @property
    def display_value(self) -> str:
        return self["display_value"]

    @display_value.setter
    def display_value(self, v: str) -> None:
        self["display_value"] = v

    @property
    def raw_value(self) -> str:
        return self["raw_value"]

    @raw_value.setter
    def raw_value(self, v: str) -> None:
        self["raw_value"] = v

    def __repr__(self) -> str:
        return (
            f"CellInfo(value={self['value']!r}, formula={self['formula']!r}, "
            f"display_value={self['display_value']!r}, raw_value={self['raw_value']!r})"
        )


# ---------------------------------------------------------------------------
# MutationResult — result of a write operation
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class MutationResult:
    """Result returned by mutation operations.

    Thin wrapper around the JSON dict returned by the Rust engine.
    Supports dict-style access (``result["data"]``, ``result.get("data")``)
    for scenario compatibility.
    """

    raw: Dict[str, Any] = dataclasses.field(default_factory=dict)
    """The raw JSON-deserialized result from the engine."""

    @property
    def data(self) -> Any:
        """Operation-specific data payload (may be ``None``)."""
        return self.raw.get("data")

    def get(self, key: str, default: Any = None) -> Any:
        """Dict-style ``.get()`` -- delegates to the raw dict."""
        # Check dataclass fields first, then raw dict
        if key == "raw":
            return self.raw
        if key == "data":
            return self.data
        return self.raw.get(key, default)

    def __getitem__(self, key: str) -> Any:
        if key == "raw":
            return self.raw
        if key == "data":
            return self.data
        return self.raw[key]

    def __contains__(self, key: str) -> bool:
        return key in self.raw or key in ("raw", "data")


# ---------------------------------------------------------------------------
# DataBounds — used range of a sheet
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class DataBounds:
    """The bounding rectangle of all non-empty cells in a sheet."""

    min_row: int
    min_col: int
    max_row: int
    max_col: int


# ---------------------------------------------------------------------------
# UndoState
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class UndoState:
    """Snapshot of the undo/redo stack."""

    can_undo: bool
    can_redo: bool
    undo_depth: int = 0
    redo_depth: int = 0

    def get(self, key: str, default: Any = None) -> Any:
        """Dict-style ``.get()`` for scenario compatibility."""
        # Map camelCase keys to snake_case attributes
        key_map = {
            "canUndo": "can_undo",
            "canRedo": "can_redo",
            "undoDepth": "undo_depth",
            "redoDepth": "redo_depth",
        }
        attr = key_map.get(key, key)
        return getattr(self, attr, default)

    def __getitem__(self, key: str) -> Any:
        result = self.get(key, dataclasses.MISSING)
        if result is dataclasses.MISSING:
            raise KeyError(key)
        return result
