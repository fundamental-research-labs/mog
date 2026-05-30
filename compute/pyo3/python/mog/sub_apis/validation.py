"""Data validation operations -- ``ws.validation.set()``, ``ws.validation.get()``, etc."""
from __future__ import annotations

import json
import time
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple, Union

from mog._serde import deserialize_mutation_result, parse_a1, parse_range
from mog._unsupported import unsupported_api
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


_VALIDATION_TYPE_MAP: Dict[str, Optional[str]] = {
    "list": None,  # list validation has no schema type; behavior is in constraints
    "wholeNumber": "integer",
    "decimal": "number",
    "date": "date",
    "time": "time",
    "textLength": None,
    "custom": None,
    "none": None,
}


def _rule_to_engine_schema(
    rule: Dict[str, Any],
    start_row: int,
    start_col: int,
    end_row: int,
    end_col: int,
) -> Dict[str, Any]:
    """Convert a user-friendly validation rule to the engine's RangeSchema format."""
    rule_type = rule.get("type", "")
    schema_type = _VALIDATION_TYPE_MAP.get(rule_type, rule_type)
    constraints: Dict[str, Any] = {}

    if rule_type == "list":
        values = rule.get("values", [])
        if values:
            constraints["enum"] = values

    schema_inner: Dict[str, Any] = {"constraints": constraints}
    if schema_type is not None:
        schema_inner["type"] = schema_type

    return {
        "id": rule.get("id", f"rs-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"),
        "createdAt": int(time.time() * 1000),
        "ranges": [
            {
                "startId": f"{start_row}:{start_col}",
                "endId": f"{end_row}:{end_col}",
            }
        ],
        "schema": schema_inner,
        "enforcement": "strict",
        "ui": {
            **({"showDropdown": rule["showDropdown"]} if "showDropdown" in rule else {}),
        },
    }


