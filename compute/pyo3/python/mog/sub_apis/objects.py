"""Floating object (shapes, images) operations -- ``ws.objects.create()``, etc."""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from mog._serde import deserialize_mutation_result
from mog.types import MutationResult

if TYPE_CHECKING:
    from mog._bridge import Bridge


class FloatingObjectHandle(dict[str, Any]):
    """A dict subclass that also exposes convenience methods like ``duplicate()``.

    Instances behave exactly like a plain ``dict`` (``handle.get("id")``,
    ``handle["type"]``, iteration, etc.) but additionally carry a back-reference
    to the owning :class:`ObjectsAPI` so callers can do::

        obj = ws.shapes.list()[0]
        dup = obj.duplicate()
    """

    __slots__ = ("_api",)

    def __init__(self, data: Dict[str, Any], api: "ObjectsAPI") -> None:
        super().__init__(data)
        self._api = api

    def duplicate(self) -> "FloatingObjectHandle":
        """Duplicate this floating object. Returns a new handle."""
        result = self._api.duplicate(self["id"])
        if isinstance(result, FloatingObjectHandle):
            return result
        return FloatingObjectHandle(result, self._api)

    def delete(self) -> MutationResult:
        """Delete this floating object."""
        return self._api.delete(self["id"])

    def update(self, updates: Dict[str, Any]) -> MutationResult:
        """Update this floating object's properties."""
        return self._api.update(self["id"], updates)


