"""Workbook named-range APIs that are not production-backed in Python yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class NamesAPI(UnsupportedSubApiMixin):
    """Named range management for a workbook."""

    __slots__ = ("_bridge",)
    _UNSUPPORTED_ACCESSOR_API_PATH = "wb.names"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "wb.names"

    def __init__(self, bridge: Bridge) -> None:
        self._bridge = bridge

    def add(
        self,
        name: str,
        refers_to: str,
        scope: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> "MutationResult":
        unsupported_python_path("wb.names.add")

    def remove(self, name: str) -> "MutationResult":
        unsupported_python_path("wb.names.remove")

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        unsupported_python_path("wb.names.get")

    def list(self) -> List[Dict[str, Any]]:
        unsupported_python_path("wb.names.list")

    def update(self, name: str, updates: Dict[str, Any]) -> None:
        unsupported_python_path("wb.names.update")
