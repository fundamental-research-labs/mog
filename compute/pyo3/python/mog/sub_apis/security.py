"""Data-access control API (R5.3).

Thin facade over the flat ``wb_security_*`` methods exposed by the Rust
ComputeService. All policy logic lives in Rust — this module forwards
method calls and converts Python dicts / enum shorthands into the Rust
serde wire format.

Users call these via the ``wb.security`` lazy property on
:class:`mog.Workbook`::

    wb.security.add_policy({
        "principalTag": "agent:*",
        "target": {"kind": "workbook"},
        "level": "read",
        "priority": 0,
        "enabled": True,
        "metadata": {"createdBy": "user", "createdAt": 0},
    })
"""
from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

if TYPE_CHECKING:
    from mog._bridge import Bridge


# -----------------------------------------------------------------------------
# Lightweight Python-side helpers so callers don't have to hand-construct the
# wire form for common targets / templates. Not a substitute for the Rust types
# — just sugar over the JSON the bridge consumes.
# -----------------------------------------------------------------------------


class Target:
    """Factory for the three :class:`AccessTarget` wire shapes."""

    @staticmethod
    def workbook() -> Dict[str, Any]:
        return {"kind": "workbook"}

    @staticmethod
    def sheet(sheet_id: str) -> Dict[str, Any]:
        # camelCase keys match the Rust `AccessTarget` wire format
        # (#[serde(rename = "sheetId")] on `Sheet { sheet_id }`) which in
        # turn matches the legacy TS shape — R2.1 zero-migration.
        return {"kind": "sheet", "sheetId": sheet_id}

    @staticmethod
    def column(sheet_id: str, col_id: str) -> Dict[str, Any]:
        # Field order matches TS `AccessTarget.column`: `colId` before
        # `sheetId`. Key names are camelCase for legacy parity.
        return {"kind": "column", "colId": col_id, "sheetId": sheet_id}


class AccessLevel:
    """String constants matching the Rust ``AccessLevel`` serde rename.

    These are the exact strings the Rust wire format expects. Using a class
    rather than an Enum keeps the Python-side values JSON-identical to what
    the bridge encodes, avoiding a second conversion layer.
    """

    NONE = "none"
    STRUCTURE = "structure"
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"


class Template:
    """Factory for the three built-in template wire shapes."""

    @staticmethod
    def protect_workbook() -> Dict[str, Any]:
        return {"kind": "protect_workbook"}

    @staticmethod
    def protect_sheet(sheet_id: str) -> Dict[str, Any]:
        return {"kind": "protect_sheet", "sheet_id": sheet_id}

    @staticmethod
    def agent_structure(tag_pattern: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"kind": "agent_structure"}
        if tag_pattern is not None:
            payload["tag_pattern"] = tag_pattern
        return payload


class Principal:
    """Factory for a principal dict — internally the Rust side will intern it
    through ``make_principal`` so pointer-identity caching stays sound."""

    @staticmethod
    def from_tags(tags: List[str]) -> Dict[str, List[str]]:
        return {"tags": list(tags)}


# -----------------------------------------------------------------------------
# Forwarder class wired to the bridge
# -----------------------------------------------------------------------------