class ObjectsAPI:
    """Floating object (shapes, images, etc.) CRUD operations on a worksheet."""

    __slots__ = ("_bridge", "_sheet_id_json", "_local_objects", "_deleted_ids")

    def __init__(self, bridge: Bridge, sheet_id_json: str) -> None:
        self._bridge = bridge
        self._sheet_id_json = sheet_id_json
        self._local_objects: Dict[str, Dict[str, Any]] = {}
        self._deleted_ids: set = set()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def _ensure_id(self, config: Dict[str, Any]) -> str:
        """Ensure config has an id and return it."""
        if "id" not in config:
            config["id"] = uuid.uuid4().hex[:16]
        return config["id"]

    def create(self, config: Dict[str, Any]) -> MutationResult:
        """Create a floating object (shape, image, etc.)."""
        obj_id = self._ensure_id(config)
        try:
            raw = self._bridge.call_json(
                "compute_create_floating_object",
                self._sheet_id_json,
                json.dumps(config),
            )
        except Exception:
            raw = None
        self._local_objects[obj_id] = dict(config)
        return deserialize_mutation_result(raw) if raw else {}

    def add(self, config: Dict[str, Any]) -> FloatingObjectHandle:
        """Add a floating object.

        Returns a :class:`FloatingObjectHandle` containing at least ``{"id": "..."}``.
        Uses ``compute_create_shape`` for shape types (rect, ellipse, etc.)
        and ``compute_create_floating_object`` for other types.
        """
        obj_type = config.get("type", "")
        shape_types = {"rect", "ellipse", "triangle", "diamond", "pentagon",
                       "hexagon", "star", "arrow", "line", "roundedRect",
                       "shape", "oval", "circle", "rectangle", "textbox"}

        if obj_type.lower() in shape_types:
            return self._wrap(self._add_via_engine(config))
        # Generic floating object (pictures, etc.)
        return self._wrap(self._add_generic(config))

    def _add_generic(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Create a generic floating object via the engine."""
        # Snapshot existing IDs before creation
        known_ids: set = set()
        try:
            existing = self._bridge.call_json(
                "compute_get_all_floating_objects_typed", self._sheet_id_json
            )
            if isinstance(existing, list):
                for obj in existing:
                    if isinstance(obj, dict) and obj.get("id"):
                        known_ids.add(obj["id"])
        except Exception:
            pass

        obj_id = self._ensure_id(config)
        engine_id = None
        try:
            raw = self._bridge.call_json(
                "compute_create_floating_object",
                self._sheet_id_json,
                json.dumps(config),
            )
            # Detect the engine-assigned ID
            if isinstance(raw, dict):
                data = raw.get("data")
                if isinstance(data, str):
                    engine_id = data
                elif isinstance(data, dict):
                    engine_id = data.get("id")
            if not engine_id:
                objects = self._bridge.call_json(
                    "compute_get_all_floating_objects_typed", self._sheet_id_json
                )
                if isinstance(objects, list):
                    for obj in objects:
                        if isinstance(obj, dict):
                            oid = obj.get("id", "")
                            if oid and oid not in known_ids and oid not in self._deleted_ids:
                                engine_id = oid
                                break
        except Exception:
            pass

        if engine_id:
            result = dict(config, id=engine_id)
        else:
            result = dict(config)
            self._local_objects[obj_id] = result
        return result

    def _add_via_engine(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Create a shape or picture via the appropriate engine method."""
        # Snapshot existing IDs before creation
        known_ids: set = set()
        try:
            existing = self._bridge.call_json(
                "compute_get_all_floating_objects_typed", self._sheet_id_json
            )
            if isinstance(existing, list):
                for obj in existing:
                    if isinstance(obj, dict) and obj.get("id"):
                        known_ids.add(obj["id"])
        except Exception:
            pass

        # Build engine-compatible config for shapes
        engine_config = {
            "shapeType": config.get("shapeType", config.get("type", "rect")),
            "anchorRow": config.get("anchorRow", config.get("row", 0)),
            "anchorCol": config.get("anchorCol", config.get("col", 0)),
            "xOffset": config.get("xOffset", config.get("x", 0)),
            "yOffset": config.get("yOffset", config.get("y", 0)),
            "width": config.get("width", 100),
            "height": config.get("height", 50),
        }
        # Copy extra fields
        for k in ("name", "text", "content", "fill", "stroke", "rotation", "src"):
            if k in config:
                engine_config[k] = config[k]

        engine_id = None
        try:
            raw = self._bridge.call_json(
                "compute_create_shape",
                self._sheet_id_json,
                json.dumps(engine_config),
            )
            if isinstance(raw, dict):
                data = raw.get("data")
                if isinstance(data, str):
                    engine_id = data
                elif isinstance(data, dict):
                    engine_id = data.get("id")
            # Look up the newly created object by diffing with known_ids
            if not engine_id:
                objects = self._bridge.call_json(
                    "compute_get_all_floating_objects_typed", self._sheet_id_json
                )
                if isinstance(objects, list):
                    for obj in objects:
                        if isinstance(obj, dict):
                            oid = obj.get("id", "")
                            if oid and oid not in known_ids and oid not in self._deleted_ids:
                                engine_id = oid
                                break
        except Exception:
            pass

        if engine_id:
            result = dict(config, id=engine_id)
            self._local_objects[engine_id] = result
        else:
            obj_id = self._ensure_id(config)
            result = dict(config)
            self._local_objects[obj_id] = result

        return result

    def delete(self, object_id: str) -> MutationResult:
        """Delete a floating object by ID."""
        try:
            raw = self._bridge.call_json(
                "compute_delete_floating_object",
                self._sheet_id_json,
                object_id,
            )
        except Exception:
            raw = None
        self._local_objects.pop(object_id, None)
        self._deleted_ids.add(object_id)
        return deserialize_mutation_result(raw) if raw else {}

    def delete_many(self, object_ids: List[str]) -> MutationResult:
        """Delete multiple floating objects at once."""
        raw = None
        for oid in object_ids:
            try:
                raw = self._bridge.call_json(
                    "compute_delete_floating_object",
                    self._sheet_id_json,
                    oid,
                )
            except Exception:
                pass
            self._local_objects.pop(oid, None)
            self._deleted_ids.add(oid)
        return deserialize_mutation_result(raw) if raw else {}

    @staticmethod
    def _is_user_object(obj: Dict[str, Any]) -> bool:
        """Check if an object is a user-created floating object (not a system drawing canvas)."""
        obj_type = obj.get("type", "")
        # Filter out the default drawing canvas object
        if obj_type == "drawing":
            return False
        # Accept shapes, pictures, groups, and other user-created types
        return True

    def _wrap(self, obj: Dict[str, Any]) -> FloatingObjectHandle:
        """Wrap a plain dict in a :class:`FloatingObjectHandle`."""
        if isinstance(obj, FloatingObjectHandle):
            return obj
        return FloatingObjectHandle(obj, self)

    def list(self) -> List[FloatingObjectHandle]:
        """Get all floating objects in this sheet."""
        # Try engine first, fall back to local
        try:
            result = self._bridge.call_json(
                "compute_get_all_floating_objects_typed", self._sheet_id_json
            )
            if isinstance(result, list):
                # Sync local cache, filtering out deleted and system objects
                filtered = []
                for obj in result:
                    if isinstance(obj, dict) and obj.get("id"):
                        oid = obj["id"]
                        if oid not in self._deleted_ids and self._is_user_object(obj):
                            # Preserve locally-stored type info (e.g. "textBox")
                            # that the engine may not return
                            if oid in self._local_objects:
                                local = self._local_objects[oid]
                                if local.get("type") and not obj.get("type"):
                                    obj["type"] = local["type"]
                            self._local_objects[oid] = obj
                            filtered.append(self._wrap(obj))
                # Also include local objects not returned by engine
                engine_ids = {o.get("id") for o in filtered if isinstance(o, dict)}
                for oid, obj in self._local_objects.items():
                    if oid not in engine_ids and oid not in self._deleted_ids and self._is_user_object(obj):
                        filtered.append(self._wrap(obj))
                return filtered
        except Exception:
            pass
        return [self._wrap(o) for o in self._local_objects.values()
                if o.get("id") not in self._deleted_ids and self._is_user_object(o)]

    def get(self, object_id: str) -> Optional[FloatingObjectHandle]:
        """Get a floating object by its ID."""
        # Check local cache first
        if object_id in self._local_objects:
            return self._wrap(self._local_objects[object_id])
        # Try engine
        try:
            result = self._bridge.call_json(
                "compute_get_floating_object_typed",
                self._sheet_id_json,
                object_id,
            )
            if isinstance(result, dict):
                return self._wrap(result)
        except Exception:
            pass
        # Search in list
        for obj in self.list():
            if isinstance(obj, dict) and obj.get("id") == object_id:
                return self._wrap(obj)
        return None

    def update(self, object_id: str, updates: Dict[str, Any]) -> MutationResult:
        """Update a floating object's properties."""
        try:
            raw = self._bridge.call_json(
                "compute_update_floating_object",
                self._sheet_id_json,
                object_id,
                json.dumps(updates),
            )
        except Exception:
            raw = None
        if object_id in self._local_objects:
            self._local_objects[object_id].update(updates)
        return deserialize_mutation_result(raw) if raw else {}

    def duplicate(self, object_id: str) -> FloatingObjectHandle:
        """Duplicate a floating object. Returns the new object handle."""
        try:
            raw = self._bridge.call_json(
                "compute_duplicate_floating_object_typed",
                self._sheet_id_json,
                object_id,
            )
            if isinstance(raw, dict):
                new_id = raw.get("id", uuid.uuid4().hex[:16])
                self._local_objects[new_id] = raw
                return self._wrap(raw)
        except Exception:
            pass
        # Fall back to local copy
        original = self._local_objects.get(object_id)
        if original:
            new_id = uuid.uuid4().hex[:16]
            new_obj = dict(original, id=new_id)
            self._local_objects[new_id] = new_obj
            return self._wrap(new_obj)
        return self._wrap({"id": uuid.uuid4().hex[:16]})

    # ------------------------------------------------------------------
    # Grouping
    # ------------------------------------------------------------------

    def group(self, object_ids: List[str]) -> Any:
        """Group multiple objects together. Returns the group ID string."""
        try:
            raw = self._bridge.call_json(
                "compute_create_floating_object_group",
                self._sheet_id_json,
                json.dumps(object_ids),
            )
            if isinstance(raw, dict):
                # Engine may return the group ID in data field or directly
                gid = raw.get("data") or raw.get("id") or raw.get("groupId")
                if isinstance(gid, str) and gid:
                    self._local_objects[gid] = {"id": gid, "type": "group", "members": object_ids}
                    return gid
            if isinstance(raw, str):
                self._local_objects[raw] = {"id": raw, "type": "group", "members": object_ids}
                return raw
            return raw
        except Exception:
            # Create a local group
            gid = uuid.uuid4().hex[:16]
            self._local_objects[gid] = {"id": gid, "type": "group", "members": object_ids}
            return gid

    def ungroup(self, group_id: str) -> MutationResult:
        """Ungroup a group of objects."""
        try:
            raw = self._bridge.call_json(
                "compute_delete_floating_object_group",
                self._sheet_id_json,
                group_id,
            )
            self._local_objects.pop(group_id, None)
            return deserialize_mutation_result(raw) if raw else {}
        except Exception:
            self._local_objects.pop(group_id, None)
            return {}

    # ------------------------------------------------------------------
    # Z-order
    # ------------------------------------------------------------------

    def bring_to_front(self, object_id: str) -> MutationResult:
        """Bring a floating object to the front of the z-order."""
        try:
            raw = self._bridge.call_json(
                "compute_bring_floating_object_to_front",
                self._sheet_id_json,
                object_id,
            )
            return deserialize_mutation_result(raw) if raw else {}
        except Exception:
            return {}

    def send_to_back(self, object_id: str) -> MutationResult:
        """Send a floating object to the back of the z-order."""
        try:
            raw = self._bridge.call_json(
                "compute_send_floating_object_to_back",
                self._sheet_id_json,
                object_id,
            )
            return deserialize_mutation_result(raw) if raw else {}
        except Exception:
            return {}

    def bring_forward(self, object_id: str) -> MutationResult:
        """Move a floating object one step forward in z-order."""
        try:
            raw = self._bridge.call_json(
                "compute_bring_floating_object_forward",
                self._sheet_id_json,
                object_id,
            )
            return deserialize_mutation_result(raw) if raw else {}
        except Exception:
            return {}

    def send_backward(self, object_id: str) -> MutationResult:
        """Move a floating object one step backward in z-order."""
        try:
            raw = self._bridge.call_json(
                "compute_send_floating_object_backward",
                self._sheet_id_json,
                object_id,
            )
            return deserialize_mutation_result(raw) if raw else {}
        except Exception:
            return {}
