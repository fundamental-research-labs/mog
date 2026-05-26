"""Hyperlink operations -- ``ws.hyperlinks.set()``, ``ws.hyperlinks.get()``."""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Dict, Optional, Tuple, Union

from mog._serde import deserialize_mutation_result, parse_a1
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class HyperlinksAPI:
    """Hyperlink operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    @staticmethod
    def _resolve_address(address: Union[str, Tuple[int, int]]) -> Tuple[int, int]:
        if isinstance(address, tuple):
            return address
        return parse_a1(address)

    def set(
        self,
        address: Union[str, Tuple[int, int]],
        url: str,
        display: Optional[str] = None,
        tooltip: Optional[str] = None,
    ) -> MutationResult:
        """Set a hyperlink on a cell.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        url:
            The hyperlink URL or reference.
        display:
            Optional display text (defaults to the URL).
        tooltip:
            Optional tooltip text.
        """
        row, col = self._resolve_address(address)
        link = {"url": url}
        if display is not None:
            link["display"] = display
        if tooltip is not None:
            link["tooltip"] = tooltip
        raw = self._bridge.call_json(
            "compute_set_hyperlink",
            self._sheet_id_json,
            row,
            col,
            json.dumps(link),
        )
        return deserialize_mutation_result(raw)

    def get(self, address: Union[str, Tuple[int, int]]) -> Optional[str]:
        """Get the hyperlink URL at a cell, or ``None`` if none exists.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.

        Returns the URL string, or ``None``.

        .. note::
            This matches the TypeScript SDK which returns ``string | null``.
            Use :meth:`get_full` to get the full dict with ``url``, ``display``,
            ``tooltip`` keys.
        """
        row, col = self._resolve_address(address)
        result = self._bridge.call_json(
            "compute_get_hyperlink", self._sheet_id_json, row, col
        )
        if isinstance(result, dict):
            url = result.get("url") or result.get("target")
            return url if url else None
        # Handle double-encoded JSON strings
        if isinstance(result, str) and result.startswith("{"):
            try:
                parsed = json.loads(result)
                if isinstance(parsed, dict):
                    url = parsed.get("url") or parsed.get("target")
                    return url if url else None
            except (json.JSONDecodeError, TypeError):
                pass
        if isinstance(result, str) and result:
            return result
        return None

    def get_full(self, address: Union[str, Tuple[int, int]]) -> Optional[Dict[str, Any]]:
        """Get the full hyperlink dict at a cell, or ``None`` if none exists.

        Returns a dict with ``url``, ``display``, ``tooltip`` keys when present.
        """
        row, col = self._resolve_address(address)
        result = self._bridge.call_json(
            "compute_get_hyperlink", self._sheet_id_json, row, col
        )
        if isinstance(result, dict):
            return result
        if isinstance(result, str) and result.startswith("{"):
            try:
                parsed = json.loads(result)
                if isinstance(parsed, dict):
                    return parsed
            except (json.JSONDecodeError, TypeError):
                pass
        return None

    def add(
        self,
        address: Union[str, Tuple[int, int]],
        link_or_url: Union[str, Dict[str, Any], None] = None,
        display: Optional[str] = None,
        tooltip: Optional[str] = None,
    ) -> MutationResult:
        """Add a hyperlink to a cell (alias for :meth:`set`).

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        link_or_url:
            Either a URL string or a dict with ``url``, ``display``, ``tooltip`` keys.
        display:
            Optional display text (used when *link_or_url* is a string).
        tooltip:
            Optional tooltip text (used when *link_or_url* is a string).
        """
        if isinstance(link_or_url, dict):
            url = link_or_url.get("url", "")
            display = link_or_url.get("display", display)
            tooltip = link_or_url.get("tooltip", tooltip)
        else:
            url = link_or_url or ""
        return self.set(address, url, display=display, tooltip=tooltip)

    def remove(self, address: Union[str, Tuple[int, int]]) -> MutationResult:
        """Remove the hyperlink from a cell.

        Parameters
        ----------
        address:
            A1 address or ``(row, col)`` tuple.
        """
        row, col = self._resolve_address(address)
        raw = self._bridge.call_json(
            "compute_remove_hyperlink", self._sheet_id_json, row, col
        )
        return deserialize_mutation_result(raw)
