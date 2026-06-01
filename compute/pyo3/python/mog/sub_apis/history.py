"""Undo/redo operations -- ``wb.history.undo()``, ``wb.history.redo()``."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable, Dict, List

from mog._serde import deserialize_mutation_result, deserialize_undo_state
from mog._unsupported import unsupported_python_path
from mog.types import MutationResult, UndoState

if TYPE_CHECKING:
    from mog._bridge import Bridge


class HistoryAPI:
    """Undo/redo and undo-group operations on a workbook."""

    __slots__ = ("_bridge", "_workbook")

    def __init__(self, bridge: Bridge, workbook: Any = None) -> None:
        self._bridge = bridge
        self._workbook = workbook

    def undo(self) -> MutationResult:
        """Undo the last user edit."""
        raw = self._bridge.undo()
        if self._workbook is not None:
            self._workbook._needs_formula_repair = True
        return deserialize_mutation_result(raw)

    def redo(self) -> MutationResult:
        """Redo the last undone edit."""
        raw = self._bridge.redo()
        if self._workbook is not None:
            self._workbook._needs_formula_repair = True
        return deserialize_mutation_result(raw)

    def can_undo(self) -> bool:
        """Check whether undo is available."""
        return self._bridge.can_undo()

    def can_redo(self) -> bool:
        """Check whether redo is available."""
        return self._bridge.can_redo()

    def get_state(self) -> UndoState:
        """Get a snapshot of the undo/redo state."""
        raw = self._bridge.get_undo_state()
        return deserialize_undo_state(raw)

    def list(self) -> List[Dict[str, Any]]:
        """Return a list of undo history entries.

        Each entry is a dict that may contain ``description``, ``timestamp``,
        and other metadata.  In headless mode the list may be empty.
        """
        unsupported_python_path("wb.history.list")

    def go_to_index(self, index: int) -> MutationResult:
        """Navigate to a specific point in the undo history.

        This performs the required number of undo/redo operations to
        reach the specified index.

        Parameters
        ----------
        index:
            The target history index.
        """
        unsupported_python_path("wb.history.go_to_index")

    def begin_group(self) -> MutationResult:
        """Begin an undo group -- all mutations until ``end_group`` are
        collapsed into a single undo step.  Supports nesting."""
        raw = self._bridge.begin_undo_group()
        return deserialize_mutation_result(raw)

    def end_group(self) -> MutationResult:
        """End the current undo group."""
        raw = self._bridge.end_undo_group()
        return deserialize_mutation_result(raw)

    def set_next_description(self, description: str) -> None:
        """Set the description for the next undoable operation."""
        unsupported_python_path("wb.history.set_next_description")

    def subscribe(self, handler: Callable[[Dict[str, Any]], None]) -> Callable[[], None]:
        """Subscribe to history changes."""
        unsupported_python_path("wb.history.subscribe")
