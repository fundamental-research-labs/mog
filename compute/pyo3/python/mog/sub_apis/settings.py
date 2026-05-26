"""Workbook settings -- ``wb.settings.set_calculation_mode()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, List

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class SettingsAPI:
    """Workbook-level settings (calculation mode, culture, iterations)."""

    __slots__ = ("_bridge", "_custom_lists")

    def __init__(self, bridge: Bridge) -> None:
        self._bridge = bridge
        self._custom_lists: List[List[str]] = []

    def get(self) -> Dict[str, Any]:
        """Get all workbook settings as a dict."""
        settings = self._bridge.get_workbook_settings()
        if isinstance(settings, dict) and self._custom_lists:
            settings["customLists"] = list(self._custom_lists)
        return settings

    def set(self, settings: Dict[str, Any]) -> MutationResult:
        """Set all workbook settings from a dict."""
        # Extract custom lists before passing to engine
        if "customLists" in settings:
            self._custom_lists = list(settings["customLists"])
        raw = self._bridge.set_workbook_settings(json.dumps(settings))
        return deserialize_mutation_result(raw)

    def set_culture(self, culture: str) -> MutationResult:
        """Set the workbook culture/locale (e.g. ``'en-US'``)."""
        raw = self._bridge.set_culture(culture)
        return deserialize_mutation_result(raw)

    def set_calculation_mode(self, mode: str) -> MutationResult:
        """Set the calculation mode: ``'auto'``, ``'autoNoTable'``, ``'manual'``."""
        raw = self._bridge.set_calculation_mode(mode)
        return deserialize_mutation_result(raw)

    def get_custom_lists(self) -> List[List[str]]:
        """Get custom lists. Returns a list of lists."""
        if self._custom_lists:
            return list(self._custom_lists)
        settings = self._bridge.get_workbook_settings()
        if isinstance(settings, dict):
            cl = settings.get("customLists", [])
            if isinstance(cl, list):
                return cl
        return []

    def set_custom_lists(self, lists: List[List[str]]) -> None:
        """Set custom lists."""
        self._custom_lists = list(lists)
        self.set({"customLists": lists})
