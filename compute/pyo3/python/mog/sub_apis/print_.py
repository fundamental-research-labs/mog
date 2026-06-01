"""Print APIs that are not production-backed in Python yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class PrintAPI(UnsupportedSubApiMixin):
    """Print settings and print area operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.print"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.print_"

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def set_settings(self, settings: Dict[str, Any]) -> "MutationResult":
        unsupported_python_path("ws.print_.set_settings")

    def get_settings(self) -> Dict[str, Any]:
        unsupported_python_path("ws.print_.get_settings")

    def set_area(self, range_str: str) -> "MutationResult":
        unsupported_python_path("ws.print_.set_area")

    def get_area(self) -> Optional[str]:
        unsupported_python_path("ws.print_.get_area")

    def clear_area(self) -> "MutationResult":
        unsupported_python_path("ws.print_.clear_area")

    def add_page_break(self, config: Dict[str, Any]) -> "MutationResult":
        unsupported_python_path("ws.print_.add_page_break")

    def remove_page_break(self, config: Dict[str, Any]) -> "MutationResult":
        unsupported_python_path("ws.print_.remove_page_break")

    def get_page_breaks(self) -> List[Dict[str, Any]]:
        unsupported_python_path("ws.print_.get_page_breaks")

    def remove_all_page_breaks(self) -> "MutationResult":
        unsupported_python_path("ws.print_.remove_all_page_breaks")

    def set_titles(self, config: Dict[str, str]) -> None:
        unsupported_python_path("ws.print_.set_titles")

    def get_titles(self) -> Dict[str, str]:
        unsupported_python_path("ws.print_.get_titles")

    def clear_titles(self) -> None:
        unsupported_python_path("ws.print_.clear_titles")
