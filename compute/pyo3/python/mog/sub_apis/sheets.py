"""Sheet CRUD operations -- ``wb.sheets.add()``, ``wb.sheets.remove()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Union

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class SheetsAPI:
    """Sheet lifecycle and management operations on a workbook."""

    __slots__ = ("_bridge", "_workbook", "_event_handlers")

    def __init__(self, bridge: Bridge, workbook: Any = None) -> None:
        self._bridge = bridge
        self._workbook = workbook
        self._event_handlers: Dict[str, List[Callable]] = {}

    # ------------------------------------------------------------------
    # Event subscription
    # ------------------------------------------------------------------

    def on(self, event: str, handler: Callable) -> Callable:
        """Subscribe to a sheet lifecycle event. Returns an unsubscribe function.

        Supported events: ``"sheetAdded"``, ``"sheetRemoved"``,
        ``"sheetRenamed"``, ``"activeSheetChanged"``.
        """
        if event not in self._event_handlers:
            self._event_handlers[event] = []
        self._event_handlers[event].append(handler)

        def unsubscribe():
            try:
                self._event_handlers[event].remove(handler)
            except (ValueError, KeyError):
                pass

        return unsubscribe

    def _fire_event(self, event: str, data: Any = None) -> None:
        """Fire an event to all subscribers."""
        for handler in self._event_handlers.get(event, []):
            try:
                handler(data or {"type": event})
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Internal helpers to resolve name/index -> sheet_id
    # ------------------------------------------------------------------

    def _resolve_sheet_id(self, name_or_index: Union[str, int]) -> str:
        """Resolve a sheet name or 0-based index to a sheet ID hex string."""
        from mog._bridge import _ensure_json_quoted
        sheet_ids = self._bridge.get_sheet_order()
        if isinstance(name_or_index, int):
            if 0 <= name_or_index < len(sheet_ids):
                return sheet_ids[name_or_index]
            raise ValueError(f"Sheet index {name_or_index} out of range")
        # Try as name
        for sid in sheet_ids:
            sid_json = _ensure_json_quoted(sid)
            sheet_name = self._bridge.get_sheet_name(sid_json)
            if sheet_name == name_or_index:
                return sid
        # Could already be an ID
        if name_or_index in sheet_ids:
            return name_or_index
        raise ValueError(f"Sheet not found: {name_or_index!r}")

    def _get_sheet_name(self, sheet_id: str) -> str:
        """Get the name of a sheet by ID."""
        from mog._bridge import _ensure_json_quoted
        sid_json = _ensure_json_quoted(sheet_id)
        return self._bridge.get_sheet_name(sid_json) or ""

    def _make_worksheet(self, sheet_id: str) -> Any:
        """Create a Worksheet handle for a sheet ID."""
        from mog._bridge import _ensure_json_quoted
        from mog.worksheet import Worksheet
        sid_json = _ensure_json_quoted(sheet_id)
        name = self._bridge.get_sheet_name(sid_json) or ""
        return Worksheet(self._bridge, sheet_id, name)

    def _refresh_worksheet_name(self, sheet_id: str) -> None:
        """Refresh cached name on a Worksheet in the workbook sheet cache."""
        if self._workbook is not None:
            from mog._bridge import _ensure_json_quoted
            cache = self._workbook._sheet_cache
            if sheet_id in cache:
                sid_json = _ensure_json_quoted(sheet_id)
                new_name = self._bridge.get_sheet_name(sid_json)
                if new_name:
                    cache[sheet_id]._name = new_name

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add(self, name: str) -> str:
        """Create a new sheet with the given name.

        Returns the new sheet's ID string.
        """
        raw = self._bridge.create_sheet(name)
        # Returns (sheet_id_hex, mutation_result)
        new_id: str
        if isinstance(raw, (list, tuple)):
            new_id = raw[0]
        elif isinstance(raw, dict):
            new_id = raw.get("data", raw.get("id", ""))
        else:
            new_id = str(raw)

        self._fire_event("sheetAdded", {"type": "sheetAdded", "name": name, "sheetId": new_id})
        return new_id

    def remove(self, name_or_id: Union[str, int]) -> Dict[str, Any]:
        """Delete a sheet by name, index, or ID.

        Returns a SheetRemoveReceipt dict.
        """
        sid = self._resolve_sheet_id(name_or_id)
        removed_name = self._get_sheet_name(sid)
        sid_json = json.dumps(sid)
        raw = self._bridge.delete_sheet(sid_json)

        # Remove from sheet cache
        if self._workbook is not None and sid in self._workbook._sheet_cache:
            del self._workbook._sheet_cache[sid]

        remaining_count = len(self._bridge.get_sheet_order())

        self._fire_event("sheetRemoved", {"type": "sheetRemoved", "name": removed_name, "sheetId": sid})

        return {
            "kind": "sheetRemove",
            "removedName": removed_name,
            "sheetId": sid,
            "remainingCount": remaining_count,
        }

    def rename(self, name_or_id: Union[str, int], new_name: str) -> Dict[str, Any]:
        """Rename a sheet (identified by name, index, or ID).

        Returns a SheetRenameReceipt dict.
        """
        sid = self._resolve_sheet_id(name_or_id)
        old_name = self._get_sheet_name(sid)
        sid_json = json.dumps(sid)
        raw = self._bridge.rename_compute_sheet(sid_json, new_name)

        # Update cached worksheet name
        self._refresh_worksheet_name(sid)

        self._fire_event("sheetRenamed", {"type": "sheetRenamed", "oldName": old_name, "newName": new_name, "sheetId": sid})

        return {
            "kind": "sheetRename",
            "oldName": old_name,
            "newName": new_name,
            "sheetId": sid,
        }

    def copy(self, name_or_id: Union[str, int], new_name: Optional[str] = None) -> Any:
        """Copy a sheet. Returns a Worksheet handle for the new sheet.

        Parameters
        ----------
        name_or_id:
            Name, 0-based index, or hex ID of the sheet to copy.
        new_name:
            Optional name for the copy.  If omitted, the engine assigns one.
        """
        sid = self._resolve_sheet_id(name_or_id)
        sid_json = json.dumps(sid)
        copy_name = new_name or ""
        raw = self._bridge.copy_sheet(sid_json, copy_name)
        new_id: str
        if isinstance(raw, (list, tuple)):
            new_id = raw[0]
        else:
            new_id = str(raw)
        ws = self._make_worksheet(new_id)
        # If a specific name was requested, verify it took effect
        if new_name:
            actual_name = self._get_sheet_name(new_id)
            if actual_name != new_name:
                # Try to rename to the desired name
                try:
                    new_id_json = json.dumps(new_id)
                    self._bridge.rename_compute_sheet(new_id_json, new_name)
                    ws._name = new_name
                except Exception:
                    pass
        return ws

    def hide(self, name_or_id: Union[str, int]) -> Dict[str, Any]:
        """Hide a sheet.

        Returns a SheetHideReceipt dict.
        """
        sid = self._resolve_sheet_id(name_or_id)
        name = self._get_sheet_name(sid)
        sid_json = json.dumps(sid)
        raw = self._bridge.set_sheet_hidden(sid_json, True)
        # Update cached worksheet visibility state
        if self._workbook is not None and sid in self._workbook._sheet_cache:
            ws = self._workbook._sheet_cache[sid]
            if hasattr(ws, '_visibility_state'):
                ws._visibility_state = "hidden"
        return {
            "kind": "sheetHide",
            "name": name,
            "sheetId": sid,
            "hidden": True,
        }

    def show(self, name_or_id: Union[str, int]) -> Dict[str, Any]:
        """Show (unhide) a sheet.

        Returns a SheetShowReceipt dict.
        """
        sid = self._resolve_sheet_id(name_or_id)
        name = self._get_sheet_name(sid)
        sid_json = json.dumps(sid)
        raw = self._bridge.set_sheet_hidden(sid_json, False)
        # Update cached worksheet visibility state
        if self._workbook is not None and sid in self._workbook._sheet_cache:
            ws = self._workbook._sheet_cache[sid]
            if hasattr(ws, '_visibility_state'):
                ws._visibility_state = "visible"
        return {
            "kind": "sheetShow",
            "name": name,
            "sheetId": sid,
            "hidden": False,
        }

    def move(self, name_or_id: Union[str, int], new_index: int) -> Dict[str, Any]:
        """Move a sheet to a new position (0-based).

        Returns a SheetMoveReceipt dict.
        """
        sid = self._resolve_sheet_id(name_or_id)
        name = self._get_sheet_name(sid)
        sid_json = json.dumps(sid)
        raw = self._bridge.move_sheet(sid_json, new_index)
        return {
            "kind": "sheetMove",
            "name": name,
            "sheetId": sid,
            "newIndex": new_index,
        }

    def set_active(self, name_or_id: Union[str, int]) -> None:
        """Set the active sheet by name, index, or ID."""
        from mog._bridge import _ensure_json_quoted
        sid = self._resolve_sheet_id(name_or_id)
        # Find the index of this sheet
        sheet_ids = self._bridge.get_sheet_order()
        for i, s in enumerate(sheet_ids):
            if s == sid:
                if self._workbook is not None:
                    self._workbook._active_index = i
                break
        self._fire_event("activeSheetChanged", {"type": "activeSheetChanged", "sheetId": sid})
