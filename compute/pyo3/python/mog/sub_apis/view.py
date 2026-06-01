"""Worksheet view APIs that are not production-backed in Python yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class ViewAPI(UnsupportedSubApiMixin):
    """View options on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.view"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.view"

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def set_option(self, key: str, value: Any) -> "MutationResult":
        unsupported_python_path("ws.view.set_option")

    def get_options(self) -> Dict[str, Any]:
        unsupported_python_path("ws.view.get_options")

    def get_view_options(self) -> Dict[str, Any]:
        unsupported_python_path("ws.view.get_view_options")

    def set_gridlines(self, show: bool) -> "MutationResult":
        unsupported_python_path("ws.view.set_gridlines")

    def set_headings(self, show: bool) -> "MutationResult":
        unsupported_python_path("ws.view.set_headings")

    def set_tab_color(self, color: str) -> "MutationResult":
        unsupported_python_path("ws.view.set_tab_color")

    def get_tab_color(self) -> Optional[str]:
        unsupported_python_path("ws.view.get_tab_color")

    def get_scroll_position(self) -> Dict[str, int]:
        unsupported_python_path("ws.view.get_scroll_position")

    def set_scroll_position(self, top_row: int, left_col: int) -> "MutationResult":
        unsupported_python_path("ws.view.set_scroll_position")

    def get_split_config(self) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.view.get_split_config")

    def set_split_config(self, config: Optional[Dict[str, Any]]) -> "MutationResult":
        unsupported_python_path("ws.view.set_split_config")

    def freeze_rows(self, count: int) -> "MutationResult":
        unsupported_python_path("ws.view.freeze_rows")

    def freeze_columns(self, count: int) -> "MutationResult":
        unsupported_python_path("ws.view.freeze_columns")

    def freeze_at(self, address: str) -> "MutationResult":
        unsupported_python_path("ws.view.freeze_at")

    def unfreeze(self) -> "MutationResult":
        unsupported_python_path("ws.view.unfreeze")

    def get_frozen_panes(self) -> Dict[str, int]:
        unsupported_python_path("ws.view.get_frozen_panes")
