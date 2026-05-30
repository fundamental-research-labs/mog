"""Pivot table operations -- ``ws.pivots.add()``, ``ws.pivots.compute()``, etc."""
from __future__ import annotations

import json
import re
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


def _parse_data_source(data_source: str) -> tuple:
    """Parse a data source string like 'Sheet1!A1:D5' into (sheet_name, range).

    Returns (sheet_name, {startRow, startCol, endRow, endCol}).
    """
    if "!" in data_source:
        sheet_name, range_str = data_source.rsplit("!", 1)
        # Strip quotes from sheet name
        sheet_name = sheet_name.strip("'\"")
    else:
        sheet_name = ""
        range_str = data_source

    # Parse A1:D5 style range
    match = re.match(r"([A-Z]+)(\d+):([A-Z]+)(\d+)", range_str.upper())
    if match:
        sc = _col_to_index(match.group(1))
        sr = int(match.group(2)) - 1  # 0-based
        ec = _col_to_index(match.group(3))
        er = int(match.group(4)) - 1  # 0-based
        return sheet_name, {"startRow": sr, "startCol": sc, "endRow": er, "endCol": ec}
    return sheet_name, {"startRow": 0, "startCol": 0, "endRow": 0, "endCol": 0}


def _col_to_index(col_str: str) -> int:
    """Convert column letter(s) to 0-based index (A=0, B=1, ..., Z=25, AA=26)."""
    result = 0
    for ch in col_str.upper():
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result - 1


def _index_to_col(idx: int) -> str:
    """Convert 0-based column index to A1-style letter(s)."""
    result = ""
    c = idx
    while True:
        result = chr(ord("A") + c % 26) + result
        c = c // 26 - 1
        if c < 0:
            break
    return result


