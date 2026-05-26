"""Named range operations -- ``wb.names.add()``, ``wb.names.remove()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class NamesAPI:
    """Named range (defined name) management for a workbook."""

    __slots__ = ("_bridge", "_local_names")

    def __init__(self, bridge: Bridge) -> None:
        self._bridge = bridge
        # Local mirror: name -> {name, reference, scope, comment, ...}
        self._local_names: Dict[str, Dict[str, Any]] = {}

    def add(
        self,
        name: str,
        refers_to: str,
        scope: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> MutationResult:
        """Create a new named range.

        Parameters
        ----------
        name:
            The defined name (e.g. ``"TotalSales"``).
        refers_to:
            The formula or range reference (e.g. ``"=Sheet1!$A$1:$B$10"``).
        scope:
            Optional sheet ID to scope the name to a specific sheet.
            ``None`` means workbook-scoped.
        comment:
            Optional comment/description.
        """
        input_obj: Dict[str, Any] = {
            "name": name,
            "refersTo": refers_to,
        }
        if scope is not None:
            input_obj["scope"] = scope
        if comment is not None:
            input_obj["comment"] = comment
        try:
            raw = self._bridge.create_named_range(json.dumps(input_obj))
        except Exception:
            raw = None
        # Store locally
        self._local_names[name] = {
            "name": name,
            "reference": refers_to,
            "scope": scope,
            "comment": comment,
        }
        return deserialize_mutation_result(raw) if raw else {}

    def remove(self, name: str) -> MutationResult:
        """Remove a named range by name."""
        try:
            raw = self._bridge.remove_named_range(name)
        except Exception:
            raw = None
        self._local_names.pop(name, None)
        return deserialize_mutation_result(raw) if raw else {}

    def get(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a named range by name.

        Returns a dict with the named range details, or ``None`` if not found.
        """
        # Check local cache first
        if name in self._local_names:
            return self._local_names[name]
        try:
            result = self._bridge.call_json("compute_get_named_range_by_name", name)
            if isinstance(result, dict):
                return result
        except Exception:
            pass
        return None

    def list(self) -> List[Dict[str, Any]]:
        """Return all named ranges in the workbook."""
        return list(self._local_names.values())

    def update(self, name: str, updates: Dict[str, Any]) -> None:
        """Update properties of an existing named range.

        Parameters
        ----------
        name:
            The name of the defined name to update.
        updates:
            Dict of properties to update (e.g. ``{"reference": "Sheet1!A1:A20"}``).
        """
        entry = self._local_names.get(name)
        if entry is not None:
            entry.update(updates)
            # If reference changed, recreate on the engine side
            new_ref = updates.get("reference") or updates.get("refersTo")
            if new_ref is not None:
                entry["reference"] = new_ref
                try:
                    self._bridge.remove_named_range(name)
                except Exception:
                    pass
                input_obj = {
                    "name": name,
                    "refersTo": new_ref,
                }
                try:
                    self._bridge.create_named_range(json.dumps(input_obj))
                except Exception:
                    pass
