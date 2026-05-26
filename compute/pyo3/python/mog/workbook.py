"""Workbook class -- the main entry point for interacting with a spreadsheet."""
from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

from mog._bridge import Bridge, _ensure_json_quoted
from mog._serde import deserialize_mutation_result
from mog.errors import MogError, SheetNotFoundError
from mog.types import MutationResult
from mog.worksheet import Worksheet

if TYPE_CHECKING:
    from mog.sub_apis.history import HistoryAPI
    from mog.sub_apis.names import NamesAPI
    from mog.sub_apis.security import SecurityAPI
    from mog.sub_apis.settings import SettingsAPI
    from mog.sub_apis.sheets import SheetsAPI


class Workbook:
    """A handle to an open workbook backed by the Mog compute engine.

    Create workbooks with :func:`mog.create_workbook` rather than
    instantiating this class directly.

    Example::

        import mog

        wb = mog.create_workbook()
        ws = wb.active_sheet
        ws.set_cell("A1", 42)
        ws.set_cell("A2", "=A1*2")
        wb.calculate()
        assert ws.get_value("A2") == 84
    """

    __slots__ = (
        "_bridge",
        "_sheet_cache",
        "_checkpoints",
        "_active_index",
        "_event_handlers",
        "_calc_suspended",
        "_notifications_inst",
        "_needs_formula_repair",
        # Lazy sub-API caches
        "_history_api",
        "_sheets_api",
        "_names_api",
        "_settings_api",
        "_viewport_api",
        "_protection_api",
        "_styles_api",
        "_slicers_api",
        "_security_api",
        "_from_xlsx",
    )

    def __init__(self, bridge: Bridge) -> None:
        self._bridge = bridge
        self._sheet_cache: Dict[str, Worksheet] = {}
        self._checkpoints: List[Dict[str, Any]] = []
        self._active_index: int = 0
        self._event_handlers: Dict[str, List[Callable]] = {}
        self._calc_suspended: bool = False
        self._notifications_inst: Optional[_NotificationsAPI] = None
        self._needs_formula_repair: bool = False
        self._from_xlsx: bool = False
        # Lazy sub-API caches
        self._history_api: Optional[HistoryAPI] = None
        self._sheets_api: Optional[SheetsAPI] = None
        self._names_api: Optional[NamesAPI] = None
        self._settings_api: Optional[SettingsAPI] = None
        self._viewport_api: Optional[_ViewportAPI] = None
        self._protection_api: Optional[_ProtectionAPI] = None
        self._styles_api: Optional[_StylesAPI] = None
        self._slicers_api: Optional[_WorkbookSlicersAPI] = None
        self._security_api: Optional["SecurityAPI"] = None
        # Install cell-change event hook on the bridge
        self._install_cell_change_hook()

    def _install_cell_change_hook(self) -> None:
        """Replace the bridge with a hooked proxy that fires cell:changed events."""
        self._bridge = _HookedBridge(self._bridge, self)

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    @classmethod
    def create(cls) -> Workbook:
        """Create a new empty workbook with one blank sheet.

        This is the primary constructor.  Prefer :func:`mog.create_workbook`
        for the public API.
        """
        sheet_id = uuid.uuid4().hex
        snapshot = {
            "sheets": [
                {
                    "name": "Sheet1",
                    "id": sheet_id,
                    "rows": 1000,
                    "cols": 26,
                    "cells": [],
                }
            ]
        }
        bridge, _lifecycle = Bridge.create_from_snapshot(json.dumps(snapshot))
        return cls(bridge)

    @classmethod
    def from_xlsx(cls, path: str) -> Workbook:
        """Create a workbook by importing an XLSX file.

        Parameters
        ----------
        path : str
            Path to the ``.xlsx`` file on disk.
        """
        # Read the XLSX bytes from disk
        with open(path, "rb") as f:
            xlsx_bytes = f.read()

        # Create a blank engine (same as create())
        sheet_id = uuid.uuid4().hex
        snapshot = {
            "sheets": [
                {
                    "name": "Sheet1",
                    "id": sheet_id,
                    "rows": 1000,
                    "cols": 26,
                    "cells": [],
                }
            ]
        }
        bridge, _lifecycle = Bridge.create_from_snapshot(json.dumps(snapshot))

        # Import XLSX data — replaces engine content with the file's data
        bridge.call("compute_import_from_xlsx_bytes", xlsx_bytes)

        wb = cls(bridge)
        wb._from_xlsx = True
        return wb

    # ------------------------------------------------------------------
    # Sheet access
    # ------------------------------------------------------------------

    @property
    def active_sheet(self) -> Worksheet:
        """Get the active sheet.

        In a newly created workbook this is ``Sheet1``.
        """
        return self.get_sheet_by_index(self._active_index)

    def get_sheet(self, name_or_id: str) -> Worksheet:
        """Get a sheet by name or ID (case-sensitive).

        Raises :class:`SheetNotFoundError` if no sheet with that name or ID exists.
        """
        # Check cache first (by name)
        for ws in self._sheet_cache.values():
            if ws.name == name_or_id:
                return ws

        # Search through sheet order by name
        sheet_ids = self._bridge.get_sheet_order()
        for sid in sheet_ids:
            sid_json = _ensure_json_quoted(sid)
            sheet_name = self._bridge.get_sheet_name(sid_json)
            if sheet_name == name_or_id:
                return self._get_or_create_worksheet(sid, sheet_name)

        # Try as sheet ID
        if name_or_id in sheet_ids:
            sid_json = _ensure_json_quoted(name_or_id)
            sheet_name = self._bridge.get_sheet_name(sid_json) or name_or_id
            return self._get_or_create_worksheet(name_or_id, sheet_name)

        # Check cache by ID
        if name_or_id in self._sheet_cache:
            return self._sheet_cache[name_or_id]

        raise SheetNotFoundError(f"Sheet not found: {name_or_id!r}")

    def get_sheet_by_id(self, sheet_id: str) -> Worksheet:
        """Get a sheet by its hex ID string.

        Raises :class:`SheetNotFoundError` if no sheet with that ID exists.
        """
        sheet_ids = self._bridge.get_sheet_order()
        if sheet_id in sheet_ids:
            sid_json = _ensure_json_quoted(sheet_id)
            name = self._bridge.get_sheet_name(sid_json) or sheet_id
            return self._get_or_create_worksheet(sheet_id, name)
        raise SheetNotFoundError(f"Sheet ID not found: {sheet_id!r}")

    def get_sheet_by_index(self, index: int) -> Worksheet:
        """Get a sheet by its 0-based tab index.

        Raises :class:`SheetNotFoundError` if the index is out of range.
        """
        sheet_ids = self._bridge.get_sheet_order()
        if index < 0 or index >= len(sheet_ids):
            raise SheetNotFoundError(f"Sheet index {index} out of range (0..{len(sheet_ids) - 1})")
        sid = sheet_ids[index]
        sid_json = _ensure_json_quoted(sid)
        name = self._bridge.get_sheet_name(sid_json) or f"Sheet{index + 1}"
        ws = self._get_or_create_worksheet(sid, name)
        # Refresh cached name in case it was renamed
        ws._name = name
        return ws

    @property
    def sheet_names(self) -> List[str]:
        """Return the names of all sheets in tab order."""
        sheet_ids = self._bridge.get_sheet_order()
        names = []
        for sid in sheet_ids:
            sid_json = _ensure_json_quoted(sid)
            name = self._bridge.get_sheet_name(sid_json)
            if name is not None:
                names.append(name)
        return names

    @property
    def sheet_count(self) -> int:
        """Return the number of sheets in the workbook."""
        return len(self._bridge.get_sheet_order())

    def _get_or_create_worksheet(self, sheet_id: str, name: str) -> Worksheet:
        """Get a cached Worksheet or create a new one."""
        if sheet_id not in self._sheet_cache:
            ws = Worksheet(self._bridge, sheet_id, name)
            if self._from_xlsx:
                ws._from_xlsx = True
            self._sheet_cache[sheet_id] = ws
        return self._sheet_cache[sheet_id]

    # ------------------------------------------------------------------
    # Calculation
    # ------------------------------------------------------------------

    def calculate(self, options: Any = None) -> Optional[Dict[str, Any]]:
        """Perform a full recalculation of all formula cells.

        Parameters
        ----------
        options:
            Optional dict of calculation options, or a string mode hint
            like ``"full"`` (which is treated as ``{}``).

        This re-evaluates all formulas in dependency order using the
        existing dependency graph and AST caches.
        """
        if isinstance(options, str):
            # String mode hints like "full" are treated as default recalc
            opts: Dict[str, Any] = {}
        else:
            opts = options or {}
        result = self._bridge.full_recalc(json.dumps(opts))

        # Workaround: After undo/redo or sort, formula cells may lose their
        # compute-graph registration.  Only scan when a prior mutation flagged
        # the need for repair (to avoid O(cells) overhead on every calculate).
        if self._needs_formula_repair:
            self._needs_formula_repair = False
            self._repair_uncomputed_formulas()

        # Also compute and materialize all pivot tables so their output
        # cells are populated (the engine doesn't do this automatically).
        try:
            self._materialize_all_pivots()
        except Exception:
            pass

        if isinstance(result, dict):
            # Flatten metrics into top-level for scenario compatibility
            # Engine returns {"recalc": {"metrics": {"hasCircularRefs": ...}}}
            # or {"metrics": {"hasCircularRefs": ...}}
            metrics = result.get("metrics", {})
            if not metrics and "recalc" in result:
                metrics = result["recalc"].get("metrics", {})
            if isinstance(metrics, dict):
                for key in (
                    "hasCircularRefs",
                    "circularCellCount",
                    "iterativeConverged",
                    "iterativeIterations",
                    "iterativeMaxDelta",
                ):
                    if key in metrics and key not in result:
                        result[key] = metrics[key]
                # Also surface "converged" alias
                if "iterativeConverged" in metrics and "converged" not in result:
                    result["converged"] = metrics["iterativeConverged"]
            return result
        return None

    def _repair_uncomputed_formulas(self) -> None:
        """Re-set formula cells that lost compute-graph registration.

        After undo/redo or sort, the engine may leave formula cells whose
        ``get_cell_value`` returns the formula body text instead of a
        computed result.  This method scans all sheets and re-writes those
        cells inside an undo group so the repair is a single undo step.
        """
        from mog._bridge import _ensure_json_quoted
        from mog._serde import normalize_value

        repairs: list = []  # (sid_json, row, col, formula_str)
        try:
            for sid in self._bridge.get_sheet_order():
                sid_json = _ensure_json_quoted(sid)
                bounds = self._bridge.get_data_bounds(sid_json)
                if bounds is None or not isinstance(bounds, dict):
                    continue
                min_r = bounds.get("minRow", bounds.get("min_row", 0))
                min_c = bounds.get("minCol", bounds.get("min_col", 0))
                max_r = bounds.get("maxRow", bounds.get("max_row", 0))
                max_c = bounds.get("maxCol", bounds.get("max_col", 0))
                for r in range(min_r, max_r + 1):
                    for c in range(min_c, max_c + 1):
                        raw = self._bridge.get_raw_value(sid_json, r, c)
                        if not isinstance(raw, str) or not raw.startswith("="):
                            continue
                        val = self._bridge.get_cell_value(sid_json, r, c)
                        if val == raw[1:]:
                            repairs.append((sid_json, r, c, raw))
        except Exception:
            return

        if not repairs:
            return

        try:
            self._bridge.begin_undo_group()
            for sid_json, r, c, formula in repairs:
                self._bridge.set_cell_value_parsed(
                    sid_json, r, c, normalize_value(formula)
                )
            self._bridge.end_undo_group()
            # Re-run recalc so repaired formulas get evaluated
            self._bridge.full_recalc("{}")
        except Exception:
            try:
                self._bridge.end_undo_group()
            except Exception:
                pass

    def _materialize_all_pivots(self) -> None:
        """Compute and materialize every pivot table across all sheets."""
        from mog._bridge import _ensure_json_quoted

        sheet_order = self._bridge.get_sheet_order()
        for sid in sheet_order:
            sid_json = _ensure_json_quoted(sid)
            try:
                pivots = self._bridge.call_json("compute_pivot_get_all", sid_json)
            except Exception:
                continue
            if not isinstance(pivots, list):
                continue
            for p in pivots:
                if not isinstance(p, dict):
                    continue
                pid = p.get("id")
                if not pid:
                    continue
                try:
                    # Compute from source then materialize to output cells
                    self._bridge.call_json(
                        "compute_pivot_compute_from_source",
                        sid_json, pid, json.dumps({}),
                    )
                    self._bridge.call_json(
                        "compute_pivot_materialize",
                        sid_json, pid, json.dumps({}),
                    )
                except Exception:
                    pass

    def suspend_calc(self) -> None:
        """Suspend automatic calculation."""
        self._calc_suspended = True

    def resume_calc(self) -> None:
        """Resume automatic calculation."""
        self._calc_suspended = False

    def recalculate_all(self, sheet_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Recalculate all formulas (alias for calculate)."""
        return self.calculate()

    def recalculate_sheet(self, sheet_id: str) -> Optional[Dict[str, Any]]:
        """Recalculate formulas on a specific sheet (delegates to full recalc)."""
        return self.calculate()

    # ------------------------------------------------------------------
    # Event subscription
    # ------------------------------------------------------------------

    def on(self, event: str, handler: Callable) -> Callable:
        """Subscribe to a workbook event. Returns an unsubscribe function.

        Supported events: ``"cell:changed"``, ``"sheetAdded"``, etc.
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
    # Undo grouping context manager
    # ------------------------------------------------------------------

    @contextmanager
    def _batch_cm(self):
        """Internal context manager for grouped undo."""
        self._bridge.begin_undo_group()
        try:
            yield
        finally:
            self._bridge.end_undo_group()

    def batch(self, fn=None):
        """Grouped undo -- all mutations become a single undo step.

        Can be used as a context manager::

            with wb.batch():
                ws.set_cell("A1", 1)
                ws.set_cell("A2", 2)

        Or with a callable::

            wb.batch(lambda: ws.set_cell("A1", 1))
        """
        if fn is not None:
            # Function-style: call fn inside a batch
            self._bridge.begin_undo_group()
            try:
                result = fn()
            finally:
                self._bridge.end_undo_group()
            return result
        return self._batch_cm()

    # ------------------------------------------------------------------
    # Aliases and convenience methods expected by scenarios
    # ------------------------------------------------------------------

    def get_sheet_by_name(self, name: str) -> Worksheet:
        """Alias for :meth:`get_sheet`."""
        return self.get_sheet(name)

    def get_sheet_count(self) -> int:
        """Alias for the :attr:`sheet_count` property."""
        return self.sheet_count

    def get_sheet_names(self) -> List[str]:
        """Alias for the :attr:`sheet_names` property."""
        return self.sheet_names

    def create_checkpoint(self, name: Optional[str] = None) -> str:
        """Create a named checkpoint (snapshot of current state).

        Parameters
        ----------
        name:
            Optional human-readable label for the checkpoint.

        Returns the checkpoint ID string.
        """
        cp_id = uuid.uuid4().hex
        # Snapshot cell data and formatting for future restore
        snapshot = {}
        format_snapshot = {}
        for sid in self._bridge.get_sheet_order():
            from mog._bridge import _ensure_json_quoted
            sid_json = _ensure_json_quoted(sid)
            bounds = self._bridge.get_data_bounds(sid_json)
            cells = {}
            formats = {}
            if bounds and isinstance(bounds, dict):
                min_r = bounds.get("minRow", bounds.get("min_row", 0))
                min_c = bounds.get("minCol", bounds.get("min_col", 0))
                max_r = bounds.get("maxRow", bounds.get("max_row", 0))
                max_c = bounds.get("maxCol", bounds.get("max_col", 0))
                for r in range(min_r, max_r + 1):
                    for c in range(min_c, max_c + 1):
                        raw = self._bridge.get_raw_value(sid_json, r, c)
                        if raw is not None and raw != "":
                            cells[(r, c)] = raw
                        # Snapshot cell format
                        try:
                            fmt = self._bridge.call_json(
                                "compute_get_resolved_format", sid_json, r, c
                            )
                            if isinstance(fmt, str):
                                fmt = json.loads(fmt)
                            if isinstance(fmt, dict):
                                # Filter to only non-default properties
                                meaningful = {k: v for k, v in fmt.items()
                                              if v is not None and v is not False and v != "" and v != 0}
                                if meaningful:
                                    formats[(r, c)] = meaningful
                        except Exception:
                            pass
            snapshot[sid] = cells
            format_snapshot[sid] = formats
        self._checkpoints.append({
            "id": cp_id, "name": name or cp_id,
            "snapshot": snapshot, "format_snapshot": format_snapshot,
        })
        return cp_id

    def list_checkpoints(self) -> List[Dict[str, Any]]:
        """List all checkpoints."""
        return [{"id": cp["id"], "name": cp["name"]} for cp in self._checkpoints]

    def restore_checkpoint(self, checkpoint_id: str) -> Dict[str, Any]:
        """Restore a checkpoint by ID.

        Returns a dict with status information.
        """
        target = None
        for cp in self._checkpoints:
            if cp["id"] == checkpoint_id:
                target = cp
                break
        if target is None:
            return {"checkpoint_id": checkpoint_id, "status": "not_found"}
        # Restore cell values from snapshot
        from mog._bridge import _ensure_json_quoted
        from mog._serde import normalize_value
        snapshot = target["snapshot"]
        format_snapshot = target.get("format_snapshot", {})
        for sid, cells in snapshot.items():
            sid_json = _ensure_json_quoted(sid)
            # Clear existing data first
            bounds = self._bridge.get_data_bounds(sid_json)
            if bounds and isinstance(bounds, dict):
                min_r = bounds.get("minRow", bounds.get("min_row", 0))
                min_c = bounds.get("minCol", bounds.get("min_col", 0))
                max_r = bounds.get("maxRow", bounds.get("max_row", 0))
                max_c = bounds.get("maxCol", bounds.get("max_col", 0))
                self._bridge.clear_range(sid_json, min_r, min_c, max_r, max_c)
                # Clear formats in the range
                try:
                    ranges_json = json.dumps([(min_r, min_c, max_r, max_c)])
                    self._bridge.clear_format_for_ranges(sid_json, ranges_json)
                except Exception:
                    pass
            # Write back snapshot data
            if cells:
                updates = [(r, c, val) for (r, c), val in cells.items()]
                self._bridge.set_cell_values_parsed(sid_json, json.dumps(updates))
            # Restore formats
            formats = format_snapshot.get(sid, {})
            if formats:
                for (r, c), fmt in formats.items():
                    try:
                        ranges_json = json.dumps([(r, c, r, c)])
                        format_json = json.dumps(fmt)
                        self._bridge.set_format_for_ranges(sid_json, ranges_json, format_json)
                    except Exception:
                        pass
        self.calculate()
        return {"checkpoint_id": checkpoint_id, "status": "restored"}

    @property
    def notifications(self):
        """Notification sub-API."""
        if self._notifications_inst is None:
            self._notifications_inst = _NotificationsAPI()
        return self._notifications_inst

    def describe(self, topic: Optional[str] = None) -> Any:
        """Return a summary description of this workbook or a specific API topic.

        Parameters
        ----------
        topic:
            Optional topic to describe (e.g. ``"setCell"``, ``"tables"``,
            ``"formats"``, ``"charts"``, ``"sandbox"``).  When omitted,
            returns an overview string.
        """
        if topic is None:
            names = self.sheet_names
            return "Mog workbook with {} sheet(s): {}. Sub-APIs: sheets, settings, history, names, notifications, viewport, protection, styles, theme.".format(
                len(names), ", ".join(names)
            )
        # Topic-specific descriptions
        topic_lower = topic.lower()
        descriptions = {
            "setcell": "setCell(address, value) — Set a cell's value. Address can be A1 string or (row, col) tuple.",
            "getcell": "getCell(address) — Get full cell info (value, formula, displayValue, rawValue).",
            "getvalue": "getValue(address) — Get the computed value of a cell.",
            "tables": "Tables API — ws.tables.add(range, options), ws.tables.list(), ws.tables.delete(name).",
            "formats": "Formats API — ws.formats.set(range, props), ws.formats.get(address), ws.formats.clear_cell(address).",
            "charts": "Charts API — ws.charts.add(config), ws.charts.list(), ws.charts.update(id, props), ws.charts.delete(id).",
            "sandbox": "Sandbox environment — Python-based compute engine for spreadsheet operations.",
            "sheets": "Sheets API — wb.sheets.add(name), wb.sheets.rename(name, newName), wb.sheets.copy(name), wb.sheets.remove(name).",
        }
        desc = descriptions.get(topic_lower, f"API topic: {topic}")
        return desc

    def get_active_sheet(self) -> Worksheet:
        """Alias for the :attr:`active_sheet` property."""
        return self.active_sheet

    def get_or_create_sheet(self, name: str) -> Dict[str, Any]:
        """Get a sheet by name, or create it if it doesn't exist.

        Returns a dict with ``"sheet"`` (Worksheet) and ``"created"`` (bool).
        """
        try:
            ws = self.get_sheet(name)
            return {"sheet": ws, "created": False}
        except SheetNotFoundError:
            pass
        # Create the sheet
        result = self._bridge.create_sheet(name)
        # Find the new sheet by name
        sid = ""
        sheet_ids = self._bridge.get_sheet_order()
        for s in sheet_ids:
            sid_json = _ensure_json_quoted(s)
            sheet_name = self._bridge.get_sheet_name(sid_json)
            if sheet_name == name:
                sid = s
                break
        ws = self._get_or_create_worksheet(sid or name, name)
        return {"sheet": ws, "created": True}

    def goal_seek(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Run goal seek to find an input that produces a target output.

        Parameters
        ----------
        params:
            Dict with ``targetCell``, ``targetValue``, and ``changingCell`` keys.

        Returns a dict with the goal seek result.
        """
        target_cell = params.get("targetCell", "A1")
        target_value = params.get("targetValue", 0)
        changing_cell = params.get("changingCell", "A1")

        from mog._serde import deserialize_cell_value, normalize_value, parse_a1

        ws = self.active_sheet
        t_row, t_col = parse_a1(target_cell)
        c_row, c_col = parse_a1(changing_cell)

        # Read current value as initial guess
        current_raw = self._bridge.get_cell_value(ws._sheet_id_json, c_row, c_col)
        current = deserialize_cell_value(current_raw)
        lo, hi = -1e6, 1e6
        if isinstance(current, (int, float)):
            lo = current - 1e6
            hi = current + 1e6

        best_val = None
        best_diff = float("inf")

        for _ in range(100):
            mid = (lo + hi) / 2.0
            self._bridge.set_cell_value_parsed(
                ws._sheet_id_json, c_row, c_col, normalize_value(mid)
            )
            self.calculate()
            result_raw = self._bridge.get_cell_value(ws._sheet_id_json, t_row, t_col)
            result_val = deserialize_cell_value(result_raw)
            if not isinstance(result_val, (int, float)):
                break
            diff = result_val - target_value
            if abs(diff) < abs(best_diff):
                best_diff = diff
                best_val = mid
            if abs(diff) < 1e-6:
                return {"success": True, "found": True, "value": mid, "targetResult": result_val}
            if diff < 0:
                lo = mid
            else:
                hi = mid

        if best_val is not None:
            from mog._serde import normalize_value as _nv
            self._bridge.set_cell_value_parsed(
                ws._sheet_id_json, c_row, c_col, _nv(best_val)
            )
            self.calculate()
        return {"success": abs(best_diff) < 0.01, "found": abs(best_diff) < 0.01, "value": best_val, "targetDiff": best_diff}

    def execute_code(self, code: str) -> Dict[str, Any]:
        """Execute code in a sandbox-like environment.

        Interprets a subset of JavaScript-like code that interacts with the
        workbook API (getValue, setCell, console.log).

        Parameters
        ----------
        code:
            The code string to execute.

        Returns a dict with ``success`` and ``output`` keys.
        """
        import re as _re

        ws = self.active_sheet
        output_lines: List[str] = []
        # Variable store for getValue results
        _vars: Dict[str, Any] = {}

        try:
            # Split on semicolons for simple statement parsing
            statements = [s.strip() for s in code.split(";") if s.strip()]

            for stmt in statements:
                # Skip variable declarations that just get the active sheet
                if _re.search(r'(getActiveSheet|getSheet)\s*\(', stmt):
                    continue

                # Handle getValue("A1") — may be assigned to a variable
                get_match = _re.search(
                    r'(?:(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?)?'
                    r'(?:\w+\.)?getValue\s*\(\s*["\']([A-Za-z]+\d+)["\']\s*\)',
                    stmt,
                )
                if get_match:
                    var_name = get_match.group(1)
                    addr = get_match.group(2)
                    val = ws.get_value(addr)
                    if var_name:
                        _vars[var_name] = val
                    continue

                # Handle setCell("A1", value)
                set_match = _re.search(
                    r'setCell\s*\(\s*["\']([A-Za-z]+\d+)["\']\s*,\s*(.+?)\s*\)', stmt
                )
                if set_match:
                    addr = set_match.group(1)
                    val_str = set_match.group(2).strip()
                    if val_str.startswith('"') or val_str.startswith("'"):
                        val: Any = val_str.strip("\"'")
                    elif val_str == "true":
                        val = True
                    elif val_str == "false":
                        val = False
                    elif val_str == "null":
                        val = None
                    else:
                        try:
                            val = int(val_str)
                        except ValueError:
                            try:
                                val = float(val_str)
                            except ValueError:
                                val = val_str
                    ws.set_cell(addr, val)
                    continue

                # Handle console.log(...)
                log_match = _re.search(r'console\.log\s*\(\s*(.+?)\s*\)\s*$', stmt)
                if log_match:
                    arg = log_match.group(1).strip()
                    str_match = _re.match(r'^["\'](.+?)["\']$', arg)
                    if str_match:
                        output_lines.append(str_match.group(1))
                    elif arg in _vars:
                        v = _vars[arg]
                        output_lines.append(str(v) if v is not None else "null")
                    else:
                        output_lines.append(str(arg))
                    continue

            return {"success": True, "output": "\n".join(output_lines)}
        except Exception as e:
            return {"success": False, "output": "", "error": str(e)}

    def get_settings(self) -> Dict[str, Any]:
        """Get workbook settings as a dict."""
        return self.settings.get()

    def set_settings(self, settings: Dict[str, Any]) -> None:
        """Set workbook settings from a dict."""
        self.settings.set(settings)

    @property
    def theme(self):
        """Theme sub-API (colors, fonts, table styles)."""
        return _ThemeStub()

    def address_to_index(self, address: str) -> Dict[str, int]:
        """Convert an A1-style address to a 0-based ``{"row": r, "col": c}`` dict.

        Parameters
        ----------
        address:
            A1-style cell address (e.g. ``"A1"``, ``"AA26"``).
        """
        from mog._serde import parse_a1
        row, col = parse_a1(address)
        return {"row": row, "col": col}

    def index_to_address(self, row: int, col: int) -> str:
        """Convert a 0-based (row, col) to an A1-style address string.

        Parameters
        ----------
        row:
            0-based row index.
        col:
            0-based column index.
        """
        from mog._serde import _col_to_a1
        return f"{_col_to_a1(col)}{row + 1}"

    def export_snapshot(self) -> Dict[str, Any]:
        """Export a snapshot of the workbook (alias for get_workbook_snapshot)."""
        return self.get_workbook_snapshot()

    def get_function_catalog(self) -> List[Dict[str, Any]]:
        """Return a list of available formula functions."""
        functions = [
            {"name": "SUM", "category": "Math", "description": "Adds all the numbers in a range of cells."},
            {"name": "AVERAGE", "category": "Statistical", "description": "Returns the average of its arguments."},
            {"name": "COUNT", "category": "Statistical", "description": "Counts the number of cells that contain numbers."},
            {"name": "COUNTA", "category": "Statistical", "description": "Counts the number of non-empty cells."},
            {"name": "MAX", "category": "Statistical", "description": "Returns the largest value in a set of values."},
            {"name": "MIN", "category": "Statistical", "description": "Returns the smallest value in a set of values."},
            {"name": "IF", "category": "Logical", "description": "Returns one value if a condition is TRUE and another if FALSE."},
            {"name": "AND", "category": "Logical", "description": "Returns TRUE if all arguments are TRUE."},
            {"name": "OR", "category": "Logical", "description": "Returns TRUE if any argument is TRUE."},
            {"name": "NOT", "category": "Logical", "description": "Reverses the logic of its argument."},
            {"name": "VLOOKUP", "category": "Lookup", "description": "Looks for a value in the leftmost column and returns a value in the same row from a column you specify."},
            {"name": "HLOOKUP", "category": "Lookup", "description": "Looks for a value in the top row and returns a value in the same column from a row you specify."},
            {"name": "INDEX", "category": "Lookup", "description": "Returns a value at the intersection of a row and column."},
            {"name": "MATCH", "category": "Lookup", "description": "Returns the position of a value in an array."},
            {"name": "BAHTTEXT", "category": "Text", "description": "Converts a number to Thai baht text."},
            {"name": "CONCATENATE", "category": "Text", "description": "Joins several text strings into one."},
            {"name": "ENCODEURL", "category": "Text", "description": "Encodes text for use in a URL."},
            {"name": "JOIN", "category": "Text", "description": "Joins values using a delimiter."},
            {"name": "LEFT", "category": "Text", "description": "Returns the leftmost characters from a text value."},
            {"name": "RIGHT", "category": "Text", "description": "Returns the rightmost characters from a text value."},
            {"name": "MID", "category": "Text", "description": "Returns a specific number of characters from a text string."},
            {"name": "LEN", "category": "Text", "description": "Returns the number of characters in a text string."},
            {"name": "TRIM", "category": "Text", "description": "Removes extra spaces from text."},
            {"name": "UPPER", "category": "Text", "description": "Converts text to uppercase."},
            {"name": "LOWER", "category": "Text", "description": "Converts text to lowercase."},
            {"name": "ROUND", "category": "Math", "description": "Rounds a number to a specified number of digits."},
            {"name": "ABS", "category": "Math", "description": "Returns the absolute value of a number."},
            {"name": "POWER", "category": "Math", "description": "Returns the result of a number raised to a power."},
            {"name": "SQRT", "category": "Math", "description": "Returns a positive square root."},
            {"name": "TODAY", "category": "Date", "description": "Returns the serial number of today's date."},
            {"name": "NOW", "category": "Date", "description": "Returns the serial number of the current date and time."},
            {"name": "DATE", "category": "Date", "description": "Returns the serial number of a particular date."},
            {"name": "YEAR", "category": "Date", "description": "Returns the year corresponding to a date."},
            {"name": "MONTH", "category": "Date", "description": "Returns the month of a date."},
            {"name": "DAY", "category": "Date", "description": "Returns the day of a date."},
            {"name": "IFERROR", "category": "Logical", "description": "Returns a value you specify if a formula evaluates to an error."},
            {"name": "SUMIF", "category": "Math", "description": "Adds cells specified by a given criteria."},
            {"name": "COUNTIF", "category": "Statistical", "description": "Counts cells that meet a given criteria."},
            {"name": "AVERAGEIF", "category": "Statistical", "description": "Returns the average of cells that meet a criteria."},
            {"name": "TEXT", "category": "Text", "description": "Formats a number and converts it to text."},
            {"name": "VALUE", "category": "Text", "description": "Converts a text string that represents a number to a number."},
            {"name": "SUBSTITUTE", "category": "Text", "description": "Replaces existing text with new text."},
            {"name": "FIND", "category": "Text", "description": "Finds one text value within another."},
            {"name": "SEARCH", "category": "Text", "description": "Finds one text value within another (case-insensitive)."},
            {"name": "SPLIT", "category": "Text", "description": "Splits text around a delimiter into a row array."},
        ]
        return functions

    def get_function_info(self, name: str) -> Optional[Dict[str, Any]]:
        """Return info for a specific function, or None if not found."""
        catalog = self.get_function_catalog()
        name_upper = name.upper()
        for fn in catalog:
            if fn["name"].upper() == name_upper:
                return fn
        return None

    # ------------------------------------------------------------------
    # Workbook-level collection methods
    # ------------------------------------------------------------------

    def get_all_tables(self) -> List[Dict[str, Any]]:
        """Return all tables across all sheets."""
        tables = []
        seen_names: set = set()
        for sid in self._bridge.get_sheet_order():
            sid_json = _ensure_json_quoted(sid)
            try:
                sheet_tables = self._bridge.get_all_tables_in_sheet(sid_json)
                if isinstance(sheet_tables, list):
                    for t in sheet_tables:
                        if isinstance(t, dict):
                            name = t.get("name")
                            if name:
                                seen_names.add(name)
                            tables.append(t)
                        else:
                            tables.append(t)
            except Exception:
                pass
        # Also include locally-cached tables from worksheet TablesAPIs
        for ws in self._sheet_cache.values():
            if hasattr(ws, "_tables_api") and ws._tables_api is not None:
                for name, t in ws._tables_api._local_tables.items():
                    if name not in seen_names:
                        tables.append(t)
                        seen_names.add(name)
        return tables

    def get_all_pivot_tables(self) -> List[Dict[str, Any]]:
        """Return all pivot tables across all sheets."""
        try:
            result = self._bridge.call_json("compute_get_all_pivot_tables_workbook")
            if isinstance(result, list):
                # Flatten: [{sheetId, pivot: {name, ...}}] -> [{name, sheetId, ...}]
                flat = []
                for item in result:
                    if isinstance(item, dict) and "pivot" in item:
                        entry = dict(item["pivot"])
                        entry["sheetId"] = item.get("sheetId")
                        flat.append(entry)
                    else:
                        flat.append(item)
                return flat
        except Exception:
            pass
        return []

    def get_all_slicers(self) -> List[Dict[str, Any]]:
        """Return all slicers across all sheets."""
        try:
            result = self._bridge.call_json("compute_get_all_slicers_workbook")
            if isinstance(result, list):
                # Flatten: [{sheetId, slicer: {name, ...}}] -> [{name, sheetId, ...}]
                flat = []
                for item in result:
                    if isinstance(item, dict) and "slicer" in item:
                        entry = dict(item["slicer"])
                        entry["sheetId"] = item.get("sheetId")
                        flat.append(entry)
                    else:
                        flat.append(item)
                # Ensure each slicer has a 'name' field (engine may only store 'caption')
                for s in flat:
                    if isinstance(s, dict) and "name" not in s:
                        s["name"] = s.get("caption", s.get("id", ""))
                return flat
        except Exception:
            pass
        return []

    def get_all_comments(self) -> List[Dict[str, Any]]:
        """Return all comments across all sheets."""
        try:
            result = self._bridge.call_json("compute_get_all_comments_workbook")
            if isinstance(result, list):
                return result
        except Exception:
            pass
        comments = []
        for sid in self._bridge.get_sheet_order():
            sid_json = _ensure_json_quoted(sid)
            try:
                sheet_comments = self._bridge.get_all_comments(sid_json)
                if isinstance(sheet_comments, list):
                    comments.extend(sheet_comments)
            except Exception:
                pass
        return comments

    def get_workbook_snapshot(self) -> Dict[str, Any]:
        """Return a snapshot dict of the entire workbook state.

        Includes sheet names, data bounds, and cell data for each sheet.
        """
        snapshot: Dict[str, Any] = {"sheets": []}
        sheet_ids = self._bridge.get_sheet_order()
        for sid in sheet_ids:
            sid_json = _ensure_json_quoted(sid)
            name = self._bridge.get_sheet_name(sid_json) or sid
            bounds_raw = self._bridge.get_data_bounds(sid_json)
            sheet_info: Dict[str, Any] = {"id": sid, "name": name, "cells": {}}
            if bounds_raw and isinstance(bounds_raw, dict):
                min_r = bounds_raw.get("minRow", bounds_raw.get("min_row", 0))
                min_c = bounds_raw.get("minCol", bounds_raw.get("min_col", 0))
                max_r = bounds_raw.get("maxRow", bounds_raw.get("max_row", 0))
                max_c = bounds_raw.get("maxCol", bounds_raw.get("max_col", 0))
                sheet_info["bounds"] = {
                    "minRow": min_r, "minCol": min_c,
                    "maxRow": max_r, "maxCol": max_c,
                }
                cell_count = 0
                for r in range(min_r, max_r + 1):
                    for c in range(min_c, max_c + 1):
                        raw = self._bridge.get_raw_value(sid_json, r, c)
                        if raw is not None and raw != "":
                            from mog._serde import _col_to_a1
                            addr = f"{_col_to_a1(c)}{r + 1}"
                            sheet_info["cells"][addr] = raw
                            cell_count += 1
                sheet_info["cellCount"] = cell_count
                from mog._serde import _col_to_a1
                sheet_info["usedRange"] = (
                    f"{_col_to_a1(min_c)}{min_r + 1}:{_col_to_a1(max_c)}{max_r + 1}"
                )
            else:
                sheet_info["cellCount"] = 0
                sheet_info["usedRange"] = None
            snapshot["sheets"].append(sheet_info)
        return snapshot

    def describe_ranges(self, queries: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        """Batch-describe multiple ranges across multiple sheets.

        Parameters
        ----------
        queries:
            List of dicts, each with ``sheet`` (sheet name) and ``range`` (A1 range).

        Returns a list of result dicts, each with ``sheet``, ``description``,
        and optionally ``error`` keys.
        """
        results: List[Dict[str, Any]] = []
        for q in queries:
            sheet_name = q.get("sheet", "")
            range_ref = q.get("range", "")
            try:
                ws = self.get_sheet_by_name(sheet_name)
                desc = ws.describe_range(range_ref)
                results.append({"sheet": sheet_name, "description": desc})
            except Exception as exc:
                results.append({"sheet": sheet_name, "description": "", "error": str(exc)})
        return results

    def to_buffer(self) -> bytes:
        """Export the workbook as an XLSX-like bytes buffer.

        Returns a bytes object.  If the native engine does not support
        export, returns a minimal valid ZIP (empty XLSX placeholder).
        """
        xlsx_bytes: Optional[bytes] = None
        try:
            result = self._bridge.call("compute_export_to_xlsx_bytes")
            if isinstance(result, bytes):
                xlsx_bytes = result
        except Exception:
            pass

        if xlsx_bytes is None:
            # Return a minimal valid ZIP file as a placeholder
            import io
            import zipfile
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(
                    "[Content_Types].xml",
                    '<?xml version="1.0" encoding="UTF-8"?>'
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    '<Default Extension="xml" ContentType="application/xml"/>'
                    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                    '</Types>',
                )
            return buf.getvalue()

        # Inject pivot table XML into the XLSX if pivots exist but aren't
        # already in the archive.
        xlsx_bytes = self._inject_pivot_xml(xlsx_bytes)
        return xlsx_bytes

    def _inject_pivot_xml(self, xlsx_bytes: bytes) -> bytes:
        """Add pivot table and pivot cache XML to an XLSX buffer if needed."""
        import io
        import zipfile

        # Gather all pivots from all sheets
        all_pivots: list = []
        for sid in self._bridge.get_sheet_order():
            sid_json = _ensure_json_quoted(sid)
            try:
                result = self._bridge.call_json("compute_pivot_get_all", sid_json)
                if isinstance(result, list):
                    for p in result:
                        if isinstance(p, dict):
                            all_pivots.append(p)
            except Exception:
                pass

        if not all_pivots:
            return xlsx_bytes

        # Check if the XLSX already has pivot tables
        try:
            with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as zf:
                names = zf.namelist()
                if any("pivotTable" in n for n in names):
                    return xlsx_bytes  # Already has pivots
        except Exception:
            return xlsx_bytes

        # Inject pivot XML
        try:
            src = io.BytesIO(xlsx_bytes)
            dst = io.BytesIO()
            with zipfile.ZipFile(src, "r") as zf_in, \
                 zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zf_out:
                # Copy all existing entries
                for item in zf_in.infolist():
                    data = zf_in.read(item.filename)
                    # Patch [Content_Types].xml to include pivot content types
                    if item.filename == "[Content_Types].xml":
                        data = self._patch_content_types_for_pivots(
                            data, len(all_pivots)
                        )
                    zf_out.writestr(item, data)

                # Add pivot cache and pivot table entries
                for idx, pivot in enumerate(all_pivots, start=1):
                    cache_xml = self._build_pivot_cache_xml(pivot)
                    table_xml = self._build_pivot_table_xml(pivot)
                    cache_rels = self._build_pivot_cache_rels(idx)

                    zf_out.writestr(
                        f"xl/pivotCache/pivotCacheDefinition{idx}.xml",
                        cache_xml,
                    )
                    zf_out.writestr(
                        f"xl/pivotCache/pivotCacheRecords{idx}.xml",
                        self._build_pivot_cache_records_xml(),
                    )
                    zf_out.writestr(
                        f"xl/pivotCache/_rels/pivotCacheDefinition{idx}.xml.rels",
                        cache_rels,
                    )
                    zf_out.writestr(
                        f"xl/pivotTables/pivotTable{idx}.xml",
                        table_xml,
                    )
                    zf_out.writestr(
                        f"xl/pivotTables/_rels/pivotTable{idx}.xml.rels",
                        self._build_pivot_table_rels(idx),
                    )

            return dst.getvalue()
        except Exception:
            return xlsx_bytes

    @staticmethod
    def _patch_content_types_for_pivots(data: bytes, count: int) -> bytes:
        """Patch [Content_Types].xml to add pivot content types."""
        text = data.decode("utf-8")
        pivot_types = ""
        for i in range(1, count + 1):
            pivot_types += (
                f'<Override PartName="/xl/pivotTables/pivotTable{i}.xml" '
                f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>'
            )
            pivot_types += (
                f'<Override PartName="/xl/pivotCache/pivotCacheDefinition{i}.xml" '
                f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>'
            )
            pivot_types += (
                f'<Override PartName="/xl/pivotCache/pivotCacheRecords{i}.xml" '
                f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>'
            )
        # Insert before closing </Types>
        text = text.replace("</Types>", pivot_types + "</Types>")
        return text.encode("utf-8")

    @staticmethod
    def _build_pivot_cache_xml(pivot: dict) -> str:
        """Build a minimal pivotCacheDefinition XML."""
        source_sheet = pivot.get("sourceSheetName", "Sheet1")
        sr = pivot.get("sourceRange", {})
        if isinstance(sr, dict):
            from mog.sub_apis.pivots import _index_to_col
            start_col = _index_to_col(sr.get("startCol", 0))
            start_row = sr.get("startRow", 0) + 1
            end_col = _index_to_col(sr.get("endCol", 0))
            end_row = sr.get("endRow", 0) + 1
            ref = f"'{source_sheet}'!${start_col}${start_row}:${end_col}${end_row}"
        else:
            ref = f"'{source_sheet}'!$A$1:$A$1"

        fields_xml = ""
        fields = pivot.get("fields", [])
        for f in (fields if isinstance(fields, list) else []):
            name = f.get("name", "") if isinstance(f, dict) else str(f)
            fields_xml += f'<cacheField name="{name}" numFmtId="0"/>'

        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
            f'r:id="rId1" refreshOnLoad="1">'
            f'<cacheSource type="worksheet"><worksheetSource ref="{ref}"/></cacheSource>'
            f'<cacheFields count="{len(fields)}">{fields_xml}</cacheFields>'
            '</pivotCacheDefinition>'
        )

    @staticmethod
    def _build_pivot_table_xml(pivot: dict) -> str:
        """Build a minimal pivotTable XML."""
        name = pivot.get("name", "PivotTable1")
        fields = pivot.get("fields", [])
        placements = pivot.get("placements", [])

        # pivotFields
        pf_xml = ""
        row_indices = []
        data_indices = []
        for i, f in enumerate(fields if isinstance(fields, list) else []):
            fname = f.get("name", "") if isinstance(f, dict) else str(f)
            area = None
            agg = None
            for p in (placements if isinstance(placements, list) else []):
                if isinstance(p, dict) and p.get("fieldId") == fname:
                    area = p.get("area")
                    agg = p.get("aggregateFunction", "sum")
                    break
            if area == "row":
                pf_xml += f'<pivotField axis="axisRow" showAll="0"/>'
                row_indices.append(i)
            elif area == "value":
                pf_xml += '<pivotField dataField="1" showAll="0"/>'
                data_indices.append((i, fname, agg or "sum"))
            else:
                pf_xml += '<pivotField showAll="0"/>'

        # rowFields
        rf_xml = ""
        if row_indices:
            rf_xml = f'<rowFields count="{len(row_indices)}">'
            for ri in row_indices:
                rf_xml += f'<field x="{ri}"/>'
            rf_xml += '</rowFields>'

        # dataFields
        df_xml = ""
        if data_indices:
            df_xml = f'<dataFields count="{len(data_indices)}">'
            for di, dname, dagg in data_indices:
                df_xml += f'<dataField name="Sum of {dname}" fld="{di}" subtotal="{dagg}"/>'
            df_xml += '</dataFields>'

        out_loc = pivot.get("outputLocation", {})
        loc_ref = ""
        if isinstance(out_loc, dict):
            from mog.sub_apis.pivots import _index_to_col
            loc_ref = f'{_index_to_col(out_loc.get("col", 0))}{out_loc.get("row", 0) + 1}'

        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            f'name="{name}" cacheId="1" dataOnRows="1" '
            f'applyNumberFormats="0" applyBorderFormats="0" '
            f'applyFontFormats="0" applyPatternFormats="0" '
            f'applyAlignmentFormats="0" applyWidthHeightFormats="1" '
            f'location="{loc_ref}">'
            f'<pivotFields count="{len(fields)}">{pf_xml}</pivotFields>'
            f'{rf_xml}{df_xml}'
            '</pivotTableDefinition>'
        )

    @staticmethod
    def _build_pivot_cache_records_xml() -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'count="0"/>'
        )

    @staticmethod
    def _build_pivot_cache_rels(idx: int) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" '
            f'Target="pivotCacheRecords{idx}.xml"/>'
            '</Relationships>'
        )

    @staticmethod
    def _build_pivot_table_rels(idx: int) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" '
            f'Target="../pivotCache/pivotCacheDefinition{idx}.xml"/>'
            '</Relationships>'
        )

    @property
    def bindings(self):
        """Data bindings sub-API."""
        return _BindingsStub()

    # ------------------------------------------------------------------
    # Sub-APIs (lazy properties)
    # ------------------------------------------------------------------

    @property
    def history(self) -> HistoryAPI:
        """Undo/redo operations."""
        if self._history_api is None:
            from mog.sub_apis.history import HistoryAPI
            self._history_api = HistoryAPI(self._bridge, self)
        return self._history_api

    @property
    def sheets(self) -> SheetsAPI:
        """Sheet CRUD operations (add, remove, rename, copy, hide/show)."""
        if self._sheets_api is None:
            from mog.sub_apis.sheets import SheetsAPI
            self._sheets_api = SheetsAPI(self._bridge, self)
        return self._sheets_api

    @property
    def names(self) -> NamesAPI:
        """Named range management."""
        if self._names_api is None:
            from mog.sub_apis.names import NamesAPI
            self._names_api = NamesAPI(self._bridge)
        return self._names_api

    @property
    def settings(self) -> SettingsAPI:
        """Workbook settings (calculation mode, culture, etc.)."""
        if self._settings_api is None:
            from mog.sub_apis.settings import SettingsAPI
            self._settings_api = SettingsAPI(self._bridge)
        return self._settings_api

    @property
    def viewport(self) -> _ViewportAPI:
        """Viewport subscription sub-API."""
        if self._viewport_api is None:
            self._viewport_api = _ViewportAPI()
        return self._viewport_api

    @property
    def protection(self) -> _ProtectionAPI:
        """Workbook-level protection sub-API."""
        if self._protection_api is None:
            self._protection_api = _ProtectionAPI(self._bridge)
        return self._protection_api

    @property
    def styles(self) -> _StylesAPI:
        """Workbook-level styles sub-API."""
        if self._styles_api is None:
            self._styles_api = _StylesAPI(self._bridge)
        return self._styles_api

    @property
    def slicers(self) -> _WorkbookSlicersAPI:
        """Workbook-level slicer operations (list all slicers across sheets)."""
        if self._slicers_api is None:
            self._slicers_api = _WorkbookSlicersAPI(self)
        return self._slicers_api

    @property
    def security(self) -> "SecurityAPI":
        """Data-access control sub-API (R5.3).

        Forwards every call to the flat ``wb_security_*`` bridge methods
        on the Rust side. All policy logic lives in Rust — the Python
        side is a thin adapter.
        """
        if self._security_api is None:
            from mog.sub_apis.security import SecurityAPI
            self._security_api = SecurityAPI(self._bridge)
        return self._security_api

    # ------------------------------------------------------------------
    # Principal / session state
    # ------------------------------------------------------------------

    def set_active_principal(self, tags: Optional[List[str]] = None) -> None:
        """Set the active principal for this session.

        ``tags`` is a list of string tag values; passing ``None`` clears
        the active principal. Tags are interned through the Rust pool so
        the matrix cache keys on pointer identity remain sound.
        """
        # Rust `set_active_principal(tags: Option<Vec<String>>)` takes a flat
        # tag list; the pool intern happens engine-side. Sending the tag list
        # directly avoids a second intern round-trip.
        payload = None if tags is None else list(tags)
        self._bridge.call("compute_set_active_principal", json.dumps(payload))

    def make_principal(self, tags: List[str]) -> Dict[str, List[str]]:
        """Return a Rust-interned :class:`Principal` as a dict.

        The Rust side returns the canonical (sorted, deduped) tag list;
        we re-wrap it as ``{"tags": [...]}`` so the SDK surface matches
        :class:`mog.sub_apis.security.Principal` — the SDK exposes a
        ``Principal`` as an envelope, not a bare list.
        """
        result = self._bridge.call_json("compute_make_principal", json.dumps(list(tags)))
        canonical = result if isinstance(result, list) else list(tags)
        return {"tags": canonical}

    def security_active(self) -> bool:
        """Return ``True`` iff the document has at least one policy."""
        return bool(self._bridge.call("compute_security_active"))

    def drain_security_events(self) -> List[Dict[str, Any]]:
        """Drain pending security events and fan them out to subscribers.

        Security events are emitted by the Rust engine on policy CRUD and
        access denial. The SDK's event bus is pull-based today (the Rust
        side cannot push across FFI without new bridge scaffolding), so
        callers that want to observe security events should poll this
        method on a cadence that matches their UI update rate.

        Each drained event is also dispatched through the standard
        ``wb.on`` event bus using the event name ``"security:<kind>"``.
        """
        events = self.security.drain_events()
        for evt in events:
            kind = evt.get("kind", "unknown")
            self._fire_event(f"security:{kind}", evt)
        return events

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def dispose(self) -> None:
        """Release the underlying engine resources.

        After calling this, any further operations on the workbook or
        its worksheets will raise an error.
        """
        self._sheet_cache.clear()
        # The engine will be dropped when the Python object is garbage collected.
        # This is a hint to release resources early.
        self._bridge._engine = None  # type: ignore[assignment]

    def __repr__(self) -> str:
        try:
            names = self.sheet_names
        except Exception:
            names = ["?"]
        return f"Workbook(sheets={names})"


class _HookedBridge:
    """A proxy around Bridge that fires cell:changed events on the workbook."""

    def __init__(self, bridge: Bridge, workbook: Workbook) -> None:
        object.__setattr__(self, '_real_bridge', bridge)
        object.__setattr__(self, '_workbook', workbook)

    def set_cell_value_parsed(self, sheet_id_json, row, col, input_str):
        result = self._real_bridge.set_cell_value_parsed(sheet_id_json, row, col, input_str)
        wb = self._workbook
        wb._fire_event("cell:changed", {
            "type": "cell:changed",
            "sheetId": sheet_id_json,
            "row": row,
            "col": col,
        })
        return result

    def __getattr__(self, name):
        return getattr(self._real_bridge, name)


class _NotificationsAPI:
    """Full notifications sub-API with info/warn/error/success/notify/subscribe/dismiss."""

    def __init__(self):
        self._notifications: List[Dict[str, Any]] = []
        self._subscribers: List[Callable] = []

    def _add(self, level: str, message: str) -> str:
        nid = uuid.uuid4().hex
        notif = {"id": nid, "level": level, "message": message}
        self._notifications.append(notif)
        self._notify_subscribers()
        return nid

    def _notify_subscribers(self):
        snapshot = list(self._notifications)
        for sub in self._subscribers:
            try:
                sub(snapshot)
            except Exception:
                pass

    def info(self, message: str) -> str:
        return self._add("info", message)

    def success(self, message: str) -> str:
        return self._add("success", message)

    def warning(self, message: str) -> str:
        return self._add("warning", message)

    def warn(self, message: str) -> str:
        return self._add("warning", message)

    def error(self, message: str) -> str:
        return self._add("error", message)

    def notify(self, message: str, level: str = "info") -> str:
        return self._add(level, message)

    def get_all(self) -> List[Dict[str, Any]]:
        return list(self._notifications)

    def list(self) -> List[Dict[str, Any]]:
        return self.get_all()

    def dismiss(self, notification_id: str) -> None:
        self._notifications = [n for n in self._notifications if n["id"] != notification_id]

    def dismiss_all(self) -> None:
        self._notifications.clear()

    def clear(self) -> None:
        self.dismiss_all()

    def subscribe(self, handler: Callable) -> Callable:
        self._subscribers.append(handler)

        def unsubscribe():
            try:
                self._subscribers.remove(handler)
            except ValueError:
                pass

        return unsubscribe

    def __bool__(self):
        return len(self._notifications) > 0

    def __iter__(self):
        return iter(self._notifications)


class _NotificationsStub(_NotificationsAPI):
    """Backward-compatible alias."""
    pass


class _BindingsStub:
    """Stub bindings sub-API so ``wb.bindings`` doesn't crash."""

    def list(self):
        return []

    def add(self, *args, **kwargs):
        return None

    def remove(self, *args, **kwargs):
        pass

    def __bool__(self):
        return False

    def __iter__(self):
        return iter([])


class _ThemeStub:
    """Stub theme sub-API so ``wb.theme`` doesn't crash."""

    def __init__(self):
        self._colors = {
            "dk1": "000000",
            "lt1": "FFFFFF",
            "dk2": "44546A",
            "lt2": "E7E6E6",
            "accent1": "4472C4",
            "accent2": "ED7D31",
            "accent3": "A5A5A5",
            "accent4": "FFC000",
            "accent5": "5B9BD5",
            "accent6": "70AD47",
            "hlink": "0563C1",
            "folHlink": "954F72",
        }
        self._fonts = {
            "majorFont": "Calibri Light",
            "minorFont": "Calibri",
        }
        self._table_styles: List[Dict[str, Any]] = [
            {"name": "TableStyleMedium2", "pivot": False},
            {"name": "TableStyleMedium9", "pivot": False},
            {"name": "TableStyleLight1", "pivot": False},
        ]

    def get(self) -> Dict[str, Any]:
        return {
            "name": "Office",
            "colors": dict(self._colors),
            "fonts": dict(self._fonts),
        }

    def get_colors(self) -> Dict[str, str]:
        return dict(self._colors)

    def get_fonts(self) -> Dict[str, str]:
        return dict(self._fonts)

    def list_table_styles(self) -> List[Dict[str, Any]]:
        return list(self._table_styles)

    def set_colors(self, colors: Dict[str, str]) -> None:
        self._colors.update(colors)

    def set_fonts(self, fonts: Dict[str, str]) -> None:
        self._fonts.update(fonts)


class _ViewportAPI:
    """Viewport subscription sub-API."""

    def __init__(self):
        self._subscribers: List[Callable] = []

    def subscribe(self, handler: Callable) -> Callable:
        """Subscribe to viewport changes. Returns an unsubscribe function."""
        self._subscribers.append(handler)

        def unsubscribe():
            try:
                self._subscribers.remove(handler)
            except ValueError:
                pass

        return unsubscribe

    def create_region(self, sheet_id: str, bounds: Dict[str, Any]) -> Any:
        """Create a viewport region (stub). Returns a disposable region."""

        class _Region:
            def dispose(self):
                pass

        return _Region()

    def unsubscribe_all(self) -> None:
        self._subscribers.clear()


class _ProtectionAPI:
    """Workbook-level protection sub-API."""

    def __init__(self, bridge: Any = None):
        self._bridge = bridge
        self._protected = False
        self._password: Optional[str] = None

    def protect(self, password: Optional[str] = None) -> bool:
        """Protect the workbook structure."""
        self._protected = True
        self._password = password
        if self._bridge:
            try:
                self._bridge.call_json("compute_protect_workbook", json.dumps(password or ""))
            except Exception:
                pass
        return True

    def unprotect(self, password: Optional[str] = None) -> bool:
        """Unprotect the workbook structure."""
        if self._password is not None and password != self._password:
            return False
        self._protected = False
        self._password = None
        if self._bridge:
            try:
                self._bridge.call_json("compute_unprotect_workbook", json.dumps(password or ""))
            except Exception:
                pass
        return True

    def is_protected(self) -> bool:
        return self._protected


class _StylesAPI:
    """Workbook-level styles sub-API."""

    def __init__(self, bridge: Any = None):
        self._bridge = bridge

    def get_table_styles(self) -> List[Dict[str, Any]]:
        """Return a list of available table styles."""
        if self._bridge:
            try:
                result = self._bridge.call_json("compute_get_all_custom_table_styles")
                if isinstance(result, list):
                    return result
            except Exception:
                pass
        # Return default styles
        return [
            {"name": "TableStyleMedium2", "pivot": False},
            {"name": "TableStyleMedium9", "pivot": False},
            {"name": "TableStyleLight1", "pivot": False},
        ]


class _WorkbookSlicersAPI:
    """Workbook-level slicer operations — thin wrapper around ``Workbook.get_all_slicers``."""

    __slots__ = ("_wb",)

    def __init__(self, wb: Workbook) -> None:
        self._wb = wb

    def list(self) -> List[Dict[str, Any]]:
        """Return all slicers across all sheets."""
        return self._wb.get_all_slicers()
