"""Sheet protection APIs that are not production-backed in Python yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional, Union

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class ProtectionAPI(UnsupportedSubApiMixin):
    """Sheet protection operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.protection"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.protection"

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def mark_unlocked(self, row: int, col: int) -> None:
        unsupported_python_path("ws.protection.mark_unlocked")

    def mark_locked(self, row: int, col: int) -> None:
        unsupported_python_path("ws.protection.mark_locked")

    def protect(
        self,
        password: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> "MutationResult":
        unsupported_python_path("ws.protection.protect")

    def unprotect(self, password: Optional[str] = None) -> Union["MutationResult", bool]:
        unsupported_python_path("ws.protection.unprotect")

    def is_protected(self) -> bool:
        unsupported_python_path("ws.protection.is_protected")

    def can_edit_cell(self, row: int, col: int) -> bool:
        unsupported_python_path("ws.protection.can_edit_cell")

    def can_sort(self) -> bool:
        unsupported_python_path("ws.protection.can_sort")

    def can_do_structure_op(self, operation: str) -> bool:
        unsupported_python_path("ws.protection.can_do_structure_op")

    def get_config(self) -> Dict[str, Any]:
        unsupported_python_path("ws.protection.get_config")

    def get_selection_mode(self) -> str:
        unsupported_python_path("ws.protection.get_selection_mode")

    def set_selection_mode(self, mode: str) -> None:
        unsupported_python_path("ws.protection.set_selection_mode")

    @property
    def allow_edit_ranges(self) -> Any:
        return self.__getattr__("allow_edit_ranges")
