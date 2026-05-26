"""Chart operations -- ``ws.charts.create()``, ``ws.charts.delete()``."""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class ChartsAPI:
    """Chart CRUD operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_local_charts", "_deleted_ids", "_engine_fetched")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._local_charts: Dict[str, Dict[str, Any]] = {}
        self._deleted_ids: set = set()
        self._engine_fetched: bool = False

    def _sync_local(self, chart_id: str, config: Dict[str, Any]) -> None:
        """Keep a local mirror of chart metadata."""
        self._local_charts[chart_id] = dict(config)

    def create(self, config: Dict[str, Any]) -> str:
        """Create a new chart from a configuration dict.

        Returns the chart ID string.
        """
        chart_id = uuid.uuid4().hex[:16]
        full_config = dict(config, id=chart_id)
        try:
            self._bridge.create_chart(
                self._sheet_id_json, json.dumps(full_config)
            )
        except Exception:
            pass
        self._local_charts[chart_id] = full_config
        return chart_id

    def add(self, config: Dict[str, Any]) -> str:
        """Alias for :meth:`create`."""
        return self.create(config)

    def get(self, chart_id: str) -> Optional[Dict[str, Any]]:
        """Get a chart by ID.

        Returns the chart config dict, or ``None`` if not found.
        """
        local = self._local_charts.get(chart_id)
        if local is not None:
            return local
        # Try to fetch from engine
        try:
            result = self._bridge.call_json(
                "compute_get_chart", self._sheet_id_json, chart_id
            )
            if isinstance(result, dict):
                self._local_charts[chart_id] = result
                return result
        except Exception:
            pass
        return None

    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a chart by its name.

        Returns the chart config dict, or ``None`` if not found.
        """
        for chart in self._local_charts.values():
            if chart.get("name") == name:
                return chart
        return None

    def update(self, chart_id: str, updates: Dict[str, Any]) -> MutationResult:
        """Update a chart with partial updates."""
        try:
            raw = self._bridge.update_chart(
                self._sheet_id_json, chart_id, json.dumps(updates)
            )
        except Exception:
            raw = None
        if chart_id in self._local_charts:
            self._local_charts[chart_id].update(updates)
        return deserialize_mutation_result(raw) if raw else {}

    def delete(self, chart_id: str) -> MutationResult:
        """Delete a chart by ID."""
        try:
            raw = self._bridge.delete_chart(self._sheet_id_json, chart_id)
        except Exception:
            raw = None
        self._local_charts.pop(chart_id, None)
        self._deleted_ids.add(chart_id)
        return deserialize_mutation_result(raw) if raw else {}

    def remove(self, chart_id: str) -> MutationResult:
        """Alias for :meth:`delete`."""
        return self.delete(chart_id)

    def _fetch_engine_charts(self) -> None:
        """Add engine-known charts that are missing from the local cache."""
        try:
            engine_charts = self._bridge.call_json(
                "compute_get_all_charts", self._sheet_id_json
            )
            if isinstance(engine_charts, list):
                for chart in engine_charts:
                    if isinstance(chart, dict):
                        cid = chart.get("id", "")
                        if cid and cid not in self._local_charts and cid not in self._deleted_ids:
                            self._local_charts[cid] = chart
        except Exception:
            pass

    def list(self) -> List[Dict[str, Any]]:
        """Get all charts in this sheet."""
        self._maybe_fetch_engine()
        return list(self._local_charts.values())

    def get_count(self) -> int:
        """Return the number of charts in this sheet."""
        self._maybe_fetch_engine()
        return len(self._local_charts)

    def sync_from_engine(self) -> None:
        """Populate local cache from engine (call after XLSX import)."""
        self._fetch_engine_charts()
        self._engine_fetched = True

    def _maybe_fetch_engine(self) -> None:
        """No-op — engine sync only happens via explicit sync_from_engine()."""
        pass

    def duplicate(self, chart_id: str) -> Optional[str]:
        """Duplicate a chart. Returns the new chart's ID."""
        original = self._local_charts.get(chart_id)
        if original is None:
            return None
        new_id = uuid.uuid4().hex[:16]
        new_chart = dict(original, id=new_id)
        self._local_charts[new_id] = new_chart
        return new_id

    def set_data_range(self, chart_id: str, data_range: str) -> None:
        """Set the data range for a chart."""
        self.update(chart_id, {"dataRange": data_range})

    def set_type(self, chart_id: str, chart_type: str) -> None:
        """Set the chart type."""
        self.update(chart_id, {"type": chart_type})

    # ------------------------------------------------------------------
    # Series operations
    # ------------------------------------------------------------------

    def add_series(self, chart_id: str, series: Dict[str, Any]) -> None:
        """Add a data series to a chart."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        if "series" not in chart:
            chart["series"] = []
        chart["series"].append(series)

    def get_series(self, chart_id: str, index: int) -> Optional[Dict[str, Any]]:
        """Get a series by index from a chart.

        Converts internal ``pointFormats`` to a ``points`` list
        for scenario compatibility.
        """
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return None
        series_list = chart.get("series", [])
        if 0 <= index < len(series_list):
            series = dict(series_list[index])
            # Convert pointFormats dict to points list
            pf = series.get("pointFormats", {})
            if isinstance(pf, dict) and pf:
                points = []
                for pt_idx_str, fmt in sorted(pf.items(), key=lambda x: int(x[0])):
                    pt = {"idx": int(pt_idx_str)}
                    if isinstance(fmt, dict):
                        pt.update(fmt)
                    points.append(pt)
                series["points"] = points
            elif "points" not in series:
                series["points"] = []
            return series
        return None

    def get_series_count(self, chart_id: str) -> int:
        """Get the number of series in a chart."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return 0
        return len(chart.get("series", []))

    def remove_series(self, chart_id: str, index: int) -> None:
        """Remove a series by index from a chart."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= index < len(series_list):
            series_list.pop(index)

    def update_series(self, chart_id: str, index: int, updates: Dict[str, Any]) -> None:
        """Update a series at the given index with partial updates."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= index < len(series_list):
            series_list[index].update(updates)

    def reorder_series(self, chart_id: str, from_index: int, to_index: int) -> None:
        """Move a series from one index to another."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= from_index < len(series_list) and 0 <= to_index <= len(series_list):
            item = series_list.pop(from_index)
            series_list.insert(to_index, item)

    def set_series_values(self, chart_id: str, index: int, values_range: str) -> None:
        """Set the values range for a series."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= index < len(series_list):
            series_list[index]["valuesRange"] = values_range

    def set_series_categories(self, chart_id: str, index: int, categories_range: str) -> None:
        """Set the categories range for a series."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= index < len(series_list):
            series_list[index]["categoriesRange"] = categories_range

    # ------------------------------------------------------------------
    # Z-order operations
    # ------------------------------------------------------------------

    def bring_to_front(self, chart_id: str) -> None:
        """Bring a chart to the front of the z-order."""
        chart = self._local_charts.get(chart_id)
        if chart is not None:
            chart["zOrder"] = max((c.get("zOrder", 0) for c in self._local_charts.values()), default=0) + 1

    def send_to_back(self, chart_id: str) -> None:
        """Send a chart to the back of the z-order."""
        chart = self._local_charts.get(chart_id)
        if chart is not None:
            chart["zOrder"] = min((c.get("zOrder", 0) for c in self._local_charts.values()), default=0) - 1

    def bring_forward(self, chart_id: str) -> None:
        """Move a chart one step forward in z-order."""
        chart = self._local_charts.get(chart_id)
        if chart is not None:
            chart["zOrder"] = chart.get("zOrder", 0) + 1

    def send_backward(self, chart_id: str) -> None:
        """Move a chart one step backward in z-order."""
        chart = self._local_charts.get(chart_id)
        if chart is not None:
            chart["zOrder"] = chart.get("zOrder", 0) - 1

    # ------------------------------------------------------------------
    # Point formatting
    # ------------------------------------------------------------------

    def format_point(self, chart_id: str, series_index: int, point_index: int, fmt: Dict[str, Any]) -> None:
        """Format a specific data point in a series."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= series_index < len(series_list):
            series = series_list[series_index]
            if "pointFormats" not in series:
                series["pointFormats"] = {}
            series["pointFormats"][str(point_index)] = fmt

    def set_point_data_label(self, chart_id: str, series_index: int, point_index: int, label: Dict[str, Any]) -> None:
        """Set data label for a specific point."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return
        series_list = chart.get("series", [])
        if 0 <= series_index < len(series_list):
            series = series_list[series_index]
            if "pointLabels" not in series:
                series["pointLabels"] = {}
            series["pointLabels"][str(point_index)] = label

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def export_image(self, chart_id: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Export a chart as an image (stub).

        Returns a dict with export result metadata.
        """
        return {"chartId": chart_id, "format": (options or {}).get("format", "png"), "data": None}

    # ------------------------------------------------------------------
    # Table linking
    # ------------------------------------------------------------------

    def is_linked_to_table(self, chart_id: str) -> bool:
        """Check if a chart is linked to a table."""
        chart = self._local_charts.get(chart_id)
        if chart is None:
            return False
        return chart.get("linkedTable") is not None

    def link_to_table(self, chart_id: str, table_id: str) -> None:
        """Link a chart to a table."""
        chart = self._local_charts.get(chart_id)
        if chart is not None:
            chart["linkedTable"] = table_id

    def unlink_from_table(self, chart_id: str) -> None:
        """Unlink a chart from its table."""
        chart = self._local_charts.get(chart_id)
        if chart is not None:
            chart.pop("linkedTable", None)
