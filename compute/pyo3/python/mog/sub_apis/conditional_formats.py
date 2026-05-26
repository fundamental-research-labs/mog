"""Conditional formatting operations -- ``ws.conditional_formats.add()``, etc."""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


def _generate_id() -> str:
    """Generate a UUID hex string for CF/rule IDs."""
    return uuid.uuid4().hex


class ConditionalFormatsAPI:
    """Conditional formatting operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_insertion_order")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._insertion_order: List[str] = []  # Track CF IDs in insertion order

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_sheet_id_str(self) -> str:
        """Extract the raw sheet ID string from the JSON-encoded value."""
        try:
            return json.loads(self._sheet_id_json)
        except (json.JSONDecodeError, TypeError):
            return self._sheet_id_json

    @staticmethod
    def _ensure_rule_ids(rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Ensure each rule dict has 'id' and 'priority' fields."""
        result = []
        for i, rule in enumerate(rules):
            r = dict(rule)
            if "id" not in r:
                r["id"] = _generate_id()
            if "priority" not in r:
                r["priority"] = i
            result.append(r)
        return result

    # ------------------------------------------------------------------
    # High-level convenience API (used by scenarios)
    # ------------------------------------------------------------------

    def add(
        self,
        ranges_or_rule: Any,
        rules: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """Add a conditional format.

        Supports two call signatures:
        1. ``add(ranges_list, rules_list)`` -- ranges + rules as separate args
        2. ``add(rule_dict)`` -- a single dict with range, type, etc.

        Returns the format ID string.
        """
        cf_id = _generate_id()
        sheet_id_str = self._get_sheet_id_str()

        if rules is not None:
            # Signature 1: add(ranges, rules)
            payload = {
                "id": cf_id,
                "sheetId": sheet_id_str,
                "ranges": ranges_or_rule,
                "rules": self._ensure_rule_ids(rules),
            }
        elif isinstance(ranges_or_rule, dict):
            # Signature 2: add(single_rule_dict)
            payload = dict(ranges_or_rule)
            if "id" not in payload:
                payload["id"] = cf_id
            if "sheetId" not in payload:
                payload["sheetId"] = sheet_id_str
            if "rules" in payload:
                payload["rules"] = self._ensure_rule_ids(payload["rules"])
        else:
            payload = {
                "id": cf_id,
                "sheetId": sheet_id_str,
                "ranges": ranges_or_rule,
                "rules": [],
            }

        raw = self._bridge.call_json(
            "compute_add_cf_rule", self._sheet_id_json, json.dumps(payload)
        )
        # Track insertion order
        self._insertion_order.append(cf_id)
        # Return the format ID
        return cf_id

    def list(self) -> List[Dict[str, Any]]:
        """List all conditional formats in this sheet.

        Returns them in insertion order when possible.
        """
        result = self._bridge.call_json(
            "compute_get_all_cf_rules", self._sheet_id_json
        )
        if not isinstance(result, list):
            return []
        if not self._insertion_order:
            return result
        # Sort by insertion order
        id_to_cf: Dict[str, Any] = {}
        for cf in result:
            if isinstance(cf, dict) and cf.get("id"):
                id_to_cf[cf["id"]] = cf
        ordered = []
        for cf_id in self._insertion_order:
            if cf_id in id_to_cf:
                ordered.append(id_to_cf.pop(cf_id))
        # Append any remaining CFs not in insertion order
        for cf in result:
            if isinstance(cf, dict) and cf.get("id") in id_to_cf:
                ordered.append(id_to_cf.pop(cf["id"]))
        return ordered

    def get(self, format_id: str) -> Optional[Dict[str, Any]]:
        """Get a conditional format by its ID.

        Searches compute_get_all_cf_rules and returns the matching rule.
        """
        try:
            all_rules = self.list()
            for rule in all_rules:
                if isinstance(rule, dict) and rule.get("id") == format_id:
                    return rule
            # Also try compute_get_cf_rules_for_cell as a fallback -- not useful here.
            return None
        except Exception:
            return None

    def remove(self, format_id: str) -> MutationResult:
        """Remove a conditional format by ID."""
        raw = self._bridge.call_json(
            "compute_delete_cf_rule", self._sheet_id_json, format_id
        )
        if format_id in self._insertion_order:
            self._insertion_order.remove(format_id)
        return deserialize_mutation_result(raw)

    def clear(self) -> MutationResult:
        """Clear all conditional formats from this sheet.

        Uses compute_clear_cf_formats_for_sheet(sheet_id).
        """
        raw = self._bridge.call_json(
            "compute_clear_cf_formats_for_sheet", self._sheet_id_json
        )
        self._insertion_order.clear()
        return deserialize_mutation_result(raw)

    def update(self, format_id: str, updates: Dict[str, Any]) -> MutationResult:
        """Update a conditional format rule."""
        raw = self._bridge.call_json(
            "compute_update_cf_rule",
            self._sheet_id_json,
            format_id,
            json.dumps(updates),
        )
        return deserialize_mutation_result(raw)

    def reorder(self, format_ids: List[str]) -> MutationResult:
        """Reorder conditional formats."""
        raw = self._bridge.call_json(
            "compute_reorder_cf_rules",
            self._sheet_id_json,
            json.dumps(format_ids),
        )
        # Update insertion order to match the reorder
        self._insertion_order = list(format_ids)
        return deserialize_mutation_result(raw)

    def clear_in_ranges(self, ranges: List[Dict[str, Any]]) -> MutationResult:
        """Clear conditional formats in the specified ranges.

        Iterates all CF rules and removes those whose ranges overlap with
        the specified ranges.
        """
        all_rules = self.list()
        raw = None
        for rule in all_rules:
            if not isinstance(rule, dict):
                continue
            rule_id = rule.get("id")
            if not rule_id:
                continue
            rule_ranges = rule.get("ranges", [])
            if not isinstance(rule_ranges, list):
                continue
            # Check if any rule range overlaps with any target range
            for rr in rule_ranges:
                if not isinstance(rr, dict):
                    continue
                for tr in ranges:
                    if not isinstance(tr, dict):
                        continue
                    if self._ranges_overlap(rr, tr):
                        raw = self._bridge.call_json(
                            "compute_delete_cf_rule",
                            self._sheet_id_json,
                            rule_id,
                        )
                        break
                else:
                    continue
                break
        return deserialize_mutation_result(raw)

    @staticmethod
    def _ranges_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        """Check if two range dicts overlap."""
        a_sr = a.get("startRow", 0)
        a_sc = a.get("startCol", 0)
        a_er = a.get("endRow", 0)
        a_ec = a.get("endCol", 0)
        b_sr = b.get("startRow", 0)
        b_sc = b.get("startCol", 0)
        b_er = b.get("endRow", 0)
        b_ec = b.get("endCol", 0)
        return not (a_er < b_sr or b_er < a_sr or a_ec < b_sc or b_ec < a_sc)

    def clear_rule_style(self, format_id: str, rule_id: str) -> MutationResult:
        """Clear the style from a specific rule within a conditional format.

        Gets the full CF, removes the style from the matching rule, and re-submits.
        """
        cf = self.get(format_id)
        if cf and isinstance(cf, dict):
            rules = cf.get("rules", [])
            updated_rules = []
            for r in rules:
                if isinstance(r, dict):
                    nr = dict(r)
                    if nr.get("id") == rule_id:
                        nr["style"] = {}
                    updated_rules.append(nr)
            cf["rules"] = updated_rules
            raw = self._bridge.call_json(
                "compute_update_cf_rule",
                self._sheet_id_json,
                format_id,
                json.dumps(cf),
            )
            return deserialize_mutation_result(raw)
        # Fallback: try direct update
        raw = self._bridge.call_json(
            "compute_update_cf_rule",
            self._sheet_id_json,
            format_id,
            json.dumps({"ruleId": rule_id, "style": {}}),
        )
        return deserialize_mutation_result(raw)

    def clone_for_paste(self, format_id: str) -> str:
        """Clone a conditional format for paste operations.

        Gets the rule, creates a copy with a new ID.
        Returns the new format ID.
        """
        original = self.get(format_id)
        if original is None:
            return ""
        new_id = _generate_id()
        clone = dict(original)
        clone["id"] = new_id
        sheet_id_str = self._get_sheet_id_str()
        clone["sheetId"] = sheet_id_str
        self._bridge.call_json(
            "compute_add_cf_rule",
            self._sheet_id_json,
            json.dumps(clone),
        )
        return new_id

    # ------------------------------------------------------------------
    # Legacy API (kept for backward compatibility)
    # ------------------------------------------------------------------

    def add_rule(self, rule: Dict[str, Any]) -> MutationResult:
        """Add a conditional formatting rule (legacy)."""
        raw = self._bridge.call_json(
            "compute_add_cf_rule", self._sheet_id_json, json.dumps(rule)
        )
        return deserialize_mutation_result(raw)

    def get_all_rules(self) -> List[Dict[str, Any]]:
        """Get all conditional formatting rules in this sheet (legacy)."""
        return self.list()

    def update_rule(self, rule_id: str, updates: Dict[str, Any]) -> MutationResult:
        """Update a conditional formatting rule (legacy)."""
        return self.update(rule_id, updates)

    def delete_rule(self, rule_id: str) -> MutationResult:
        """Delete a conditional formatting rule by ID (legacy)."""
        return self.remove(rule_id)

    def reorder_rules(self, rule_ids: List[str]) -> MutationResult:
        """Reorder conditional formatting rules (legacy)."""
        return self.reorder(rule_ids)

    def evaluate(self) -> Any:
        """Evaluate all conditional formatting rules and return results."""
        return self._bridge.call_json(
            "compute_eval_cf", self._sheet_id_json
        )