def _infer_data_type(value: Any) -> str:
    """Infer data type from a cell value."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string"


class PivotsAPI:
    """Pivot table CRUD and computation operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_pivot_config(self, pivot_id: str) -> Optional[Dict[str, Any]]:
        """Get the full pivot config from the engine (supports name or ID)."""
        try:
            result = self._bridge.call_json(
                "compute_pivot_get", self._sheet_id_json, pivot_id
            )
            if isinstance(result, dict):
                return result
        except Exception:
            pass
        # Fall back to name search
        all_pivots = self.list()
        for p in all_pivots:
            if isinstance(p, dict) and (p.get("name") == pivot_id or p.get("id") == pivot_id):
                return p
        return None

    def _update_pivot(self, pivot_id: str, config: Dict[str, Any]) -> Any:
        """Update a pivot table with a new config dict.

        Resolves pivot_id by name if needed and ensures the config is complete.
        """
        # Resolve the actual internal ID
        actual_id = self._resolve_pivot_id(pivot_id)
        if actual_id is None:
            actual_id = pivot_id

        # Ensure the config has the actual ID
        if "id" not in config:
            config["id"] = actual_id

        return self._bridge.call_json(
            "compute_pivot_update",
            self._sheet_id_json,
            actual_id,
            json.dumps(config),
        )

    def _normalize_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize a simple config format to the wire format.

        Converts simple format (dataSource, rowFields, valueFields, etc.) to
        the full wire format (sourceSheetName, sourceRange, fields, placements, etc.).
        """
        # If it already has sourceSheetName, assume wire format
        if "sourceSheetName" in config:
            return config

        # Simple format: convert dataSource -> sourceSheetName + sourceRange
        if "dataSource" not in config:
            return config

        data_source = config["dataSource"]
        sheet_name, source_range = _parse_data_source(data_source)

        # Read source headers to auto-detect fields
        from mog._bridge import _ensure_json_quoted
        # Resolve the source sheet ID
        sheet_order = self._bridge.get_sheet_order()
        source_sheet_id_json = None
        for sid in sheet_order:
            sid_json = _ensure_json_quoted(sid)
            s_name = self._bridge.get_sheet_name(sid_json)
            if s_name == sheet_name:
                source_sheet_id_json = sid_json
                break

        fields: List[Dict[str, Any]] = []
        if source_sheet_id_json:
            fields = self._detect_fields_from_source_range(
                source_sheet_id_json, source_range
            )

        # Build placements from rowFields, columnFields, valueFields, filterFields
        placements: List[Dict[str, Any]] = []
        position_counters: Dict[str, int] = {"row": 0, "column": 0, "value": 0, "filter": 0}

        for field_name in config.get("rowFields", []):
            field_id = self._field_id_for_ref(field_name, fields)
            placements.append({
                "area": "row",
                "fieldId": field_id,
                "position": position_counters["row"],
            })
            position_counters["row"] += 1

        for field_name in config.get("columnFields", []):
            field_id = self._field_id_for_ref(field_name, fields)
            placements.append({
                "area": "column",
                "fieldId": field_id,
                "position": position_counters["column"],
            })
            position_counters["column"] += 1

        for vf in config.get("valueFields", []):
            if isinstance(vf, dict):
                field_name = vf.get(
                    "fieldId", vf.get("field", vf.get("id", vf.get("name", "")))
                )
                field_id = self._field_id_for_ref(field_name, fields)
                agg = vf.get("aggregation", vf.get("aggregateFunction", "sum"))
                p = {
                    "area": "value",
                    "fieldId": field_id,
                    "position": position_counters["value"],
                    "aggregateFunction": agg,
                }
                label = vf.get("label")
                if label:
                    p["displayName"] = label
                placements.append(p)
            elif isinstance(vf, str):
                field_id = self._field_id_for_ref(vf, fields)
                placements.append({
                    "area": "value",
                    "fieldId": field_id,
                    "position": position_counters["value"],
                    "aggregateFunction": "sum",
                })
            position_counters["value"] += 1

        for field_name in config.get("filterFields", []):
            field_id = self._field_id_for_ref(field_name, fields)
            placements.append({
                "area": "filter",
                "fieldId": field_id,
                "position": position_counters["filter"],
            })
            position_counters["filter"] += 1

        # Get the output sheet name - use the current sheet name if not specified
        output_sheet_name = config.get("outputSheetName", sheet_name)

        return {
            "id": config.get("id", uuid.uuid4().hex),
            "name": config.get("name", "Pivot"),
            "sourceSheetName": sheet_name,
            "sourceRange": source_range,
            "outputSheetName": output_sheet_name,
            "outputLocation": config.get("outputLocation", {"row": 0, "col": 0}),
            "fields": fields,
            "placements": placements,
            "filters": config.get("filters", []),
            "layout": config.get("layout"),
            "style": config.get("style"),
        }

    def _detect_fields_from_source_range(
        self, sheet_id_json: str, source_range: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Detect pivot field metadata for a source range using native logic when available."""
        sr = source_range.get("startRow", 0)
        sc = source_range.get("startCol", 0)
        er = source_range.get("endRow", sr)
        ec = source_range.get("endCol", sc)
        values = self._bridge.call_json(
            "compute_get_range_values_2d", sheet_id_json, sr, sc, er, ec
        )
        if not isinstance(values, list):
            values = []
        return self._detect_fields_from_values(values)

    @staticmethod
    def _detect_fields_from_values(values: List[Any]) -> List[Dict[str, Any]]:
        """Return PivotField-shaped dicts, preserving duplicate names with stable IDs."""
        from mog import _native

        detect = getattr(_native, "pivot_detect_fields", None)
        if detect is not None:
            native = detect(json.dumps(values))
            if isinstance(native, str):
                native = json.loads(native)
            fields = PivotsAPI._normalize_detected_fields(native)
            if fields:
                return fields
        return PivotsAPI._fallback_detect_fields_from_values(values)

    @staticmethod
    def _normalize_detected_fields(raw: Any) -> List[Dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        fields: List[Dict[str, Any]] = []
        for i, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if name is None or name == "":
                name = f"Column {i + 1}"
            source_column = item.get("sourceColumn", item.get("source_column", i))
            field_id = item.get("id") or f"field_{source_column}"
            data_type = item.get("dataType", item.get("data_type", "string"))
            fields.append({
                "id": str(field_id),
                "name": str(name),
                "sourceColumn": int(source_column),
                "dataType": str(data_type),
            })
        return fields

    @staticmethod
    def _fallback_detect_fields_from_values(values: List[Any]) -> List[Dict[str, Any]]:
        if not values:
            return []
        header_row = values[0] if isinstance(values[0], list) else values
        data_rows = values[1:] if isinstance(values[0], list) else []
        fields: List[Dict[str, Any]] = []
        for i, hval in enumerate(header_row):
            name = PivotsAPI._cell_scalar(hval)
            if name is None or name == "":
                name = f"Column {i + 1}"

            data_type = "string"
            for row in data_rows:
                if isinstance(row, list) and i < len(row):
                    dval = PivotsAPI._cell_scalar(row[i])
                    if dval is not None and dval != "":
                        data_type = _infer_data_type(dval)
                        break

            fields.append({
                "id": f"field_{i}",
                "name": str(name),
                "sourceColumn": i,
                "dataType": data_type,
            })
        return fields

    @staticmethod
    def _cell_scalar(value: Any) -> Any:
        if isinstance(value, dict):
            if "value" in value:
                return value.get("value")
            if "formattedValue" in value:
                return value.get("formattedValue")
            return ""
        return value

    @staticmethod
    def _field_id_for_ref(field_ref: Any, fields: List[Dict[str, Any]]) -> str:
        if isinstance(field_ref, dict):
            field_ref = field_ref.get(
                "fieldId",
                field_ref.get("id", field_ref.get("field", field_ref.get("name", ""))),
            )
        field_ref_str = str(field_ref)
        for field in fields:
            if isinstance(field, dict) and field.get("id") == field_ref_str:
                return field_ref_str
        for field in fields:
            if isinstance(field, dict) and field.get("name") == field_ref_str:
                return str(field.get("id", field_ref_str))
        return field_ref_str

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add(self, config: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Any:
        """Create a new pivot table.

        Supports three config formats:
        1. Simple dict: ``add({name, dataSource, rowFields, valueFields, ...})``
        2. Wire dict: ``add({name, sourceSheetName, sourceRange, fields, placements, ...})``
        3. Keyword args: ``add(name="...", source_sheet_name="...", ...)``

        Returns the created pivot config (from the ``data`` field of the mutation result).
        """
        if config is None:
            config = {}
        merged = dict(config)
        # Map snake_case keyword args to camelCase
        _snake_to_camel = {
            "source_sheet_name": "sourceSheetName",
            "source_range": "sourceRange",
            "output_sheet_name": "outputSheetName",
            "output_location": "outputLocation",
            "data_source": "dataSource",
            "row_fields": "rowFields",
            "column_fields": "columnFields",
            "value_fields": "valueFields",
            "filter_fields": "filterFields",
        }
        for k, v in kwargs.items():
            camel = _snake_to_camel.get(k, k)
            merged[camel] = v
        if "id" not in merged:
            merged["id"] = uuid.uuid4().hex

        # Normalize simple config to wire format
        merged = self._normalize_config(merged)

        raw = self._bridge.call_json(
            "compute_pivot_create",
            json.dumps(merged),
        )
        # Extract the config from the mutation result's data field
        if isinstance(raw, dict) and "data" in raw:
            return self._enrich_pivot(raw["data"]) if isinstance(raw["data"], dict) else raw["data"]
        # If creation succeeded but no data, return the merged config itself
        if raw is not None:
            return self._enrich_pivot(merged)
        return merged

    def create(self, config: Dict[str, Any], **kwargs: Any) -> MutationResult:
        """Create a new pivot table (legacy alias for ``add``)."""
        merged = dict(config)
        merged.update(kwargs)
        if "id" not in merged:
            merged["id"] = uuid.uuid4().hex
        merged = self._normalize_config(merged)
        raw = self._bridge.call_json(
            "compute_pivot_create",
            json.dumps(merged),
        )
        return deserialize_mutation_result(raw)

    def _resolve_pivot_id(self, name_or_id: str) -> Optional[str]:
        """Resolve a pivot name or ID to the internal pivot ID."""
        # Try direct ID lookup first
        try:
            result = self._bridge.call_json(
                "compute_pivot_get", self._sheet_id_json, name_or_id
            )
            if isinstance(result, dict):
                return result.get("id", name_or_id)
        except Exception:
            pass
        # Fall back to name search
        all_pivots = self.list()
        for p in all_pivots:
            if isinstance(p, dict):
                if p.get("name") == name_or_id or p.get("id") == name_or_id:
                    return p.get("id")
        return None

    def get(self, name_or_id: str) -> Optional[Dict[str, Any]]:
        """Get a pivot table by name or ID.

        Returns ``None`` if not found.
        """
        # Try direct ID lookup first
        try:
            result = self._bridge.call_json(
                "compute_pivot_get", self._sheet_id_json, name_or_id
            )
            if isinstance(result, dict):
                return self._enrich_pivot(result)
        except Exception:
            pass
        # Fall back to name search
        all_pivots = self.list()  # already enriched
        for p in all_pivots:
            if isinstance(p, dict) and (p.get("name") == name_or_id or p.get("id") == name_or_id):
                return p
        return None

    def remove(self, name_or_id: str) -> MutationResult:
        """Remove a pivot table by name or ID."""
        actual_id = self._resolve_pivot_id(name_or_id)
        if actual_id is None:
            actual_id = name_or_id
        raw = self._bridge.call_json(
            "compute_pivot_delete", self._sheet_id_json, actual_id
        )
        return deserialize_mutation_result(raw)

    def delete(self, pivot_id: str) -> MutationResult:
        """Delete a pivot table by ID (legacy alias for ``remove``)."""
        return self.remove(pivot_id)

    def list(self) -> List[Dict[str, Any]]:
        """Get all pivot tables in this sheet.

        Enriches each pivot config with convenience fields:
        ``rowFields``, ``columnFields``, ``valueFields``, ``dataSource``, ``location``.
        """
        result = self._bridge.call_json(
            "compute_pivot_get_all", self._sheet_id_json
        )
        if isinstance(result, list):
            return [self._enrich_pivot(p) for p in result if isinstance(p, dict)]
        return []

    @staticmethod
    def _enrich_pivot(p: Dict[str, Any]) -> Dict[str, Any]:
        """Add convenience fields to a wire-format pivot config."""
        if not isinstance(p, dict):
            return p
        enriched = dict(p)
        placements = p.get("placements", [])
        if isinstance(placements, list):
            row_fields = [
                pl.get("fieldId") for pl in placements
                if isinstance(pl, dict) and pl.get("area") == "row"
            ]
            col_fields = [
                pl.get("fieldId") for pl in placements
                if isinstance(pl, dict) and pl.get("area") == "column"
            ]
            val_fields = []
            for pl in placements:
                if isinstance(pl, dict) and pl.get("area") == "value":
                    val_fields.append({
                        "field": pl.get("fieldId"),
                        "aggregation": pl.get("aggregateFunction", "sum"),
                    })
            enriched["rowFields"] = row_fields
            enriched["columnFields"] = col_fields
            enriched["valueFields"] = val_fields
        else:
            enriched.setdefault("rowFields", [])
            enriched.setdefault("columnFields", [])
            enriched.setdefault("valueFields", [])

        # dataSource
        src_sheet = p.get("sourceSheetName", "")
        src_range = p.get("sourceRange")
        if src_sheet and isinstance(src_range, dict):
            sc = src_range.get("startCol", 0)
            sr = src_range.get("startRow", 0)
            ec = src_range.get("endCol", 0)
            er = src_range.get("endRow", 0)
            enriched["dataSource"] = f"{src_sheet}!{_index_to_col(sc)}{sr+1}:{_index_to_col(ec)}{er+1}"
        elif "dataSource" not in enriched:
            enriched["dataSource"] = ""

        # location
        out_sheet = p.get("outputSheetName", "")
        out_loc = p.get("outputLocation", {})
        if isinstance(out_loc, dict):
            r = out_loc.get("row", 0)
            c = out_loc.get("col", 0)
            enriched["location"] = f"{out_sheet}!{_index_to_col(c)}{r+1}" if out_sheet else f"{_index_to_col(c)}{r+1}"
        elif "location" not in enriched:
            enriched["location"] = ""

        return enriched

    # ------------------------------------------------------------------
    # Field management
    # ------------------------------------------------------------------

    def add_field(
        self,
        pivot_id: str,
        field_name: str,
        area: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Add a field to a pivot area (row, column, value, filter).

        Uses compute_pivot_update to merge the new field placement.
        """
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}

        # Ensure fields list has an entry for this field
        fields = config.get("fields", [])
        if isinstance(fields, list):
            field_ids = set()
            for f in fields:
                if isinstance(f, dict):
                    field_ids.add(f.get("id", ""))
            if field_name not in field_ids:
                # Auto-detect source column by reading headers from source data
                source_col = len(fields)  # fallback
                src_range = config.get("sourceRange")
                src_sheet = config.get("sourceSheetName", "")
                if isinstance(src_range, dict) and src_sheet:
                    try:
                        from mog._bridge import _ensure_json_quoted
                        src_sid_json = None
                        for sid in self._bridge.get_sheet_order():
                            sid_json = _ensure_json_quoted(sid)
                            try:
                                sn = self._bridge.get_sheet_name(sid_json)
                                if sn == src_sheet:
                                    src_sid_json = sid_json
                                    break
                            except Exception:
                                pass
                        if src_sid_json:
                            sr = src_range.get("startRow", 0)
                            sc = src_range.get("startCol", 0)
                            ec = src_range.get("endCol", sc)
                            header_values = self._bridge.call_json(
                                "compute_get_range_values_2d",
                                src_sid_json, sr, sc, sr, ec,
                            )
                            if isinstance(header_values, list) and len(header_values) > 0:
                                header_row = header_values[0] if isinstance(header_values[0], list) else header_values
                                for ci, hval in enumerate(header_row):
                                    name = ""
                                    if isinstance(hval, dict):
                                        name = str(hval.get("value", hval.get("formattedValue", "")))
                                    elif hval is not None:
                                        name = str(hval)
                                    if name == field_name:
                                        source_col = ci
                                        break
                    except Exception:
                        pass  # keep fallback
                fields.append({
                    "id": field_name,
                    "name": field_name,
                    "sourceColumn": source_col,
                    "dataType": "string",
                })
            config["fields"] = fields

        # Add the placement
        placements = config.get("placements", [])
        if not isinstance(placements, list):
            placements = []

        # Count existing placements in this area to determine position
        area_count = sum(
            1 for p in placements
            if isinstance(p, dict) and p.get("area") == area
        )

        placement: Dict[str, Any] = {
            "area": area,
            "fieldId": field_name,
            "position": area_count,
        }

        # Value placements require aggregateFunction
        if area == "value":
            agg = "sum"
            if options and "aggregation" in options:
                agg = options["aggregation"]
            elif options and "aggregateFunction" in options:
                agg = options["aggregateFunction"]
            placement["aggregateFunction"] = agg

        if options:
            for k, v in options.items():
                if k not in ("aggregation",):
                    placement[k] = v

        placements.append(placement)
        config["placements"] = placements

        return self._update_pivot(pivot_id, config)

    def remove_field(self, pivot_id: str, field_name: str, area: str) -> Any:
        """Remove a field from a pivot area.

        Uses compute_pivot_update to remove the field placement.
        """
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}

        placements = config.get("placements", [])
        if isinstance(placements, list):
            config["placements"] = [
                p for p in placements
                if not (isinstance(p, dict) and p.get("fieldId") == field_name and p.get("area") == area)
            ]

        return self._update_pivot(pivot_id, config)

    def move_field(
        self,
        pivot_id: str,
        field_name: str,
        from_area: str,
        to_area: str,
        index: int = 0,
    ) -> Any:
        """Move a field from one area to another."""
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}

        placements = config.get("placements", [])
        if isinstance(placements, list):
            # Remove from old area
            placements = [
                p for p in placements
                if not (isinstance(p, dict) and p.get("fieldId") == field_name and p.get("area") == from_area)
            ]
            # Add to new area
            new_placement: Dict[str, Any] = {
                "area": to_area,
                "fieldId": field_name,
                "position": index,
            }
            if to_area == "value":
                new_placement["aggregateFunction"] = "sum"
            placements.append(new_placement)
            config["placements"] = placements

        return self._update_pivot(pivot_id, config)

    def set_aggregate_function(
        self, pivot_id: str, field_name: str, function: str
    ) -> Any:
        """Set the aggregation function for a value field."""
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}

        placements = config.get("placements", [])
        if isinstance(placements, list):
            for p in placements:
                if isinstance(p, dict) and p.get("fieldId") == field_name and p.get("area") == "value":
                    p["aggregateFunction"] = function

        return self._update_pivot(pivot_id, config)

    def detect_fields(
        self, sheet_id: str, source_range: Dict[str, Any]
    ) -> Any:
        """Auto-detect pivot fields from source data headers.

        Reads the source range and returns PivotField metadata dicts. Duplicate
        header names keep distinct stable field IDs (``field_0``, ``field_1``, ...).
        """
        from mog._bridge import _ensure_json_quoted

        sid_json = _ensure_json_quoted(sheet_id)
        return self._detect_fields_from_source_range(sid_json, source_range)

    # ------------------------------------------------------------------
    # Calculated fields
    # ------------------------------------------------------------------

    def add_calculated_field(
        self, pivot_id: str, config: Dict[str, Any]
    ) -> Any:
        """Add a calculated field to a pivot table."""
        pivot_config = self._get_pivot_config(pivot_id)
        if pivot_config is None:
            pivot_config = {}

        calc_fields = pivot_config.get("calculatedFields", [])
        if calc_fields is None:
            calc_fields = []
        if not isinstance(calc_fields, list):
            calc_fields = []

        # Ensure the calculated field has required fields
        cf = dict(config)
        if "fieldId" not in cf:
            cf["fieldId"] = cf.get("name", uuid.uuid4().hex)
        calc_fields.append(cf)
        pivot_config["calculatedFields"] = calc_fields

        return self._update_pivot(pivot_id, pivot_config)

    def remove_calculated_field(self, pivot_id: str, field_name: str) -> Any:
        """Remove a calculated field from a pivot table."""
        pivot_config = self._get_pivot_config(pivot_id)
        if pivot_config is None:
            pivot_config = {}

        calc_fields = pivot_config.get("calculatedFields")
        if isinstance(calc_fields, list):
            pivot_config["calculatedFields"] = [
                f for f in calc_fields
                if not (isinstance(f, dict) and (f.get("name") == field_name or f.get("fieldId") == field_name))
            ]

        return self._update_pivot(pivot_id, pivot_config)

    def update_calculated_field(
        self, pivot_id: str, field_name: str, updates: Dict[str, Any]
    ) -> Any:
        """Update a calculated field's name or formula."""
        pivot_config = self._get_pivot_config(pivot_id)
        if pivot_config is None:
            pivot_config = {}

        calc_fields = pivot_config.get("calculatedFields")
        if isinstance(calc_fields, list):
            for f in calc_fields:
                if isinstance(f, dict) and (f.get("name") == field_name or f.get("fieldId") == field_name):
                    f.update(updates)

        return self._update_pivot(pivot_id, pivot_config)

    # ------------------------------------------------------------------
    # Computation & refresh
    # ------------------------------------------------------------------

    def compute(self, pivot_id: str) -> Any:
        """Compute the pivot table and return the result data.

        Also triggers materialization (writing computed values to output cells).
        """
        result = self._bridge.call_json(
            "compute_pivot_compute_from_source",
            self._sheet_id_json,
            pivot_id,
            json.dumps({}),
        )
        # Try engine-level materialization first
        materialized = False
        try:
            self._bridge.call_json(
                "compute_pivot_materialize",
                self._sheet_id_json,
                pivot_id,
                json.dumps({}),
            )
            materialized = True
        except Exception:
            pass
        # Fallback: Python-side materialization (best-effort, never raises)
        if not materialized and isinstance(result, dict):
            try:
                self._materialize_to_cells(pivot_id, result)
            except Exception:
                pass
        return result

    def refresh(self, pivot_id: str) -> Any:
        """Refresh the pivot table from source data."""
        return self.compute(pivot_id)

    def _materialize_to_cells(self, pivot_id: str, result: Dict[str, Any]) -> None:
        """Write pivot computation results to the output cells on the sheet.

        Reads the pivot config to determine the output location, then
        writes headers and data rows into the sheet cells.
        """
        config = self._get_pivot_config(pivot_id)
        if config is None:
            return
        out_loc = config.get("outputLocation", {})
        if not isinstance(out_loc, dict):
            return
        start_row = out_loc.get("row", 0)
        start_col = out_loc.get("col", 0)

        # Determine output sheet -- may differ from the pivot's own sheet
        out_sheet_name = config.get("outputSheetName", "")
        out_sid_json = self._sheet_id_json  # default to current sheet
        if out_sheet_name:
            from mog._bridge import _ensure_json_quoted
            for sid in self._bridge.get_sheet_order():
                sid_json = _ensure_json_quoted(sid)
                try:
                    name = self._bridge.get_sheet_name(sid_json)
                    if name == out_sheet_name:
                        out_sid_json = sid_json
                        break
                except Exception:
                    pass

        rows = result.get("rows", [])
        col_headers = result.get("columnHeaders", [])
        grand_totals = result.get("grandTotals")

        # Collect row field names and value field names from config
        row_fields = config.get("rowFields", [])
        if not row_fields:
            placements = config.get("placements", [])
            row_fields = [
                p.get("fieldId", "")
                for p in (placements if isinstance(placements, list) else [])
                if isinstance(p, dict) and p.get("area") == "row"
            ]
        val_fields = config.get("valueFields", [])
        if not val_fields:
            placements = config.get("placements", [])
            val_fields = [
                {"field": p.get("fieldId", ""), "aggregation": p.get("aggregateFunction", "sum")}
                for p in (placements if isinstance(placements, list) else [])
                if isinstance(p, dict) and p.get("area") == "value"
            ]

        updates: list = []
        cur_row = start_row

        # -- Write header row --
        c = start_col
        for rf in row_fields:
            name = rf if isinstance(rf, str) else rf.get("field", "")
            updates.append((cur_row, c, name))
            c += 1

        # Column headers
        if col_headers:
            # Multi-level column headers: just write first level values
            for level in col_headers:
                if isinstance(level, dict):
                    for h in level.get("headers", []):
                        hval = h.get("value") if isinstance(h, dict) else h
                        span = h.get("span", 1) if isinstance(h, dict) else 1
                        for _ in range(span):
                            updates.append((cur_row, c, hval))
                            c += 1
        else:
            # No column fields -- write value field headers
            for vf in val_fields:
                if isinstance(vf, dict):
                    field = vf.get("field", "")
                    agg = vf.get("aggregation", "sum")
                    label = f"Sum of {field}" if agg == "sum" else f"{agg} of {field}"
                else:
                    label = str(vf)
                updates.append((cur_row, c, label))
                c += 1

        cur_row += 1

        # -- Write data rows --
        for row_data in rows:
            if not isinstance(row_data, dict):
                continue
            c = start_col
            headers = row_data.get("headers", [])
            values = row_data.get("values", [])
            is_grand = row_data.get("isGrandTotal", False)
            is_sub = row_data.get("isSubtotal", False)

            if is_grand:
                updates.append((cur_row, c, "Grand Total"))
                c += 1
            else:
                for h in headers:
                    hval = h.get("value") if isinstance(h, dict) else h
                    updates.append((cur_row, c, hval))
                    c += 1

            for v in values:
                updates.append((cur_row, c, v))
                c += 1

            cur_row += 1

        # -- Write grand totals if separate --
        if grand_totals and not any(
            isinstance(r, dict) and r.get("isGrandTotal") for r in rows
        ):
            c = start_col
            updates.append((cur_row, c, "Grand Total"))
            c += 1
            if isinstance(grand_totals, list):
                for v in grand_totals:
                    updates.append((cur_row, c, v))
                    c += 1
            elif isinstance(grand_totals, dict):
                for v in grand_totals.values():
                    updates.append((cur_row, c, v))
                    c += 1

        # Batch-write all updates (values must be strings for set_cell_values_parsed)
        if updates:
            str_updates = [
                (r, c, str(v) if v is not None else "")
                for r, c, v in updates
            ]
            self._bridge.set_cell_values_parsed(
                out_sid_json, json.dumps(str_updates)
            )

    # ------------------------------------------------------------------
    # Querying
    # ------------------------------------------------------------------

    def query_pivot(
        self, name: str, filters: Optional[Dict[str, Any]] = None
    ) -> Any:
        """Query a pivot table with optional dimension filters.

        Returns a dict with ``pivotName``, ``rowFields``, ``columnFields``,
        ``valueFields``, and ``records`` -- a list of flat record dicts
        with ``dimensions`` and ``values`` keys.

        If the pivot is not found on this sheet, returns an error dict
        instead of None.
        """
        pivot = self.get(name)
        if pivot is None:
            return {"error": f"Pivot '{name}' not found on this sheet"}
        pivot_id = pivot.get("id", name)
        raw = self.compute(pivot_id)

        # Build structured result
        row_fields = pivot.get("rowFields", [])
        col_fields = pivot.get("columnFields", [])
        val_fields = pivot.get("valueFields", [])

        records: List[Dict[str, Any]] = []

        if isinstance(raw, dict):
            rows = raw.get("rows", [])
            col_headers = raw.get("columnHeaders", [])

            # Extract column header values
            col_header_values: List[str] = []
            for level in col_headers:
                if isinstance(level, dict):
                    for h in level.get("headers", []):
                        val = h.get("value") if isinstance(h, dict) else h
                        span = h.get("span", 1) if isinstance(h, dict) else 1
                        for _ in range(span):
                            col_header_values.append(str(val) if val is not None else "")

            for row in rows:
                if not isinstance(row, dict):
                    continue
                if row.get("isSubtotal") or row.get("isGrandTotal"):
                    continue
                headers = row.get("headers", [])
                values = row.get("values", [])

                # Build dimensions from row headers
                row_dims: Dict[str, Any] = {}
                for i, h in enumerate(headers):
                    hval = h.get("value") if isinstance(h, dict) else h
                    if i < len(row_fields):
                        row_dims[row_fields[i]] = hval

                # Apply filters on row dimensions
                if filters:
                    skip = False
                    for fk, fv in filters.items():
                        if fk in row_dims and str(row_dims[fk]) != str(fv):
                            skip = True
                            break
                    if skip:
                        continue

                # If there are column fields, expand each column into a separate record
                if col_header_values and col_fields:
                    for vi, v in enumerate(values):
                        dims = dict(row_dims)
                        if vi < len(col_header_values) and col_header_values[vi]:
                            for ci, cf in enumerate(col_fields):
                                dims[cf] = col_header_values[vi]

                        # Apply column-dimension filters
                        if filters:
                            skip = False
                            for fk, fv in filters.items():
                                if fk in dims and fk not in row_dims and str(dims[fk]) != str(fv):
                                    skip = True
                                    break
                            if skip:
                                continue

                        vals: Dict[str, Any] = {}
                        if len(val_fields) >= 1:
                            vf = val_fields[0]
                            key = vf.get("field", "") if isinstance(vf, dict) else str(vf)
                        else:
                            key = f"value_{vi}"
                        vals[key] = v
                        records.append({"dimensions": dims, "values": vals})
                else:
                    # No column fields -- single record per row
                    vals = {}
                    for vi, v in enumerate(values):
                        if len(val_fields) == 1:
                            vf = val_fields[0]
                            key = vf.get("field", "") if isinstance(vf, dict) else str(vf)
                        else:
                            key = f"value_{vi}"
                        vals[key] = v
                    records.append({"dimensions": row_dims, "values": vals})

        return {
            "pivotName": pivot.get("name", name),
            "rowFields": row_fields,
            "columnFields": col_fields,
            "valueFields": val_fields,
            "records": records,
        }

    # ------------------------------------------------------------------
    # Range queries
    # ------------------------------------------------------------------

    def get_range(self, pivot_id: str) -> Any:
        """Get the full range of the pivot table."""
        config = self._get_pivot_config(pivot_id)
        if config is None:
            return None
        output = config.get("outputLocation", {})
        return {
            "startRow": output.get("row", 0),
            "startCol": output.get("col", 0),
            "pivotId": pivot_id,
        }

    def get_data_body_range(self, pivot_id: str) -> Any:
        return self.get_range(pivot_id)

    def get_column_label_range(self, pivot_id: str) -> Any:
        return self.get_range(pivot_id)

    def get_row_label_range(self, pivot_id: str) -> Any:
        return self.get_range(pivot_id)

    def get_filter_axis_range(self, pivot_id: str) -> Any:
        return self.get_range(pivot_id)

    # ------------------------------------------------------------------
    # Expansion state
    # ------------------------------------------------------------------

    def get_expansion_state(self, pivot_id: str) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            return {}
        return config.get("expansionState", {})

    def set_all_expanded(self, pivot_id: str, expanded: bool) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        config["expansionState"] = {"allExpanded": expanded}
        return self._update_pivot(pivot_id, config)

    def toggle_expanded(
        self, pivot_id: str, header_value: str, expanded: bool
    ) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        exp_state = config.get("expansionState", {})
        if not isinstance(exp_state, dict):
            exp_state = {}
        items = exp_state.get("items", {})
        if not isinstance(items, dict):
            items = {}
        items[header_value] = expanded
        exp_state["items"] = items
        config["expansionState"] = exp_state
        return self._update_pivot(pivot_id, config)

    # ------------------------------------------------------------------
    # Sort, filter, layout, style
    # ------------------------------------------------------------------

    def set_sort_order(self, pivot_id: str, field_name: str, order: str) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        # Update sort order in the field's placement
        placements = config.get("placements", [])
        if isinstance(placements, list):
            for p in placements:
                if isinstance(p, dict) and p.get("fieldId") == field_name:
                    p["sortOrder"] = order
        return self._update_pivot(pivot_id, config)

    def set_filter(
        self, pivot_id: str, field_name: str, filter_config: Dict[str, Any]
    ) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        piv_filters = config.get("filters", [])
        if not isinstance(piv_filters, list):
            piv_filters = []
        piv_filters = [
            f for f in piv_filters
            if not (isinstance(f, dict) and f.get("fieldId") == field_name)
        ]
        piv_filters.append({"fieldId": field_name, **filter_config})
        config["filters"] = piv_filters
        return self._update_pivot(pivot_id, config)

    def remove_filter(self, pivot_id: str, field_name: str) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        piv_filters = config.get("filters", [])
        if isinstance(piv_filters, list):
            config["filters"] = [
                f for f in piv_filters
                if not (isinstance(f, dict) and f.get("fieldId") == field_name)
            ]
        return self._update_pivot(pivot_id, config)

    def set_layout(self, pivot_id: str, layout: Dict[str, Any]) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        existing_layout = config.get("layout")
        if isinstance(existing_layout, dict):
            existing_layout.update(layout)
        else:
            existing_layout = layout
        config["layout"] = existing_layout
        return self._update_pivot(pivot_id, config)

    def set_style(self, pivot_id: str, style: Dict[str, Any]) -> Any:
        config = self._get_pivot_config(pivot_id)
        if config is None:
            config = {}
        existing_style = config.get("style")
        if isinstance(existing_style, dict):
            existing_style.update(style)
        else:
            existing_style = style
        config["style"] = existing_style
        return self._update_pivot(pivot_id, config)

    # ------------------------------------------------------------------
    # Add with sheet
    # ------------------------------------------------------------------

    def add_with_sheet(
        self, sheet_name: str, config: Dict[str, Any]
    ) -> Any:
        """Create a pivot table on a new sheet.

        Uses compute_pivot_create_with_sheet(sheet_name, config).
        Returns a dict with ``sheetId`` and ``config``.
        """
        merged = dict(config)
        if "id" not in merged:
            merged["id"] = uuid.uuid4().hex
        merged = self._normalize_config(merged)
        raw = self._bridge.call_json(
            "compute_pivot_create_with_sheet",
            sheet_name,
            json.dumps(merged),
        )
        # The engine returns [sheetId_hex, PivotTableConfig]
        if isinstance(raw, (list, tuple)) and len(raw) == 2:
            return {"sheetId": raw[0], "config": raw[1]}
        return raw

    # ------------------------------------------------------------------
    # Drill-down
    # ------------------------------------------------------------------

    def get_drill_down_data(
        self, pivot_id: str, row_header: str, col_header: str
    ) -> Any:
        """Get drill-down data for a specific pivot cell.

        Returns a list of source records that contribute to the given cell,
        or the compute result if drill-down is not available.
        """
        try:
            result = self.compute(pivot_id)
        except Exception:
            result = None
        if isinstance(result, dict):
            result["drillDown"] = {
                "rowHeader": row_header,
                "colHeader": col_header,
            }
        return result
