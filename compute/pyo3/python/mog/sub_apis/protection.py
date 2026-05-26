"""Sheet protection -- ``ws.protection.protect()``, ``ws.protection.unprotect()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, Optional, Set, Tuple

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class ProtectionAPI:
    """Sheet protection operations on a worksheet.

    Protection state is managed in Python.  When a sheet is protected,
    all cells are considered *locked* by default.  Cells can be explicitly
    unlocked via ``ws.formats.set("B1", {"locked": False})`` *before*
    protection is enabled, at which point they remain editable.
    """

    __slots__ = (
        "_bridge",
        "_sheet_id_json",
        "_selection_mode",
        "_protected",
        "_password",
        "_unlocked_cells",
    )

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._selection_mode = "normal"
        self._protected = False
        self._password: Optional[str] = None
        self._unlocked_cells: Set[Tuple[int, int]] = set()

    # ------------------------------------------------------------------
    # Unlocked-cell tracking (called by FormatsAPI)
    # ------------------------------------------------------------------

    def mark_unlocked(self, row: int, col: int) -> None:
        """Record that *(row, col)* has been explicitly unlocked."""
        self._unlocked_cells.add((row, col))

    def mark_locked(self, row: int, col: int) -> None:
        """Record that *(row, col)* has been re-locked."""
        self._unlocked_cells.discard((row, col))

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def protect(self, password: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> MutationResult:
        """Protect the sheet.

        Parameters
        ----------
        password:
            Optional password for the protection.
        options:
            Optional dict of protection options (e.g. ``{"allowFormatCells": True}``).
            Currently unused by the engine but accepted for forward-compatibility.
        """
        self._protected = True
        self._password = password
        # Best-effort engine call (may not be implemented in Rust)
        try:
            raw = self._bridge.call_json(
                "compute_protect_sheet",
                self._sheet_id_json,
                json.dumps(password),
            )
            return deserialize_mutation_result(raw)
        except Exception:
            return deserialize_mutation_result({})

    def unprotect(self, password: Optional[str] = None):
        """Unprotect the sheet.

        Parameters
        ----------
        password:
            The password used to protect the sheet (if any).

        Returns the :class:`MutationResult` on success, or ``False`` if the
        password was incorrect.
        """
        if self._password is not None and password != self._password:
            return False
        self._protected = False
        self._password = None
        try:
            raw = self._bridge.call_json(
                "compute_unprotect_sheet",
                self._sheet_id_json,
                json.dumps(password),
            )
            return deserialize_mutation_result(raw)
        except Exception:
            return deserialize_mutation_result({})

    def is_protected(self) -> bool:
        """Check whether the sheet is protected.

        Queries the engine first so that undo/redo of protect/unprotect
        is reflected correctly.  Falls back to the local Python flag.
        """
        try:
            result = self._bridge.call_json(
                "compute_is_sheet_protected", self._sheet_id_json
            )
            if isinstance(result, bool):
                self._protected = result
                return result
        except Exception:
            pass
        return self._protected

    def can_edit_cell(self, row: int, col: int) -> bool:
        """Check whether the given cell can be edited (considering protection and lock state).

        Returns True if the cell can be edited, False if editing is blocked.
        """
        if not self.is_protected():
            return True
        # Check explicit unlock set first
        if (row, col) in self._unlocked_cells:
            return True
        # Also check the cell format from the engine for `locked: false`
        try:
            fmt = self._bridge.call_json(
                "compute_get_resolved_format", self._sheet_id_json, row, col
            )
            if isinstance(fmt, dict):
                # Check both camelCase and snake_case
                locked = fmt.get("locked", fmt.get("is_locked"))
                if locked is False:
                    return True
        except Exception:
            pass
        return False

    def can_sort(self) -> bool:
        """Check whether sorting is allowed on a protected sheet.

        When the sheet is protected, sorting is blocked unless explicitly allowed.
        """
        if not self.is_protected():
            return True
        return False

    def can_do_structure_op(self, operation: str) -> bool:
        """Check whether a structural operation (e.g. 'insertRows') is allowed.

        Returns False when the sheet is protected and the operation is not permitted.
        """
        if not self.is_protected():
            return True
        return False

    def get_config(self) -> Dict[str, Any]:
        """Return the current protection configuration.

        Returns a dict with at minimum ``isProtected`` and ``hasPassword``.
        """
        return {
            "isProtected": self.is_protected(),
            "hasPassword": self._password is not None,
        }

    def get_selection_mode(self) -> str:
        """Return the current selection mode.

        Possible values: ``"normal"``, ``"unlockedOnly"``, ``"none"``.
        """
        return self._selection_mode

    def set_selection_mode(self, mode: str) -> None:
        """Set the selection mode.

        Parameters
        ----------
        mode:
            One of ``"normal"``, ``"unlockedOnly"``, ``"none"``.
        """
        self._selection_mode = mode