class SecurityAPI:
    """Forwarder over ``wb_security_*`` flat bridge methods.

    One thin method per Rust bridge method. Each one JSON-encodes its
    arguments and returns the Rust payload as-is — no Python-side policy
    evaluation, no caching, no state.
    """

    def __init__(self, bridge: "Bridge") -> None:
        self._bridge = bridge

    # -----------------------------------------------------------------
    # Mutations
    # -----------------------------------------------------------------

    def add_policy(self, policy: Dict[str, Any]) -> str:
        """Add a policy after caller-attenuation check.

        The policy dict must match the ``AccessPolicy`` serde shape;
        missing ``id`` is filled with a fresh UUID client-side (the Rust
        side accepts any valid PolicyId).
        """
        payload = _normalize_policy(policy)
        policy_json = json.dumps(payload)
        result = self._bridge.call_json("compute_wb_security_add_policy", policy_json)
        # Rust returns the PolicyId as a transparent UUID string.
        return result if isinstance(result, str) else str(result)

    def remove_policy(self, policy_id: str) -> None:
        """Remove a policy by ID. Idempotent at the store layer."""
        self._bridge.call("compute_wb_security_remove_policy", json.dumps(policy_id))

    def update_policy(self, policy_id: str, patch: Dict[str, Any]) -> None:
        """Apply a partial update. ``patch`` is an :class:`AccessPolicyPatch`
        — every field optional. Attenuation re-runs when ``level`` is patched.
        """
        self._bridge.call(
            "compute_wb_security_update_policy",
            json.dumps(policy_id),
            json.dumps(patch),
        )

    def apply_template(self, template: Union[str, Dict[str, Any]]) -> List[str]:
        """Apply a named template. ``template`` may be:

        - a dict in tagged-enum shape, or
        - the short-form string ``"protect_workbook"`` / ``"agent_structure"``.
        """
        if isinstance(template, str):
            payload: Dict[str, Any] = {"kind": template}
        else:
            payload = template
        result = self._bridge.call_json(
            "compute_wb_security_apply_template", json.dumps(payload)
        )
        return list(result) if isinstance(result, list) else []

    def remove_template(self, template_id: str) -> None:
        """Remove every policy emitted by the named template."""
        self._bridge.call(
            "compute_wb_security_remove_template", template_id
        )

    # -----------------------------------------------------------------
    # Reads
    # -----------------------------------------------------------------

    def list_policies(self) -> List[Dict[str, Any]]:
        """Return every policy currently on the document, in stable id order."""
        result = self._bridge.call_json("compute_wb_security_list_policies")
        return list(result) if isinstance(result, list) else []

    def effective_access(
        self, target: Dict[str, Any], principal: Dict[str, List[str]]
    ) -> str:
        """Resolve the principal's effective access level for ``target``.
        ``target`` and ``principal`` are dicts in their respective serde
        wire shapes (see :class:`Target` and :class:`Principal`).
        """
        # Rust `wb_security_effective_access(target, principal_tags: Vec<String>)`
        # takes a flat tag list — unwrap the `{tags}` envelope here.
        return self._bridge.call(
            "compute_wb_security_effective_access",
            json.dumps(target),
            json.dumps(_principal_tags(principal)),
        )

    def explain_access(
        self, target: Dict[str, Any], principal: Dict[str, List[str]]
    ) -> Dict[str, Any]:
        """Full derivation trace — one-to-one with
        ``AccessExplanation`` on the Rust side."""
        result = self._bridge.call_json(
            "compute_wb_security_explain_access",
            json.dumps(target),
            json.dumps(_principal_tags(principal)),
        )
        return result if isinstance(result, dict) else {}

    def drain_events(self) -> List[Dict[str, Any]]:
        """Drain pending :class:`SecurityEvent` entries from the engine's
        event buffer. Each event is a tagged-enum dict with ``kind`` set
        to one of: ``policy_added`` / ``policy_removed`` / ``policy_updated``
        / ``access_denied`` / ``ambiguity_detected``.
        """
        result = self._bridge.call_json("compute_wb_security_drain_events")
        return list(result) if isinstance(result, list) else []


def _principal_tags(principal: Any) -> List[str]:
    """Extract the flat tag list from a principal envelope.

    Accepts the :class:`Principal`-factory dict shape ``{"tags": [...]}``,
    a bare list of tags, or anything iterable yielding strings. The Rust
    engine's security ops (``wb_security_effective_access`` /
    ``wb_security_explain_access``) take ``Vec<String>`` on the wire; see
    ``compute/core/src/storage/engine/security_ops.rs`` docstring for the
    rationale (``Principal`` is not serialisable — its canonical identity
    is a pool-slab pointer).
    """
    if isinstance(principal, dict):
        return [str(t) for t in principal.get("tags", [])]
    return [str(t) for t in principal]


def _normalize_policy(policy: Dict[str, Any]) -> Dict[str, Any]:
    """Fill in defaults for fields SDK callers tend to omit.

    The Rust wire format requires every field; we produce a canonical
    JSON body here so the SDK surface stays terse.
    """
    out = dict(policy)
    out.setdefault("id", str(uuid.uuid4()))
    out.setdefault("priority", 0)
    out.setdefault("enabled", True)
    # Metadata wire keys are camelCase (legacy TS shape) —
    # `createdBy` / `createdAt` / `templateId`. The TS field was
    # `createdAt: number` (epoch ms); the Rust struct stores the value
    # in `created_at_millis` but serializes it as `createdAt`.
    out.setdefault(
        "metadata",
        {"createdBy": "sdk", "createdAt": 0, "templateId": None},
    )
    return out
