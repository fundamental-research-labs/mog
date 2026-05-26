//! R3.1 — stateless gate primitives on `YrsComputeEngine`.
//!
//! These tests exercise the engine-side primitives that the
//! bridge-delegate macro calls on every gated read/write:
//!
//! - `active_matrix(&principal, sheet)` — cached (principal, sheet,
//!   policy_version, structure_version) tuple.
//! - `effective_access(&principal, target)` — the attenuation pathway.
//! - `check_write(&principal, target, required)` — sheet/workbook-scope
//!   write pre-check.
//!
//! The tests operate directly on a `YrsComputeEngine` — no dispatch,
//! no ComputeService. That mirrors the macro's engine-thread-only call
//! pattern and keeps the assertions shape-focused.

use std::sync::Arc;

use compute_core::storage::engine::YrsComputeEngine;
use compute_document::SecurityStore;
use compute_document::schema::{KEY_SECURITY, init_canonical_schema};
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, PolicyId, PolicyMetadata, PrincipalPool, PrincipalTag,
    SecurityError, TagMatcher,
};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};
use yrs::{ReadTxn, Transact};

const SHEET1_UUID: &str = "11111111-1111-1111-1111-111111111111";

fn fresh_engine() -> YrsComputeEngine {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine
}

fn workbook_policy(tag: &str, level: AccessLevel) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Workbook,
        level,
        priority: 10,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("t"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

/// Add a policy by poking it directly into the Yrs `security` map via
/// `SecurityStore`. The engine's Yrs observer fires on the write, so
/// we then manually call `reload_policies_from_yrs` if needed — but
/// with `observe_deep` registered, the reload is automatic before the
/// transaction returns.
fn add_policy_to_engine(engine: &YrsComputeEngine, policy: &AccessPolicy) {
    let doc = engine.storage().doc().clone();
    let _ = init_canonical_schema(&doc);
    let sec_map = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY).expect("security map")
    };
    let mut txn = doc.transact_mut();
    let store = SecurityStore::new(&sec_map, &doc, &txn);
    store.add_policy(&mut txn, policy);
    drop(txn);
    // Observer fires on commit — state should be active now.
}

#[test]
fn active_matrix_returns_admin_for_owner_on_policy_free_sheet() {
    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let owner = pool.intern(std::iter::once(PrincipalTag::from("mog:owner")));

    let matrix = engine.active_matrix(&owner, sheet);
    // Policy-free workbook: every principal gets the default owner
    // level, which is Admin by default.
    assert_eq!(matrix.sheet_default(), AccessLevel::Admin);
    assert_eq!(matrix.is_uniform(), Some(AccessLevel::Admin));
}

#[test]
fn active_matrix_respects_workbook_policy_for_non_owner() {
    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));

    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Read));
    let matrix = engine.active_matrix(&p, sheet);
    assert_eq!(matrix.sheet_default(), AccessLevel::Read);
}

#[test]
fn active_matrix_cache_hit_returns_same_arc_pointer() {
    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));

    let m1 = engine.active_matrix(&p, sheet);
    let m2 = engine.active_matrix(&p, sheet);
    assert!(
        Arc::ptr_eq(&m1, &m2),
        "same (principal, sheet, versions) must share the cached Arc"
    );
}

#[test]
fn active_matrix_cache_invalidates_on_policy_version_bump() {
    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));

    let m1 = engine.active_matrix(&p, sheet);
    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Read));
    let m2 = engine.active_matrix(&p, sheet);
    assert!(
        !Arc::ptr_eq(&m1, &m2),
        "policy add must invalidate the matrix cache (policy_version bump)"
    );
}

#[test]
fn active_matrix_cache_invalidates_on_structure_version_bump() {
    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));

    let m1 = engine.active_matrix(&p, sheet);
    engine.security().bump_structure_version();
    let m2 = engine.active_matrix(&p, sheet);
    assert!(
        !Arc::ptr_eq(&m1, &m2),
        "structure_version bump must invalidate the matrix cache"
    );
}

