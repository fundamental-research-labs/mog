"""Chart APIs that are not production-backed in the Python SDK yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge


class ChartsAPI(UnsupportedSubApiMixin):
    """Chart operations on a worksheet.

    The accessor is public so every child method can advertise an explicit
    disposition. Until the chart family is wired to verified native behavior,
    calls fail instead of mutating local shadow state.
    """

    __slots__ = ("_bridge", "_sheet_id_json")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.charts"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.charts"

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def create(self, config: Dict[str, Any]) -> str:
        unsupported_python_path("ws.charts.create")

    def add(self, config: Dict[str, Any]) -> str:
        unsupported_python_path("ws.charts.add")

    def get(self, chart_id: str) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.charts.get")

    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.charts.get_by_name")

    def update(self, chart_id: str, updates: Dict[str, Any]) -> Any:
        unsupported_python_path("ws.charts.update")

    def delete(self, chart_id: str) -> Any:
        unsupported_python_path("ws.charts.delete")

    def remove(self, chart_id: str) -> Any:
        unsupported_python_path("ws.charts.remove")

    def list(self) -> List[Dict[str, Any]]:
        unsupported_python_path("ws.charts.list")

    def get_count(self) -> int:
        unsupported_python_path("ws.charts.get_count")

    def sync_from_engine(self) -> None:
        unsupported_python_path("ws.charts.sync_from_engine")

    def duplicate(self, chart_id: str) -> Optional[str]:
        unsupported_python_path("ws.charts.duplicate")

    def set_data_range(self, chart_id: str, data_range: str) -> None:
        unsupported_python_path("ws.charts.set_data_range")

    def set_type(self, chart_id: str, chart_type: str) -> None:
        unsupported_python_path("ws.charts.set_type")

    def add_series(self, chart_id: str, series: Dict[str, Any]) -> None:
        unsupported_python_path("ws.charts.add_series")

    def get_series(self, chart_id: str, index: int) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.charts.get_series")

    def get_series_count(self, chart_id: str) -> int:
        unsupported_python_path("ws.charts.get_series_count")

    def remove_series(self, chart_id: str, index: int) -> None:
        unsupported_python_path("ws.charts.remove_series")

    def update_series(self, chart_id: str, index: int, updates: Dict[str, Any]) -> None:
        unsupported_python_path("ws.charts.update_series")

    def reorder_series(self, chart_id: str, from_index: int, to_index: int) -> None:
        unsupported_python_path("ws.charts.reorder_series")

    def set_series_values(self, chart_id: str, index: int, values_range: str) -> None:
        unsupported_python_path("ws.charts.set_series_values")

    def set_series_categories(self, chart_id: str, index: int, categories_range: str) -> None:
        unsupported_python_path("ws.charts.set_series_categories")

    def bring_to_front(self, chart_id: str) -> None:
        unsupported_python_path("ws.charts.bring_to_front")

    def send_to_back(self, chart_id: str) -> None:
        unsupported_python_path("ws.charts.send_to_back")

    def bring_forward(self, chart_id: str) -> None:
        unsupported_python_path("ws.charts.bring_forward")

    def send_backward(self, chart_id: str) -> None:
        unsupported_python_path("ws.charts.send_backward")

    def format_point(self, chart_id: str, series_index: int, point_index: int, fmt: Dict[str, Any]) -> None:
        unsupported_python_path("ws.charts.format_point")

    def set_point_data_label(self, chart_id: str, series_index: int, point_index: int, label: Dict[str, Any]) -> None:
        unsupported_python_path("ws.charts.set_point_data_label")

    def export_image(self, chart_id: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        unsupported_python_path("ws.charts.export_image")

    def is_linked_to_table(self, chart_id: str) -> bool:
        unsupported_python_path("ws.charts.is_linked_to_table")

    def link_to_table(self, chart_id: str, table_id: str) -> None:
        unsupported_python_path("ws.charts.link_to_table")

    def unlink_from_table(self, chart_id: str) -> None:
        unsupported_python_path("ws.charts.unlink_from_table")
