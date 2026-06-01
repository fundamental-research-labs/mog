"""Floating object APIs that are not production-backed in the Python SDK yet."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._unsupported import unsupported_proxy_from_surface, unsupported_python_path

if TYPE_CHECKING:
    from mog._bridge import Bridge
    from mog.types import MutationResult


class FloatingObjectHandle(dict[str, Any]):
    """A floating-object handle kept only for source compatibility."""

    __slots__ = ("_api",)

    def __init__(self, data: Dict[str, Any], api: "ObjectsAPI") -> None:
        super().__init__(data)
        self._api = api

    def duplicate(self) -> "FloatingObjectHandle":
        unsupported_python_path(f"{self._api._python_prefix}.duplicate")

    def delete(self) -> "MutationResult":
        unsupported_python_path(f"{self._api._python_prefix}.delete")

    def update(self, updates: Dict[str, Any]) -> "MutationResult":
        unsupported_python_path(f"{self._api._python_prefix}.update")


class ObjectsAPI:
    """Floating object operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_python_prefix")

    def __init__(
        self,
        bridge: Bridge,
        sheet_id_json: str,
        python_prefix: str = "ws.objects",
    ) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._python_prefix = python_prefix

    def __getattr__(self, name: str) -> Any:
        return unsupported_proxy_from_surface(
            self._python_prefix,
            self._python_prefix,
        ).__getattr__(name)

    def __dir__(self) -> list[str]:
        proxy = unsupported_proxy_from_surface(self._python_prefix, self._python_prefix)
        return sorted(set(super().__dir__()) | set(dir(proxy)))

    def create(self, config: Dict[str, Any]) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.create")

    def add(self, config: Dict[str, Any]) -> FloatingObjectHandle:
        unsupported_python_path(f"{self._python_prefix}.add")

    def delete(self, object_id: str) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.delete")

    def delete_many(self, object_ids: List[str]) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.delete_many")

    def list(self) -> List[FloatingObjectHandle]:
        unsupported_python_path(f"{self._python_prefix}.list")

    def get(self, object_id: str) -> Optional[FloatingObjectHandle]:
        unsupported_python_path(f"{self._python_prefix}.get")

    def update(self, object_id: str, updates: Dict[str, Any]) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.update")

    def duplicate(self, object_id: str) -> FloatingObjectHandle:
        unsupported_python_path(f"{self._python_prefix}.duplicate")

    def group(self, object_ids: List[str]) -> Any:
        unsupported_python_path(f"{self._python_prefix}.group")

    def ungroup(self, group_id: str) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.ungroup")

    def bring_to_front(self, object_id: str) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.bring_to_front")

    def send_to_back(self, object_id: str) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.send_to_back")

    def bring_forward(self, object_id: str) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.bring_forward")

    def send_backward(self, object_id: str) -> "MutationResult":
        unsupported_python_path(f"{self._python_prefix}.send_backward")