#[test]
fn effective_access_workbook_mirrors_matrix_default() {
    // ARCHITECTURE.md §6.2 invariant:
    // `effective_access(Workbook) == active_matrix(...).sheet_default()`.
    // R5.1's attenuation relies on this equality — this test pins it.
    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));

    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Read));

    let eff = engine.effective_access(&p, &AccessTarget::Workbook);
    let matrix = engine.active_matrix(&p, sheet);
    assert_eq!(eff, matrix.sheet_default());
    assert_eq!(eff, AccessLevel::Read);
}

#[test]
fn check_write_read_level_denied() {
    // A principal with only Read cannot satisfy a Write check.
    let engine = fresh_engine();
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Read));

    let r = engine.check_write(&p, &AccessTarget::Workbook, AccessLevel::Write, "test");
    match r {
        Err(SecurityError::Denied {
            required, actual, ..
        }) => {
            assert_eq!(required, AccessLevel::Write);
            assert_eq!(actual, AccessLevel::Read);
        }
        other => panic!("expected SecurityError::Denied, got {other:?}"),
    }
}

#[test]
fn check_write_admin_level_allowed_for_owner() {
    let engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = pool.intern(std::iter::once(PrincipalTag::from("mog:owner")));
    // No policy: owner gets Admin by default.
    let r = engine.check_write(&owner, &AccessTarget::Workbook, AccessLevel::Admin, "test");
    assert!(r.is_ok(), "owner must pass Admin check on policy-free doc");
}

#[test]
fn check_write_write_level_allowed_for_write_principal() {
    let engine = fresh_engine();
    let pool = PrincipalPool::new();
    let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Write));
    let r = engine.check_write(&p, &AccessTarget::Workbook, AccessLevel::Write, "test");
    assert!(r.is_ok());
}

// ---------------------------------------------------------------------------
// R4 follow-up: typed `RedactMaybe` contract verified through the
// engine's `active_matrix` + `redact_scalar` pipeline.
//
// These tests operate without ComputeService: they pull the matrix
// directly, call the scalar redactor, and confirm the typed placeholder
// lands — the same path the gated delegate takes on every cell-scope
// read. Tied to ARCHITECTURE.md §7 (Structure → typed placeholder).
// ---------------------------------------------------------------------------

#[test]
fn redact_cell_value_structure_returns_type_placeholder() {
    use compute_security::redact_scalar;
    use value_types::{CellValue, FiniteF64};

    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let agent = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Structure));

    let matrix = engine.active_matrix(&agent, sheet);
    // Evaluate a cell's level the same way the delegate does.
    let level = matrix.get(0, 0);
    assert_eq!(level, AccessLevel::Structure);

    let raw = CellValue::Number(FiniteF64::must(42.0));
    let redacted = redact_scalar(raw, level);
    match redacted {
        CellValue::Text(ref s) => assert_eq!(&**s, "[Number]"),
        other => panic!(
            "Structure-level redaction must place the [Number] placeholder, got {:?}",
            other
        ),
    }
}

#[test]
fn redact_cell_value_none_returns_null() {
    use compute_security::redact_scalar;
    use value_types::{CellValue, FiniteF64};

    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let agent = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::None));

    let matrix = engine.active_matrix(&agent, sheet);
    let level = matrix.get(0, 0);
    assert_eq!(level, AccessLevel::None);

    let raw = CellValue::Number(FiniteF64::must(42.0));
    let redacted = redact_scalar(raw, level);
    assert!(
        matches!(redacted, CellValue::Null),
        "None-level redaction must collapse to CellValue::Null, got {:?}",
        redacted
    );
}

#[test]
fn redact_cell_value_read_is_identity() {
    use compute_security::redact_scalar;
    use value_types::{CellValue, FiniteF64};

    let engine = fresh_engine();
    let sheet = engine.storage().sheet_order()[0];
    let pool = PrincipalPool::new();
    let agent = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
    add_policy_to_engine(&engine, &workbook_policy("agent:*", AccessLevel::Read));

    let matrix = engine.active_matrix(&agent, sheet);
    let level = matrix.get(0, 0);
    assert_eq!(level, AccessLevel::Read);

    let raw = CellValue::Number(FiniteF64::must(42.0));
    let redacted = redact_scalar(raw, level);
    match redacted {
        CellValue::Number(n) => assert_eq!(n.get(), 42.0),
        other => panic!("Read level must pass through, got {:?}", other),
    }
}
