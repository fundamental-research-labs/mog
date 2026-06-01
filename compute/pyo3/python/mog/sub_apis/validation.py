"""Data validation APIs that are not production-backed in Python yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple, Union

from mog._unsupported import UnsupportedSubApiMixin, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class ValidationAPI(UnsupportedSubApiMixin):
    """Data validation operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json")
    _UNSUPPORTED_ACCESSOR_API_PATH = "ws.validations"
    _UNSUPPORTED_ACCESSOR_PYTHON_PATH = "ws.validation"

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json

    def set(
        self,
        address: Union[str, Tuple[int, int]],
        rule: Dict[str, Any],
    ) -> None:
        unsupported_python_path("ws.validation.set")

    def get(
        self,
        address: Union[str, Tuple[int, int]],
    ) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.validation.get")

    def remove(
        self,
        address: Union[str, Tuple[int, int]],
    ) -> None:
        unsupported_python_path("ws.validation.remove")

    def list(self) -> List[Dict[str, Any]]:
        unsupported_python_path("ws.validation.list")

    def clear(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> None:
        unsupported_python_path("ws.validation.clear")

    def get_dropdown_items(
        self,
        address: Union[str, Tuple[int, int]],
    ) -> Optional[List[str]]:
        unsupported_python_path("ws.validation.get_dropdown_items")

    def get_errors_in_range(
        self,
        sr: int,
        sc: int,
        er: int,
        ec: int,
    ) -> List[Dict[str, Any]]:
        unsupported_python_path("ws.validation.get_errors_in_range")

    def set_schema(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
        schema: Dict[str, Any],
    ) -> "MutationResult":
        unsupported_python_path("ws.validation.set_schema")

    def get_schema(
        self,
        range_ref: Union[str, Tuple[int, int, int, int]],
    ) -> Optional[Dict[str, Any]]:
        unsupported_python_path("ws.validation.get_schema")

    def validate(
        self,
        address: Union[str, Tuple[int, int]],
        value: Any,
    ) -> Any:
        unsupported_python_path("ws.validation.validate")
