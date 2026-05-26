"""R5.3 — Python SDK security tests.

These exercise the ``wb.security`` façade end-to-end through the PyO3
bridge. They require ``mog._native`` to be built (``maturin develop``
from ``compute/pyo3``). When ``mog._native`` isn't available the tests
skip cleanly so ``pytest`` runs on a fresh checkout without erroring.
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
def wb_owner():
    """Workbook with the session principal set to `mog:owner`."""
    import mog

    return mog.create_workbook(principal=["mog:owner"])


@pytest.fixture
def wb_agent():
    """Workbook with the session principal set to `agent:copilot`."""
    import mog

    return mog.create_workbook(principal=["agent:copilot"])


@pytest.fixture
def wb_anonymous():
    """Workbook with no active principal."""
    import mog

    return mog.create_workbook()


# ---------------------------------------------------------------------------
# Lifecycle: add / list / remove
# ---------------------------------------------------------------------------


def test_owner_can_add_list_remove_policy(wb_owner):
    """Round-trip: owner adds a policy, sees it in list, removes it."""
    from mog import AccessLevel, Target

    policy_id = wb_owner.security.add_policy({
        "principalTag": "agent:*",
        "target": Target.workbook(),
        "level": AccessLevel.READ,
        "priority": 10,
    })
    assert isinstance(policy_id, str), policy_id

    listed = wb_owner.security.list_policies()
    assert any(p.get("id") == policy_id for p in listed), listed

    wb_owner.security.remove_policy(policy_id)
    listed_after = wb_owner.security.list_policies()
    assert all(p.get("id") != policy_id for p in listed_after), listed_after


# ---------------------------------------------------------------------------
# Attenuation + access-denied
# ---------------------------------------------------------------------------


def test_non_owner_cannot_add_policy(wb_agent):
    """A session with a non-owner principal fails the outer delegate check.

    The agent:copilot principal has no Admin on the workbook (default
    for non-owner is None), so the gated delegate's ``check_write``
    rejects before the engine method body runs.
    """
    from mog import AccessLevel, Target
    from mog.errors import MogError

    with pytest.raises((MogError, Exception)):
        wb_agent.security.add_policy({
            "principalTag": "agent:*",
            "target": Target.workbook(),
            "level": AccessLevel.READ,
            "priority": 0,
        })


def test_attenuation_rejects_caller_upgrade(wb_owner):
    """Owner grants agent:copilot Write; that principal then cannot grant Admin."""
    from mog import AccessLevel, Target

    # Seed: owner grants Write to agent:copilot on workbook.
    wb_owner.security.add_policy({
        "principalTag": "agent:copilot",
        "target": Target.workbook(),
        "level": AccessLevel.WRITE,
        "priority": 10,
    })

    # Flip session to agent:copilot.
    wb_owner.set_active_principal(["agent:copilot"])

    # Now the agent — ceiling = Write — tries to grant Admin. Rejected.
    with pytest.raises(Exception):
        wb_owner.security.add_policy({
            "principalTag": "agent:*",
            "target": Target.workbook(),
            "level": AccessLevel.ADMIN,
            "priority": 0,
        })


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def test_protect_workbook_template(wb_owner):
    """Applying the ProtectWorkbook template creates the documented policy set."""
    from mog import Template

    ids = wb_owner.security.apply_template(Template.protect_workbook())
    assert len(ids) >= 1, ids

    listed = wb_owner.security.list_policies()
    for pid in ids:
        policy = next((p for p in listed if p.get("id") == pid), None)
        assert policy is not None, pid
        meta = policy.get("metadata", {})
        assert meta.get("templateId") == "protect-workbook", policy


def test_remove_template_cleans_up(wb_owner):
    """remove_template strips every policy emitted by the template."""
    from mog import Template

    ids = wb_owner.security.apply_template(Template.protect_workbook())
    assert ids

    wb_owner.security.remove_template("protect-workbook")
    listed = wb_owner.security.list_policies()
    for pid in ids:
        assert not any(p.get("id") == pid for p in listed), pid


# ---------------------------------------------------------------------------
# Principal canonicalisation
# ---------------------------------------------------------------------------


def test_principal_identity_is_order_insensitive(wb_owner):
    """make_principal(['a', 'b']) and make_principal(['b', 'a']) should be equal.

    The Rust pool canonicalises tag order before hashing, so either order
    hands back a principal with the same tag set.
    """
    p1 = wb_owner.make_principal(["a", "b"])
    p2 = wb_owner.make_principal(["b", "a"])
    # Both should carry the same canonical tag set after the Rust-side
    # intern. Tags are returned sorted (SortedTagList.from_unsorted).
    assert sorted(p1.get("tags", [])) == sorted(p2.get("tags", []))
