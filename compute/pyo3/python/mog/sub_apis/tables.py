"""Table APIs that are not production-backed in the Python SDK yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class TablesAPI(UnsupportedSubApiMixin):
    """Table operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.tables"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.tables"

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def create(
        self,
        range_str: str,
        name: str = "Table1",
        columns: Optional[List[str]] = None,
        has_headers: bool = True,
    ) -> "MutationResult":
        unsupported_python_path("ws.tables.create")

    def list(self) -> List[Dict[str, Any]]:
        unsupported_python_path("ws.tables.list")

    def add(
        self,
        range_str: str,
        options_or_name: Any = None,
        *,
        name: Optional[str] = None,
        columns: Optional[List[str]] = None,
        has_headers: bool = True,
    ) -> "MutationResult":
        unsupported_python_path("ws.tables.add")

    def get(self, table_name: str) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.tables.get")

    def delete(self, table_name: str) -> "MutationResult":
        unsupported_python_path("ws.tables.delete")

    def remove(self, table_name: str) -> Dict[str, Any]:
        unsupported_python_path("ws.tables.remove")

    def rename(self, old_name: str, new_name: str) -> None:
        unsupported_python_path("ws.tables.rename")

    def resize(self, table_name: str, new_range: str) -> Dict[str, Any]:
        unsupported_python_path("ws.tables.resize")

    def update(self, table_name: str, updates: Dict[str, Any]) -> None:
        unsupported_python_path("ws.tables.update")

    def toggle_totals_row(self, table_name: str) -> None:
        unsupported_python_path("ws.tables.toggle_totals_row")

    def toggle_header_row(self, table_name: str) -> None:
        unsupported_python_path("ws.tables.toggle_header_row")

    def clear_filters(self, table_name: str) -> None:
        unsupported_python_path("ws.tables.clear_filters")

    def apply_auto_expansion(self, table_name: str) -> None:
        unsupported_python_path("ws.tables.apply_auto_expansion")

    def add_column(self, table_name: str, column_name: str) -> None:
        unsupported_python_path("ws.tables.add_column")

    def remove_column(self, table_name: str, column_index: int) -> None:
        unsupported_python_path("ws.tables.remove_column")

    def get_data_body_range(self, table_name: str) -> Optional[str]:
        unsupported_python_path("ws.tables.get_data_body_range")

    def get_header_row_range(self, table_name: str) -> Optional[str]:
        unsupported_python_path("ws.tables.get_header_row_range")

    def get_total_row_range(self, table_name: str) -> Optional[str]:
        unsupported_python_path("ws.tables.get_total_row_range")

    def get_row_count(self, table_name: str) -> int:
        unsupported_python_path("ws.tables.get_row_count")

    def get_row_values(self, table_name: str, row_index: int) -> Optional[List[Any]]:
        unsupported_python_path("ws.tables.get_row_values")

    def get_row_range(self, table_name: str, row_index: int) -> Optional[str]:
        unsupported_python_path("ws.tables.get_row_range")

    def set_row_values(self, table_name: str, row_index: int, values: List[Any]) -> None:
        unsupported_python_path("ws.tables.set_row_values")

    def add_row(
        self,
        table_name: str,
        index: Optional[int] = None,
        values: Optional[List[Any]] = None,
    ) -> Dict[str, Any]:
        unsupported_python_path("ws.tables.add_row")

    def delete_row(self, table_name: str, row_index: int) -> Dict[str, Any]:
        unsupported_python_path("ws.tables.delete_row")

    def get_at_cell(self, row: int, col: int) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.tables.get_at_cell")

    def set_highlight_first_column(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_highlight_first_column")

    def set_highlight_last_column(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_highlight_last_column")

    def set_show_banded_columns(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_show_banded_columns")

    def set_show_banded_rows(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_show_banded_rows")

    def set_show_filter_button(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_show_filter_button")

    def set_show_headers(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_show_headers")

    def set_show_totals(self, table_name: str, value: bool) -> None:
        unsupported_python_path("ws.tables.set_show_totals")

    def set_style_preset(self, table_name: str, style: str) -> None:
        unsupported_python_path("ws.tables.set_style_preset")

    def get_column_data_body_range(self, table_name: str, col_index: int) -> Optional[str]:
        unsupported_python_path("ws.tables.get_column_data_body_range")

    def get_column_header_range(self, table_name: str, col_index: int) -> Optional[str]:
        unsupported_python_path("ws.tables.get_column_header_range")

    def get_column_range(self, table_name: str, col_index: int) -> Optional[str]:
        unsupported_python_path("ws.tables.get_column_range")

    def get_column_total_range(self, table_name: str, col_index: int) -> Optional[str]:
        unsupported_python_path("ws.tables.get_column_total_range")

    def get_column_values(self, table_name: str, col_index: int) -> Optional[List[Any]]:
        unsupported_python_path("ws.tables.get_column_values")

    def set_column_values(self, table_name: str, col_index: int, values: List[Any]) -> None:
        unsupported_python_path("ws.tables.set_column_values")

    def set_calculated_column(self, table_name: str, col_index: int, formula: str) -> None:
        unsupported_python_path("ws.tables.set_calculated_column")

    def clear_calculated_column(self, table_name: str, col_index: int) -> None:
        unsupported_python_path("ws.tables.clear_calculated_column")

    @property
    def events(self) -> Any:
        return self.__getattr__("events")

    @property
    def sort(self) -> Any:
        return self.__getattr__("sort")
