"""R8.4 — Python SDK session-principal API parity tests.

Five scenarios that mirror the TS `dev/api-eval/scenarios/security/
session-api.ts` scenarios (R8.3) through the Python surface. All tests
use the flat-list form only — ``wb.set_active_principal(['mog:owner'])``
— per the R8 decision pin (keep Python's ``Optional[List[str]]`` input
shape; do not widen it to accept the ``AccessPrincipal`` envelope).

Asymmetry vs. TS surface (intentional, documented in R8.4 decision pin):
- TS ``wb.setActivePrincipal`` accepts ``string[] | AccessPrincipal | null``;
  Python ``wb.set_active_principal`` accepts only ``Optional[List[str]]``.
- TS ships ``wb.activePrincipal()``; Python does not expose this getter
  today, so scenario 2 (canonicalization observability) is exercised
  through ``wb.make_principal`` instead, which rides the same intern pool.

Skipped when ``mog._native`` isn't built — run ``maturin develop`` from
``compute/pyo3`` first.
"""
from __future__ import annotations

import pytest


_native_available: bool
try:
    import mog  # noqa: F401  (import to trigger availability check)
    from mog._native import ComputeEngine  # noqa: F401

    _native_available = True
except ImportError:
    _native_available = False


pytestmark = pytest.mark.skipif(
    not _native_available,
    reason="mog._native not built — run `maturin develop` from compute/pyo3",
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def wb_fresh():
    """A workbook with no active principal and no policies."""
    import mog

    return mog.create_workbook()


# ---------------------------------------------------------------------------
# Scenario 1 — set_active_principal reaches the engine; add_policy succeeds.
# ---------------------------------------------------------------------------


def test_set_active_principal_drives_add_policy(wb_fresh):
    """After ``set_active_principal(['mog:owner'])`` the next ``add_policy``
    call succeeds — the bootstrap gate only lets through sessions with the
    owner tag."""
    from mog import AccessLevel, Target

    wb_fresh.set_active_principal(["mog:owner"])
    policy_id = wb_fresh.security.add_policy({
        "principalTag": "agent:*",
        "target": Target.workbook(),
        "level": AccessLevel.READ,
        "priority": 0,
    })
    assert isinstance(policy_id, str) and policy_id


# ---------------------------------------------------------------------------
# Scenario 2 — pool canonicalisation observable through the public API.
# ---------------------------------------------------------------------------
#
# TS uses ``wb.activePrincipal()`` to observe the canonical form, which
# Python does not surface. ``wb.make_principal`` rides the same Rust
# ``PrincipalPool::intern`` path, so the same canonicalisation guarantee
# is observable there.


def test_make_principal_canonicalises_unsorted_and_duplicate_tags(wb_fresh):
    canonical = wb_fresh.make_principal(["owner:x", "mog:owner", "owner:x"])
    assert canonical == {"tags": ["mog:owner", "owner:x"]}, canonical


# ---------------------------------------------------------------------------
# Scenario 3 — security_active flips false → true → false.
# ---------------------------------------------------------------------------


def test_security_active_flips_across_first_and_last_policy(wb_fresh):
    from mog import AccessLevel, Target

    assert wb_fresh.security_active() is False

    wb_fresh.set_active_principal(["mog:owner"])
    policy_id = wb_fresh.security.add_policy({
        "principalTag": "agent:*",
        "target": Target.workbook(),
        "level": AccessLevel.READ,
        "priority": 0,
    })
    assert wb_fresh.security_active() is True

    wb_fresh.security.remove_policy(policy_id)
    assert wb_fresh.security_active() is False


# ---------------------------------------------------------------------------
# Scenario 4 — make_principal is canonical regardless of input order.
# ---------------------------------------------------------------------------


def test_make_principal_order_independent(wb_fresh):
    ab = wb_fresh.make_principal(["a", "b"])
    ba = wb_fresh.make_principal(["b", "a"])
    assert ab == {"tags": ["a", "b"]}
    assert ba == {"tags": ["a", "b"]}
    assert ab == ba


# ---------------------------------------------------------------------------
# Scenario 5 — set_active_principal(None) clears; next gated call is anonymous.
# ---------------------------------------------------------------------------
#
# The TS scenario observes the null principal via ``wb.activePrincipal()``
# and confirms the downstream gated call (``add_policy`` as anonymous) is
# denied. Python doesn't expose ``active_principal()``; we verify the
# behavioural half — a cleared session hits the bootstrap gate.


def test_clearing_principal_hits_bootstrap_gate(wb_fresh):
    from mog import AccessLevel, Target

    # Seed a policy as owner so enforcement is live.
    wb_fresh.set_active_principal(["mog:owner"])
    policy_id = wb_fresh.security.add_policy({
        "principalTag": "agent:*",
        "target": Target.workbook(),
        "level": AccessLevel.READ,
        "priority": 0,
    })

    # Clear the principal — session is now anonymous.
    wb_fresh.set_active_principal(None)

    # Anonymous add_policy must be rejected (bootstrap contract).
    with pytest.raises(Exception):
        wb_fresh.security.add_policy({
            "principalTag": "other:*",
            "target": Target.workbook(),
            "level": AccessLevel.READ,
            "priority": 0,
        })

    # Clean up.
    wb_fresh.set_active_principal(["mog:owner"])
    wb_fresh.security.remove_policy(policy_id)