class ValidationAPI:
    """Data validation (range schema) operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_local_rules")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        # Local mirror: address string -> rule dict
        self._local_rules: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def _resolve_range(
        range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> Tuple[int, int, int, int]:
        if isinstance(range_ref, tuple):
            return range_ref
        return parse_range(range_ref)

    @staticmethod
    def _resolve_address(
        address: Union[str, Tuple[int, int]],
    ) -> Tuple[int, int]:
        if isinstance(address, tuple):
            return address
        return parse_a1(address)

    @staticmethod
    def _addr_key(row: int, col: int) -> str:
        """Build an A1-style key from row, col."""
        c = col
        letters = ""
        while True:
            letters = chr(ord("A") + c % 26) + letters
            c = c // 26 - 1
            if c < 0:
                break
        return f"{letters}{row + 1}"

    # ------------------------------------------------------------------
    # set / get / remove / list / clear  (cell-level convenience)
    # ------------------------------------------------------------------

    def set(
        self,
        address: Union[str, Tuple[int, int]],
        rule: Dict[str, Any],
    ) -> None:
        """Set a validation rule on a single cell.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        rule:
            Validation rule dict (type, operator, values, etc.).
        """
        row, col = self._resolve_address(address)
        key = self._addr_key(row, col)
        stored = dict(rule, address=key, row=row, col=col)
        # Push to the engine using proper RangeSchema format
        engine_schema = _rule_to_engine_schema(rule, row, col, row, col)
        stored["_schema_id"] = engine_schema["id"]
        self._local_rules[key] = stored
        try:
            self._bridge.call_json(
                "compute_set_range_schema",
                self._sheet_id_json,
                json.dumps(engine_schema),
            )
        except Exception:
            pass

    def get(
        self,
        address: Union[str, Tuple[int, int]],
    ) -> Optional[Dict[str, Any]]:
        """Get the validation rule for a single cell.

        Returns ``None`` if no validation is set.  Queries the engine
        first so that undo/redo is properly reflected.
        """
        row, col = self._resolve_address(address)
        key = self._addr_key(row, col)
        # Check if the local rule's engine schema still exists (handles undo)
        local_rule = self._local_rules.get(key)
        if local_rule and local_rule.get("_schema_id"):
            schema_id = local_rule["_schema_id"]
            try:
                result = self._bridge.call_json(
                    "compute_get_range_schema",
                    self._sheet_id_json,
                    schema_id,
                )
                if isinstance(result, dict) and result.get("id"):
                    return local_rule
                # Schema was removed (e.g., by undo) -- clear local entry
                del self._local_rules[key]
                return None
            except Exception:
                pass
        # Also check all engine schemas for this cell position
        try:
            schemas = self._bridge.call_json(
                "compute_get_range_schemas_for_sheet",
                self._sheet_id_json,
            )
            if isinstance(schemas, list):
                for schema in schemas:
                    if not isinstance(schema, dict):
                        continue
                    for rng in schema.get("ranges", []):
                        if not isinstance(rng, dict):
                            continue
                        start_parts = str(rng.get("startId", "")).split(":")
                        end_parts = str(rng.get("endId", "")).split(":")
                        if len(start_parts) == 2 and len(end_parts) == 2:
                            sr, sc = int(start_parts[0]), int(start_parts[1])
                            er, ec = int(end_parts[0]), int(end_parts[1])
                            if sr <= row <= er and sc <= col <= ec:
                                # Found a matching schema
                                return local_rule if local_rule else schema
                # No engine schema covers this cell
                if key in self._local_rules:
                    del self._local_rules[key]
                return None
        except Exception:
            pass
        return local_rule

    def remove(
        self,
        address: Union[str, Tuple[int, int]],
    ) -> None:
        """Remove the validation rule from a single cell."""
        row, col = self._resolve_address(address)
        key = self._addr_key(row, col)
        local_rule = self._local_rules.pop(key, None)
        # Also remove from engine
        if local_rule and local_rule.get("_schema_id"):
            try:
                self._bridge.call_json(
                    "compute_delete_range_schema",
                    self._sheet_id_json,
                    local_rule["_schema_id"],
                )
            except Exception:
                pass

    def list(self) -> List[Dict[str, Any]]:
        """Return all validation rules on this sheet."""
        return list(self._local_rules.values())

    def clear(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> None:
        """Remove all validation rules within a range."""
        sr, sc, er, ec = self._resolve_range(range_ref)
        to_remove = []
        for key, rule in self._local_rules.items():
            r = rule.get("row", -1)
            c = rule.get("col", -1)
            if sr <= r <= er and sc <= c <= ec:
                to_remove.append(key)
        for key in to_remove:
            self._local_rules.pop(key, None)

    def get_dropdown_items(
        self,
        address: Union[str, Tuple[int, int]],
    ) -> Optional[List[str]]:
        """Get dropdown items for a list validation.

        Returns ``None`` if the cell has no list validation.
        """
        rule = self.get(address)
        if rule is None:
            return None
        if rule.get("type") == "list":
            return rule.get("values", [])
        return None

    def get_errors_in_range(
        self,
        sr: int,
        sc: int,
        er: int,
        ec: int,
    ) -> List[Dict[str, Any]]:
        """Find validation errors in a range."""
        unsupported_api("ws.validations.getErrorsInRange", "ws.validation.get_errors_in_range")

    # ------------------------------------------------------------------
    # Schema-level API (original methods)
    # ------------------------------------------------------------------

    def set_schema(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
        schema: Dict[str, Any],
    ) -> MutationResult:
        """Set a data validation schema on a range.

        Parameters
        ----------
        range_ref:
            A1-style range (``"A1:A10"``) or ``(sr, sc, er, ec)`` tuple.
        schema:
            Validation schema dict (type, operator, values, error message, etc.).
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        raw = self._bridge.call_json(
            "compute_set_range_schema",
            self._sheet_id_json,
            sr, sc, er, ec,
            json.dumps(schema),
        )
        return deserialize_mutation_result(raw)

    def get_schema(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> Optional[Dict[str, Any]]:
        """Get the data validation schema for a range.

        Returns ``None`` if no validation is set.
        """
        sr, sc, er, ec = self._resolve_range(range_ref)
        result = self._bridge.call_json(
            "compute_get_range_schema",
            self._sheet_id_json,
            sr, sc, er, ec,
        )
        if isinstance(result, dict):
            return result
        return None

    def validate(
        self,
        address: Union[str, Tuple[int, int]],
        value: Any,
    ) -> Any:
        """Validate a value against the cell's schema.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        value:
            The value to validate.

        Returns the validation result from the engine.
        """
        if isinstance(address, tuple):
            row, col = address
        else:
            row, col = parse_a1(address)
        return self._bridge.call_json(
            "compute_validate_cell_value",
            self._sheet_id_json,
            row, col,
            json.dumps(value),
        )
