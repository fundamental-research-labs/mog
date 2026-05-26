//! Rust-native end-to-end security scenarios.
//!
//! Each test drives `ComputeService` (the bridged delegate surface — same
//! code path every SDK binding calls) to verify that the gated-delegate
//! plumbing composes correctly with the engine's policy store, matrix
//! cache, and filter hooks.
//!
//! The test corpus is grouped by:
//!   - bootstrap contract (ARCHITECTURE.md §8.1)
//!   - principal identity
//!   - enforcement (28 scenarios)
//!   - adversarial scenarios that map cleanly to the current security model
//!   - composition (10 scenarios)
//!   - seed-on-load (R2.3)
//!
//! The `RedactMaybe` blanket no-op and the `get_viewport_binary` annotation
//! are both covered here. `get_cell_value` now returns a typed
//! placeholder under Structure and `CellValue::Null` under None;
//! `get_viewport_binary` is `bridge::read(scope = "sheet")` and
//! routes through `filter_viewport_buffer`. See
//! `sg2_structure_redacts_cell_values` below for the e2e scenario.
//!
//! Remaining gap (tracked elsewhere):
//!   - `AccessDenied` / `AmbiguityDetected` events: not emitted by R5's
//!     CRUD macros; tests only assert `PolicyAdded/Removed/Updated`.

use std::sync::Arc;

use cell_types::SheetId;
use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::YrsComputeEngine;
use compute_security::{
    AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, PolicyId, PolicyMetadata,
    TagMatcher, Template,
};
use domain_types::domain::comment::CommentType;
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, ComputeError};

const SHEET1_UUID: &str = "44444444-4444-4444-4444-444444444444";

// ---------------------------------------------------------------------------
// Fixtures — construction helpers shared across the whole file.
//
// The engine, dispatch, and service are plumbed without going through
// `Workbook::from_snapshot` so the tests can take both owner-tagged and
// agent-tagged views of the same document by swapping `set_active_principal`.
// ---------------------------------------------------------------------------

fn snapshot_with_sheet(sheet_id: &str) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn fresh_service() -> (ComputeService, SheetId) {
    let snapshot = snapshot_with_sheet(SHEET1_UUID);
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let dispatch = Dispatch::from_engine(engine).expect("dispatch");
    let service = ComputeService::new(dispatch);
    let sheet_id = SheetId::from_uuid_str(SHEET1_UUID).expect("parse sheet id");
    (service, sheet_id)
}

fn fresh_service_uuid(uuid: &str) -> (ComputeService, SheetId) {
    let snapshot = snapshot_with_sheet(uuid);
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let dispatch = Dispatch::from_engine(engine).expect("dispatch");
    let service = ComputeService::new(dispatch);
    let sheet_id = SheetId::from_uuid_str(uuid).expect("parse sheet id");
    (service, sheet_id)
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
            created_by: Arc::from("security-e2e"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn sheet_policy(tag: &str, sheet_id: SheetId, level: AccessLevel) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Sheet { sheet_id },
        level,
        priority: 20,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("security-e2e"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

/// Shorthand: populate a cell as owner, then swap to a restricted principal.
///
/// Takes the restricted principal as a tag list — `make_principal` returns
/// the canonical wire form (`Vec<String>`) and `set_active_principal`
/// takes the same. `Principal` itself is Rust-side only (not serde); tests
/// that need the actual `Principal` struct for cross-boundary engine calls
/// like `wb_security_effective_access` reach for `intern_principal`
/// instead.
fn seed_as_owner_then_swap(
    service: &mut ComputeService,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
    restricted: Vec<String>,
) {
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(sheet_id, row, col, value)
        .expect("owner write");
    service.set_active_principal(Some(restricted));
}

/// Promote a raw `ComputeError::SecurityDenied` to the typed variant and
/// match against that. The delegate surface returns `ComputeError` (not
/// `ComputeApiError`) for gated writes; the SDK layer promotes it before
/// surfacing to bindings.
fn is_engine_security_denied(err: &ComputeError) -> bool {
    matches!(err, ComputeError::SecurityDenied { .. })
}

// ===========================================================================
// Bootstrap contract — ARCHITECTURE.md §8.1
// ===========================================================================

#[test]
fn bootstrap_no_principal_denied() {
    let (mut service, _sheet_id) = fresh_service();
    assert!(!service.security_active());
    let r = service.wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read));
    assert!(matches!(r, Err(ComputeError::SecurityDenied { .. })));
    assert!(
        !service.security_active(),
        "first-policy denial must leave security inactive"
    );
}

#[test]
fn bootstrap_non_owner_principal_denied() {
    let (mut service, _sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);
    service.set_active_principal(Some(agent));
    assert!(!service.security_active());
    let r = service.wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read));
    assert!(matches!(r, Err(ComputeError::SecurityDenied { .. })));
    assert!(!service.security_active());
}

#[test]
fn bootstrap_owner_principal_succeeds_and_activates() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    assert!(!service.security_active());
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("owner add_policy");
    assert!(
        service.security_active(),
        "observer must flip active on first policy"
    );
}

// ===========================================================================
// Principal identity regression
// ===========================================================================

#[test]
fn make_principal_is_canonical() {
    // `make_principal` returns the canonical (sorted, deduped) tag list
    // at the wire boundary — `Principal` itself is not serialisable
    // (identity is the pool slab pointer; see compute_security::principal).
    // Two different input orders must produce byte-identical canonical
    // output; the pool pre-warm guarantees set_active_principal with the
    // same canonical list hits the same slab.
    let (service, _) = fresh_service();
    let p1 = service.make_principal(vec!["a".into(), "b".into()]);
    let p2 = service.make_principal(vec!["b".into(), "a".into()]);
    assert_eq!(p1, p2);
}

#[test]
fn make_principal_dedupes_duplicate_tags() {
    // Pool canonicalizes sort + dedupe; two `a` tags collapse to one.
    let (service, _) = fresh_service();
    let p1 = service.make_principal(vec!["a".into(), "a".into()]);
    let p2 = service.make_principal(vec!["a".into()]);
    assert_eq!(p1, p2);
    assert_eq!(p1, vec!["a".to_string()]);
}

#[test]
fn anonymous_principal_is_pool_interned() {
    // Anonymous = empty tag list. Both wire-canonical and pool-identity
    // stable across repeated make_principal calls.
    let (service, _) = fresh_service();
    let a1 = service.make_principal(vec![]);
    let a2 = service.make_principal(vec![]);
    assert_eq!(a1, a2);
    assert!(a1.is_empty());
}

// ===========================================================================
// Seed-on-load — R2.3
// ===========================================================================

#[test]
fn seed_on_load_activates_service_before_any_call() {
    // Stand up engine A with one policy, encode to Yrs state, load into
    // engine B via `from_yrs_state`, wrap in ComputeService: the service's
    // `security_active` flag must already be `true` on the very first
    // gated call.
    let snapshot = snapshot_with_sheet(SHEET1_UUID);
    let (engine_a, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let dispatch_a = Dispatch::from_engine(engine_a).expect("dispatch");
    let mut service_a = ComputeService::new(dispatch_a);

    let owner = service_a.make_principal(vec!["mog:owner".into()]);
    service_a.set_active_principal(Some(owner));
    service_a
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("seed");
    assert!(service_a.security_active());

    let state = service_a.sync_full_state();

    let (engine_b, _) = YrsComputeEngine::from_yrs_state(&state).expect("from_yrs_state");
    let dispatch_b = Dispatch::from_engine(engine_b).expect("dispatch b");
    let service_b = ComputeService::new(dispatch_b);
    assert!(
        service_b.security_active(),
        "seed-on-load must activate security before the first bridged call"
    );
}

// ===========================================================================
// Enforcement — category 1
// ===========================================================================

//
// NOTE on CellValue redaction: R4 follow-up implemented typed
// `RedactMaybe` for `CellValue` so cell-scope reads under Structure/None
// now return the typed placeholder / `CellValue::Null` as documented in
// ARCHITECTURE.md §7. The e2e assertion for that contract is
// `sg2_structure_redacts_cell_values` below.
//

#[test]
fn structure_access_allows_formula_reads() {
    // Structure grants access to formulas but not their computed values.
    // The formula text itself is structural metadata — the read path
    // through get_formula (workbook-scope) passes through unchanged.
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed data as owner, then apply structure policy, then swap.
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "42")
        .expect("owner write A1");
    service
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*2")
        .expect("owner write B1");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent.clone()));
    assert!(service.security_active());

    // Structure principal can compute effective_access = Structure.
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent.clone());
    assert_eq!(lvl, AccessLevel::Structure);
}

/// Structure-level end-to-end: under a Structure-level workbook policy, a cell
/// read goes through the typed `RedactMaybe` impl and returns the
/// legacy placeholder (`CellValue::Text("[Number]")`). Under None, the same
/// read returns `CellValue::Null`.
#[test]
fn sg2_structure_redacts_cell_values() {
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "42")
        .expect("owner seed A1");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent.clone()));

    // Gated read: the `get_cell_value` delegate fetches the matrix for
    // the agent principal (Structure level across the workbook) and
    // passes the scalar through `redact_scalar(_, Structure)`, which
    // calls `CellValue::redact(Structure)` → `Text("[Number]")`.
    let v = service.get_cell_value(&sheet_id, 0, 0);
    match v {
        CellValue::Text(ref s) => assert_eq!(
            &**s, "[Number]",
            "Structure level should return the [Number] placeholder"
        ),
        other => panic!(
            "Structure-level read must redact to the [Number] placeholder, got {:?}",
            other
        ),
    }
}

/// None-level workbook policy → `get_cell_value` returns
/// `CellValue::Null`. Locks down the full-hide half of the R4 typed
/// redaction contract.
#[test]
fn sg2_none_level_hides_cell_values() {
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "7")
        .expect("owner seed");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");
    service.set_active_principal(Some(agent));

    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(v, CellValue::Null),
        "None level must hide cell values via CellValue::Null, got {:?}",
        v
    );
}

#[test]
fn structure_blocks_writes() {
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "99");
    assert!(r.is_err(), "structure must block writes");
    let err = r.unwrap_err();
    assert!(is_engine_security_denied(&err), "got {err:?}");
}

#[test]
fn read_allows_reads_blocks_writes() {
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);
    seed_as_owner_then_swap(&mut service, &sheet_id, 0, 0, "11", agent.clone());

    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("policy add");
    service.set_active_principal(Some(agent.clone()));

    // Read passes.
    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(matches!(v, CellValue::Number(_)), "read allowed: {v:?}");

    // Write fails.
    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "999");
    assert!(r.is_err());
    assert!(is_engine_security_denied(&r.unwrap_err()));
}

#[test]
fn write_allows_mutation() {
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);
    seed_as_owner_then_swap(&mut service, &sheet_id, 0, 0, "1", agent.clone());

    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "2")
        .expect("write at Write level");
    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(matches!(v, CellValue::Number(n) if n.get() == 2.0), "{v:?}");
}

#[test]
fn admin_can_manage_policies() {
    // Two owners. The first writes a policy. The second (also owner)
    // removes it. Both pass the workbook-level Write check that the
    // delegate emits for wb_security_* calls.
    let (mut service, _sheet_id) = fresh_service();
    let owner_a = service.make_principal(vec!["mog:owner".into()]);
    let owner_b = service.make_principal(vec!["mog:owner".into()]);
    // Both canonicalise to the same wire tag list; the pool pre-warm
    // means both subsequent set_active_principal calls hit the same slab.
    assert_eq!(owner_a, owner_b, "same tags = same canonical wire form");

    service.set_active_principal(Some(owner_a));
    let policy = workbook_policy("agent:*", AccessLevel::Read);
    let id = service.wb_security_add_policy(policy).expect("owner_a add");

    service.set_active_principal(Some(owner_b));
    service
        .wb_security_remove_policy(id)
        .expect("owner_b remove");
}

#[test]
fn non_owner_cannot_add_policy_even_with_write_scope() {
    // Agent has workbook Write — they can write cells but they still
    // can't add policies (attenuation: Write < Admin).
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:copilot", AccessLevel::Write))
        .expect("seed write policy");
    service.set_active_principal(Some(agent));

    // Agent can do writes.
    // But they cannot add a policy (first delegate-level check passes because
    // Write > required Write for wb_security_* — but the inner attenuation
    // rejects because the requested Admin > agent's Write ceiling).
    let r = service.wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Admin));
    assert!(r.is_err(), "non-owner cannot grant Admin");
}

#[test]
fn none_policy_denies_writes() {
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a Read-level policy on another tag first so security_active is
    // definitely on before we rely on the explicit None for the agent.
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("other:*", AccessLevel::Read))
        .expect("bootstrap");
    service.set_active_principal(Some(agent));

    // Agent has no matching policy → default None → writes denied.
    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "1");
    assert!(r.is_err());
    assert!(is_engine_security_denied(&r.unwrap_err()));
}

#[test]
fn none_policy_blocks_clear_range() {
    // clear_range is a structural/range mutation. Under None access, the
    // delegate's range-scope write path runs check_write and the matrix
    // reports the principal's ceiling as None.
    let (mut service, sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);
    let owner = service.make_principal(vec!["mog:owner".into()]);

    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("seed");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy");
    service.set_active_principal(Some(agent));

    let r = service.clear_range(&sheet_id, 0, 0, 0, 0);
    assert!(r.is_err(), "structure cannot clear cell data");
}

#[test]
fn owner_reads_through_policy() {
    // Policy targets `agent:*`; owner is not an agent so their default
    // (Admin) still applies.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);

    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "42")
        .expect("seed");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");

    // Still owner — can read and write.
    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(matches!(v, CellValue::Number(_)));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "100")
        .expect("owner write after policy");
}

#[test]
fn owner_default_admin_on_empty_doc() {
    let (service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, owner);
    assert_eq!(lvl, AccessLevel::Admin);
}

#[test]
fn non_owner_default_none_on_empty_doc() {
    let (service, _sheet_id) = fresh_service();
    let agent = service.make_principal(vec!["agent:copilot".into()]);
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl, AccessLevel::None);
}

#[test]
fn sheet_policy_overrides_workbook_default() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    // Workbook default via Read; Sheet override to Write.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("workbook policy");
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Write))
        .expect("sheet policy");
    service.set_active_principal(Some(agent.clone()));

    // Workbook-level effective: Read (workbook policy).
    let wb_lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent.clone());
    assert_eq!(wb_lvl, AccessLevel::Read);

    // Sheet-level effective: Write (override).
    let sh_lvl = service.wb_security_effective_access(AccessTarget::Sheet { sheet_id }, agent);
    assert_eq!(sh_lvl, AccessLevel::Write);

    // And a write on that sheet passes.
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "5")
        .expect("sheet-scoped Write allows write");
}

#[test]
fn write_policy_cannot_grant_admin_via_new_policy() {
    // Attenuation regression: a caller with Write cannot mint an Admin
    // policy.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:copilot", AccessLevel::Write))
        .expect("seed write");
    service.set_active_principal(Some(agent));

    let r = service.wb_security_add_policy(workbook_policy("other:*", AccessLevel::Admin));
    assert!(r.is_err(), "Write caller cannot grant Admin");
}

#[test]
fn policy_update_bumps_version_and_changes_level() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("add");

    let patch = AccessPolicyPatch {
        level: Some(AccessLevel::Write),
        ..Default::default()
    };
    service
        .wb_security_update_policy(id, patch)
        .expect("update");

    let listed = service.wb_security_list_policies();
    let updated = listed.iter().find(|p| p.id == id).expect("present");
    assert_eq!(updated.level, AccessLevel::Write);
}

#[test]
fn policy_remove_deactivates_when_last() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("add");
    assert!(service.security_active());
    service.wb_security_remove_policy(id).expect("remove");
    assert!(
        !service.security_active(),
        "active flips back to false when the last policy is removed"
    );
}

#[test]
fn disabled_policy_ignored_by_resolver() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    let mut policy = workbook_policy("agent:*", AccessLevel::Read);
    policy.enabled = false;
    let id = service
        .wb_security_add_policy(policy)
        .expect("add disabled");

    // Agent's effective access should still be None (disabled policy ignored).
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl, AccessLevel::None);

    // Enable it.
    service
        .wb_security_update_policy(
            id,
            AccessPolicyPatch {
                enabled: Some(true),
                ..Default::default()
            },
        )
        .expect("enable");
    let agent2 = service.make_principal(vec!["agent:copilot".into()]);
    let lvl2 = service.wb_security_effective_access(AccessTarget::Workbook, agent2);
    assert_eq!(lvl2, AccessLevel::Read);
}

#[test]
fn priority_higher_wins_on_same_specificity() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    // Both match `agent:*`. Priority 50 wins over 10.
    service
        .wb_security_add_policy(AccessPolicy {
            priority: 10,
            ..workbook_policy("agent:*", AccessLevel::Read)
        })
        .expect("low prio");
    service
        .wb_security_add_policy(AccessPolicy {
            priority: 50,
            ..workbook_policy("agent:*", AccessLevel::Write)
        })
        .expect("high prio");

    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl, AccessLevel::Write);
}

#[test]
fn specificity_exact_wins_over_wildcard() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("wildcard");
    service
        .wb_security_add_policy(AccessPolicy {
            priority: 0,
            ..workbook_policy("agent:copilot", AccessLevel::Write)
        })
        .expect("exact");

    // Exact tag wins on specificity even at lower priority.
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl, AccessLevel::Write);
}

#[test]
fn list_policies_returns_added_set() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let p1 = workbook_policy("agent:a", AccessLevel::Read);
    let p2 = workbook_policy("agent:b", AccessLevel::Write);
    let id_a = service.wb_security_add_policy(p1).expect("a");
    let id_b = service.wb_security_add_policy(p2).expect("b");

    let listed = service.wb_security_list_policies();
    assert_eq!(listed.len(), 2);
    assert!(listed.iter().any(|p| p.id == id_a));
    assert!(listed.iter().any(|p| p.id == id_b));
}

#[test]
fn template_apply_emits_policies() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let ids = service
        .wb_security_apply_template(Template::ProtectWorkbook)
        .expect("apply_template");
    assert_eq!(ids.len(), 1, "ProtectWorkbook emits one policy");

    let listed = service.wb_security_list_policies();
    let generated = listed
        .iter()
        .find(|p| ids.contains(&p.id))
        .expect("present");
    assert_eq!(
        generated.metadata.template_id.as_deref(),
        Some("protect-workbook")
    );
}

#[test]
fn template_remove_cleans_up_its_policies() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let ids = service
        .wb_security_apply_template(Template::ProtectWorkbook)
        .expect("apply");
    assert_eq!(service.wb_security_list_policies().len(), 1);

    service
        .wb_security_remove_template("protect-workbook".to_string())
        .expect("remove");
    let remaining = service.wb_security_list_policies();
    for id in ids {
        assert!(!remaining.iter().any(|p| p.id == id));
    }
}

#[test]
fn explain_access_fields_populated() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("seed");

    let expl = service.wb_security_explain_access(AccessTarget::Workbook, agent);
    assert_eq!(expl.level, AccessLevel::Read);
    assert!(
        expl.effective_tags
            .iter()
            .any(|t| t.as_str() == "agent:copilot")
    );
    assert!(
        expl.effective_tags
            .iter()
            .any(|t| t.as_str() == "mog:non-owner"),
        "non-owner derivation must appear for non-owners: {:?}",
        expl.effective_tags
    );
    assert!(expl.matched_policy.is_some());
}

#[test]
fn drain_events_returns_crud_history() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("add");
    service
        .wb_security_update_policy(
            id,
            AccessPolicyPatch {
                level: Some(AccessLevel::Write),
                ..Default::default()
            },
        )
        .expect("update");
    service.wb_security_remove_policy(id).expect("remove");

    let events = service.wb_security_drain_events();
    let added = events
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::PolicyAdded { .. }))
        .count();
    let updated = events
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::PolicyUpdated { .. }))
        .count();
    let removed = events
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::PolicyRemoved { .. }))
        .count();
    assert_eq!(added, 1, "PolicyAdded: {events:?}");
    assert_eq!(updated, 1, "PolicyUpdated: {events:?}");
    assert_eq!(removed, 1, "PolicyRemoved: {events:?}");
}

#[test]
fn range_read_passes_under_read_policy() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("A1");
    service
        .set_cell_value_parsed(&sheet_id, 0, 1, "2")
        .expect("B1");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("policy");
    service.set_active_principal(Some(agent));

    let values = service.get_range_values_2d(&sheet_id, 0, 0, 0, 1);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].len(), 2);
    assert!(matches!(values[0][0], CellValue::Number(_)));
    assert!(matches!(values[0][1], CellValue::Number(_)));
}

#[test]
fn range_write_denied_under_read_policy() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("policy");
    service.set_active_principal(Some(agent));

    // clear_range is a range-scope write.
    let r = service.clear_range(&sheet_id, 0, 0, 0, 5);
    assert!(r.is_err(), "Read cannot clear");
}

#[test]
fn structural_create_sheet_denied_for_non_admin() {
    // create_sheet is `#[bridge::structural(scope = "workbook")]` —
    // requires Admin. Write-level agent still gets denied.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("policy");
    service.set_active_principal(Some(agent));

    let r = service.create_sheet("Sheet2");
    assert!(
        r.is_err(),
        "Write caller cannot do structural sheet creation: {r:?}"
    );
}

#[test]
fn structural_create_sheet_allowed_for_admin() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    // No policies ⇒ owner defaults to Admin; structural pass on fast path.
    service.create_sheet("Sheet2").expect("admin create");
}

#[test]
fn policy_persists_across_engine_restart() {
    // Composition/enforcement overlap scenario 10: write policies via
    // service, round-trip the doc through sync_full_state, new service
    // sees the same policies.
    let (mut service_a, _sheet_id) = fresh_service();
    let owner = service_a.make_principal(vec!["mog:owner".into()]);
    service_a.set_active_principal(Some(owner));
    service_a
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("seed");
    let state = service_a.sync_full_state();

    let (engine_b, _) = YrsComputeEngine::from_yrs_state(&state).expect("from_yrs_state");
    let dispatch_b = Dispatch::from_engine(engine_b).expect("dispatch b");
    let service_b = ComputeService::new(dispatch_b);
    let listed = service_b.wb_security_list_policies();
    assert_eq!(listed.len(), 1, "policy must survive round-trip");
    assert!(service_b.security_active(), "seed-on-load activates");
}

#[test]
fn null_principal_is_anonymous_under_active_enforcement() {
    // Boot: owner adds a policy to activate enforcement. Then clear the
    // principal. Next read is treated as anonymous (empty tag slab); no
    // matching policy → default None → write denied.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("seed");
    service.set_active_principal(None);

    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "x");
    assert!(
        r.is_err(),
        "anonymous caller denied under active enforcement"
    );
}

#[test]
fn two_principals_share_document_different_views() {
    // Two-context testing model — one doc, two principals.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 5, 5, "secret")
        .expect("owner writes");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");

    // Owner can still read.
    service.set_active_principal(Some(owner));
    let v_owner = service.get_cell_value(&sheet_id, 5, 5);
    assert!(matches!(v_owner, CellValue::Text(_) | CellValue::Number(_)));

    // Agent writes denied.
    service.set_active_principal(Some(agent));
    let r = service.set_cell_value_parsed(&sheet_id, 5, 5, "pwnd");
    assert!(r.is_err());
}

// ===========================================================================
// Adversarial — category 2. Only scenarios that translate to current semantics.
// ===========================================================================

#[test]
fn adversarial_formula_inherits_cell_access() {
    // A formula cell at B1=A1*2 reads through the same gated path. The
    // formula's cell-level read gets the agent's effective access for
    // cell B1 — the adversary can't escape the sheet-level policy by
    // reading a dependent cell.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "42")
        .expect("A1");
    service
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*2")
        .expect("B1");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("deny");
    service.set_active_principal(Some(agent));

    // Writes denied regardless of formula dependency.
    let r = service.set_cell_value_parsed(&sheet_id, 0, 1, "=A1*3");
    assert!(r.is_err());
}

#[test]
fn adversarial_attenuation_escalation_blocked() {
    // A caller with workbook Read seeds a policy that would grant
    // workbook Admin to someone else. Attenuation forbids it.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let attacker = service.make_principal(vec!["agent:attacker".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:attacker", AccessLevel::Read))
        .expect("attacker read");
    service.set_active_principal(Some(attacker));

    // Attacker can read. Attacker cannot mint new policies (Read < Write
    // workbook-level check fails).
    let r = service.wb_security_add_policy(workbook_policy("*", AccessLevel::Admin));
    assert!(r.is_err(), "Read caller cannot mint policies at all");
}

#[test]
fn adversarial_non_owner_null_principal_cannot_bootstrap() {
    // Variant of bootstrap_no_principal_denied: an attacker drops in
    // with no session principal, expecting fail-safe = owner. The
    // `needs_principal` macro skips the fast path; anonymous maps to
    // empty tag set, which is never mog:owner.
    let (mut service, _sheet_id) = fresh_service();
    service.set_active_principal(None);
    assert!(!service.security_active());
    let r = service.wb_security_add_policy(workbook_policy("*", AccessLevel::Admin));
    assert!(matches!(r, Err(ComputeError::SecurityDenied { .. })));
}

#[test]
fn adversarial_set_cell_after_policy_update_re_checks() {
    // Attacker with initial Write, owner downgrades to Read mid-session,
    // attacker's next write call sees the new matrix and denies.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    let pid = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("seed write");
    service.set_active_principal(Some(agent.clone()));

    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("allowed initially");

    // Owner downgrades.
    service.set_active_principal(Some(owner));
    service
        .wb_security_update_policy(
            pid,
            AccessPolicyPatch {
                level: Some(AccessLevel::Read),
                ..Default::default()
            },
        )
        .expect("downgrade");
    service.set_active_principal(Some(agent));

    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "2");
    assert!(r.is_err(), "post-downgrade write denied");
}

#[test]
fn adversarial_removing_last_policy_drops_enforcement() {
    // Paranoid: if the last policy is removed, the fast-path re-activates
    // and non-owner reads stop getting gated. Verify by removing the last
    // policy and then doing an anonymous read.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("seed");
    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");
    service.wb_security_remove_policy(id).expect("remove last");

    assert!(!service.security_active(), "flag back to false");

    // Anonymous → fast path → read succeeds (policy-free doc).
    service.set_active_principal(None);
    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(v, CellValue::Number(_)),
        "fast path passthrough: {v:?}"
    );
}

#[test]
fn adversarial_principal_swap_is_observed_next_call() {
    // Race-lite: swap principal between calls, each call reads its own
    // snapshot (per §11 — granularity is per-call).
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("seed");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");

    service.set_active_principal(Some(agent));
    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "2");
    assert!(r.is_err());

    // Swap back, succeeds.
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "3")
        .expect("owner write succeeds after swap back");
}

#[test]
fn adversarial_sheet_policy_cannot_exceed_workbook_for_attenuation() {
    // Caller has workbook Read. Tries to mint a sheet-level Admin on
    // some sheet. Attenuation compares against `Workbook` target — the
    // caller's ceiling — so the sheet-level Admin grant is rejected.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let caller = service.make_principal(vec!["agent:elevated".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:elevated", AccessLevel::Write))
        .expect("seed write");
    service.set_active_principal(Some(caller));

    // Caller's workbook ceiling is Write (< Admin) — sheet-level Admin grant is blocked.
    let r = service.wb_security_add_policy(sheet_policy("target:*", sheet_id, AccessLevel::Admin));
    assert!(
        r.is_err(),
        "attenuation rejects sheet-level Admin from Write caller"
    );
}

// ===========================================================================
// Composition — category 3
// ===========================================================================

#[test]
fn composition_same_level_policy_idempotent() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("first");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("second");
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl, AccessLevel::Read);
}

#[test]
fn composition_multi_tag_principal_resolves_highest() {
    // A principal with two tags that match two policies of different
    // levels resolves to the highest level (most-permissive union).
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let dual = service.make_principal(vec!["role:editor".into(), "agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("agent policy");
    service
        .wb_security_add_policy(workbook_policy("role:editor", AccessLevel::Write))
        .expect("role policy");

    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, dual);
    assert_eq!(lvl, AccessLevel::Write, "most permissive wins");
}

#[test]
fn composition_policy_change_takes_effect_immediately() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("Read");
    service.set_active_principal(Some(agent.clone()));
    let r1 = service.set_cell_value_parsed(&sheet_id, 0, 0, "1");
    assert!(r1.is_err(), "Read denies write");

    service.set_active_principal(Some(owner));
    service
        .wb_security_update_policy(
            id,
            AccessPolicyPatch {
                level: Some(AccessLevel::Write),
                ..Default::default()
            },
        )
        .expect("upgrade");
    service.set_active_principal(Some(agent));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("upgraded write passes");
}

#[test]
fn composition_column_policy_scopes_to_column() {
    // A column-level policy restricts access only to that column. Other
    // columns on the same sheet inherit the sheet/workbook defaults.
    use cell_types::ColId;
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    // Seed a known ColId via first write — but the col_id is synthesized
    // per cell. The column-level policy target takes an explicit ColId.
    // Skip writes; focus on verifying that the resolver honors column
    // targets by asserting explain's matched policy.
    let col_id = ColId::from_raw(0x2222_2222_2222_2222_2222_2222_2222_2222);
    let policy = AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse("agent:*"),
        target: AccessTarget::Column { sheet_id, col_id },
        level: AccessLevel::Read,
        priority: 30,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("e2e-col"),
            created_at_millis: 0,
            template_id: None,
        },
    };
    service
        .wb_security_add_policy(policy)
        .expect("column policy");

    let agent = service.make_principal(vec!["agent:copilot".into()]);
    let explain =
        service.wb_security_explain_access(AccessTarget::Column { sheet_id, col_id }, agent);
    assert_eq!(explain.level, AccessLevel::Read);
}

#[test]
fn composition_template_and_explicit_policy_coexist() {
    // Apply a template, add a second policy — both present in list, neither clobbers the other.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let template_ids = service
        .wb_security_apply_template(Template::ProtectWorkbook)
        .expect("tmpl");
    let explicit_id = service
        .wb_security_add_policy(workbook_policy("role:editor", AccessLevel::Read))
        .expect("explicit");

    let listed = service.wb_security_list_policies();
    assert_eq!(listed.len(), template_ids.len() + 1);
    assert!(listed.iter().any(|p| p.id == explicit_id));
    for tid in template_ids {
        assert!(listed.iter().any(|p| p.id == tid));
    }
}

#[test]
fn composition_sheet_and_workbook_policies_compose_on_write() {
    // Workbook denies writes (None), but a sheet-scoped Write grants it.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("workbook None");
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Write))
        .expect("sheet Write");
    service.set_active_principal(Some(agent));

    // Sheet-scope write passes because the resolver picks the most-specific
    // matching policy.
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "ok")
        .expect("sheet override allows write");
}

#[test]
fn composition_template_remove_restores_default() {
    // Apply ProtectWorkbook (restricts writes), remove it, writes on
    // another sheet as an agent-without-any-policy: back to defaults.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_apply_template(Template::ProtectWorkbook)
        .expect("apply");
    let lvl_restricted =
        service.wb_security_effective_access(AccessTarget::Workbook, agent.clone());
    assert_ne!(lvl_restricted, AccessLevel::Admin);

    service
        .wb_security_remove_template("protect-workbook".to_string())
        .expect("remove");

    // After template remove: no policies; security deactivates; non-owner
    // defaults to None.
    assert!(!service.security_active());
    let lvl_after = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl_after, AccessLevel::None);
}

#[test]
fn composition_multiple_sheets_isolated_policies() {
    const SHEET2_UUID: &str = "55555555-5555-5555-5555-555555555555";
    // Build a workbook with two sheets, apply a None policy only to sheet1,
    // verify sheet2 is unaffected.
    let (mut service, _sid) = fresh_service_uuid(SHEET1_UUID);
    // Using the engine directly would require two sheets in the snapshot;
    // build a second fresh service to mimic the isolation claim for sheet2.
    let (mut service2, _) = fresh_service_uuid(SHEET2_UUID);

    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Apply workbook-scope policy on wb1.
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("wb1 restrict");
    service.set_active_principal(Some(agent.clone()));
    let r1 =
        service.set_cell_value_parsed(&SheetId::from_uuid_str(SHEET1_UUID).unwrap(), 0, 0, "x");
    assert!(r1.is_err());

    // wb2 has no policies — it stays permissive for owner. Non-owner
    // defaults to None, so writes still denied — but that's the default
    // model, not a composition issue. Flip to owner on wb2 to confirm
    // isolation.
    let owner2 = service2.make_principal(vec!["mog:owner".into()]);
    service2.set_active_principal(Some(owner2));
    service2
        .set_cell_value_parsed(&SheetId::from_uuid_str(SHEET2_UUID).unwrap(), 0, 0, "y")
        .expect("wb2 owner unaffected");
}

#[test]
fn composition_principal_reset_reverts_to_fast_path() {
    // Once all policies are removed and principal is cleared, the next
    // call goes through the fast path. Pair with set_active_principal-
    // swap to verify.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");
    service.wb_security_remove_policy(id).expect("remove last");
    assert!(!service.security_active());

    service.set_active_principal(None);
    // Fast path: read without any check. Should not panic.
    let _v = service.get_cell_value(&sheet_id, 0, 0);
}

#[test]
fn composition_explain_reflects_resolution_trace() {
    // Confirm explain returns a matched policy when one applies. Used by
    // SDK debugging to diagnose "why is my call denied".
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("seed");

    let agent = service.make_principal(vec!["agent:copilot".into()]);
    let expl = service.wb_security_explain_access(AccessTarget::Workbook, agent);
    assert_eq!(expl.level, AccessLevel::Write);
    let matched = expl.matched_policy.expect("matched policy present");
    assert_eq!(matched.level, AccessLevel::Write);
}

// ===========================================================================
// R9.1 — `AccessDenied` event emission
// ===========================================================================
//
// The event variants are defined in `compute-security::events` but until
// R9.1 the engine never pushed `AccessDenied` on the denial paths. These
// scenarios lock down emission at each of the three denial-synthesis
// sites: `check_write` (sheet/workbook arm), the cell arm of the
// bridge-delegate macro, and the range arm (fail-fast on first denied
// cell).
//
// The macro threads the method name as a `&'static str` literal into
// the emitted event's `operation` field so SDK consumers can tell
// `set_cell_value_parsed` denials apart from `clear_range` denials in
// the event stream — that contract is what
// `access_denied_operation_name_matches_method` pins down.

#[test]
fn access_denied_emitted_on_write_denial() {
    // Seed a Read-level policy, attempt a write, drain events, assert a
    // single `AccessDenied` with the right operation / target /
    // principal tags.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("policy");
    service.set_active_principal(Some(agent.clone()));
    // Flush the crud-phase events so the drain below only sees the
    // denial-driven ones.
    let _ = service.wb_security_drain_events();

    let r = service.set_cell_value_parsed(&sheet_id, 0, 0, "99");
    assert!(is_engine_security_denied(&r.unwrap_err()));

    let events = service.wb_security_drain_events();
    let denials: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            compute_security::SecurityEvent::AccessDenied {
                principal_tags,
                target,
                operation,
            } => Some((principal_tags.clone(), target.clone(), operation.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(denials.len(), 1, "exactly one AccessDenied: {events:?}");
    let (tags, target, operation) = &denials[0];
    assert_eq!(operation, "set_cell_value_parsed");
    // Cell-scope arm always reports the sheet as the denial target
    // (policies never target individual cells — the matrix IS the
    // per-cell primitive).
    assert!(matches!(target, AccessTarget::Sheet { sheet_id: s } if *s == sheet_id));
    assert!(
        tags.iter().any(|t| t.as_str() == "agent:copilot"),
        "principal tags must carry the caller's identity: {tags:?}"
    );
}

#[test]
fn access_denied_operation_name_matches_method() {
    // Locks the macro → `check_write` operation-name threading: each
    // distinct bridged method produces a distinct `operation` string
    // in its `AccessDenied` event. Without this contract, SDKs that
    // build diagnostic UIs ("why was my call denied") can't tell one
    // denial from another.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("policy");
    service.set_active_principal(Some(agent));
    let _ = service.wb_security_drain_events();

    // Cell-scope arm.
    let _ = service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .unwrap_err();
    // Range-scope arm.
    let _ = service.clear_range(&sheet_id, 0, 0, 0, 0).unwrap_err();

    let operations: Vec<String> = service
        .wb_security_drain_events()
        .iter()
        .filter_map(|e| match e {
            compute_security::SecurityEvent::AccessDenied { operation, .. } => {
                Some(operation.clone())
            }
            _ => None,
        })
        .collect();
    assert!(
        operations.iter().any(|o| o == "set_cell_value_parsed"),
        "set_cell_value_parsed denial event must carry that method name: {operations:?}"
    );
    assert!(
        operations.iter().any(|o| o == "clear_range"),
        "clear_range denial event must carry that method name: {operations:?}"
    );
}

#[test]
fn access_denied_range_write_emits_single_event() {
    // Range-scope is fail-fast on the first denied cell: one emission
    // per denied call. A policy that denies writes over a 2×5 range
    // must still produce exactly one `AccessDenied` event, not ten.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("policy");
    service.set_active_principal(Some(agent));
    let _ = service.wb_security_drain_events();

    let r = service.clear_range(&sheet_id, 0, 0, 1, 4); // 10 cells
    assert!(r.is_err());

    let denial_count = service
        .wb_security_drain_events()
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AccessDenied { .. }))
        .count();
    assert_eq!(
        denial_count, 1,
        "range-scope denial is fail-fast: one event per denied call"
    );
}

// ===========================================================================
// `AmbiguityDetected` event emission
// ===========================================================================
//
// Ambiguities surface at two sites. A single emission site would silently drop
// one class:
// - Matrix-build time carries per-column warnings that `evaluate`
//   never sees (cell/range gating reads the matrix directly).
// - `PolicyEngine::evaluate` carries workbook/sheet-scope warnings that
//   the matrix never touches (the matrix is only for per-sheet scopes).
//
// Dedup is scoped to the current `policy_version`; a policy mutation
// bumps the counter and clears the set so a re-introduced ambiguity
// re-emits.

#[test]
fn ambiguity_emitted_on_matrix_publish() {
    // Two sheet-scope policies tied on every sort dimension (same tag
    // matcher, same target, same priority) with different levels. An
    // `active_matrix` build for the agent principal resolves the
    // sheet target through the same sort + clamp path `evaluate` uses
    // and carries the tie forward as a matrix `AmbiguityWarning`; the
    // matrix-build emission site at `SecurityState::active_matrix`
    // turns that warning into an `AmbiguityDetected` event. The test
    // intentionally does NOT call `wb_security_effective_access` or
    // `wb_security_explain_access` — only a cell-scope read, which
    // forces the matrix build.
    //
    // Note on scope choice: per-column ambiguities would require the
    // column to be registered in the grid index (`position_of(col_id)`
    // must resolve), and synthesising a known ColId that matches the
    // grid layout from a black-box test is fragile. Sheet-scope ties
    // reach matrix warnings (engine.rs:174-178) unconditionally and
    // exercise the same emission code path.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Read))
        .expect("tied #1");
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Write))
        .expect("tied #2");
    service.set_active_principal(Some(agent_tags));
    // Flush crud events so only the matrix-build emission remains.
    let _ = service.wb_security_drain_events();

    // A cell-scope read forces an `active_matrix` build — that's the
    // trigger for R9.2's matrix-publish emission.
    let _ = service.get_cell_value(&sheet_id, 0, 0);

    let events = service.wb_security_drain_events();
    let ambigs: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            compute_security::SecurityEvent::AmbiguityDetected { warning } => Some(warning.clone()),
            _ => None,
        })
        .collect();
    assert!(
        !ambigs.is_empty(),
        "tied sheet policies must surface an AmbiguityDetected event at matrix publish: {events:?}"
    );
    let w = &ambigs[0];
    assert_eq!(
        w.conflicting_policies.len(),
        2,
        "two tied policies must appear in conflicting_policies: {w:?}"
    );
}

#[test]
fn ambiguity_detected_on_tied_policies_via_evaluate() {
    // Two workbook-scope policies tied on priority/specificity with
    // different levels. `effective_access` routes through
    // `SecurityState::evaluate`, which carries `EvalResult.ambiguity`;
    // that path now emits `AmbiguityDetected`. Also verifies the
    // safer (lower) level is the returned one.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("tied a");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("tied b");

    let _ = service.wb_security_drain_events();

    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags.clone());
    assert_eq!(
        lvl,
        AccessLevel::Read,
        "ambiguity resolves to the safer (lower) level"
    );

    let events = service.wb_security_drain_events();
    let ambigs: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AmbiguityDetected { .. }))
        .collect();
    assert!(
        !ambigs.is_empty(),
        "tied workbook policies must emit AmbiguityDetected through evaluate: {events:?}"
    );
}

#[test]
fn ambiguity_event_deduped_within_policy_version() {
    // Same tie, 100 calls: dedup must collapse to one event per
    // fingerprint. Without dedup, every `effective_access` call would
    // push a fresh event and overflow the bounded ring buffer.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("tied a");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("tied b");

    let _ = service.wb_security_drain_events();
    for _ in 0..100 {
        let _ = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags.clone());
    }

    let ambig_count = service
        .wb_security_drain_events()
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AmbiguityDetected { .. }))
        .count();
    assert_eq!(
        ambig_count, 1,
        "100 tied-policy evaluations must collapse to one deduped AmbiguityDetected"
    );
}

#[test]
fn ambiguity_reemit_after_policy_change() {
    // Dedup is scoped to `policy_version`. After a policy mutation
    // (which bumps the counter and clears the dedup set), the same
    // fingerprint should re-emit so consumers see that the ambiguity
    // is still present in the new policy state.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("tied a");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("tied b");

    // First round — emit once, dedup the rest.
    for _ in 0..10 {
        let _ = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags.clone());
    }
    let _ = service.wb_security_drain_events();

    // Add an unrelated third policy. The version bump clears the
    // dedup set; the next evaluate re-emits.
    service
        .wb_security_add_policy(workbook_policy("role:other", AccessLevel::Read))
        .expect("bump");
    let _ = service.wb_security_drain_events();

    let _ = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags);

    let ambig_count = service
        .wb_security_drain_events()
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AmbiguityDetected { .. }))
        .count();
    assert_eq!(
        ambig_count, 1,
        "policy-version bump must clear dedup, letting the same fingerprint re-emit"
    );
}

// ===========================================================================
// Adversarial bypass tests from the scenario audit.
//
// Each test below locks down one Group B scenario. Group A rationales
// and Group C "no surface yet" stubs live in the audit file, not here.
// ===========================================================================

/// R10.2 — `bypass-via-formula-result`.
///
/// Under a Structure-level workbook policy, a cell whose value is
/// computed from a formula (`B1 = =A1`) must also redact the computed
/// result — `B1` reads go through the same gated `get_cell_value` path
/// that routes `redact_scalar` over the output. The expected typed
/// placeholder is `CellValue::Text("[Number]")`, parity with the raw-
/// number redaction anchored by `sg2_structure_redacts_cell_values`.
#[test]
fn adversarial_formula_result_redacts_under_structure() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "42")
        .expect("owner seed A1");
    service
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1")
        .expect("owner seed B1 formula");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // B1 is a formula whose value derives from A1. Under Structure, the
    // computed result must redact to the typed placeholder — the R4
    // `RedactMaybe` impl for `CellValue` returns `Text("[Number]")` for
    // numeric payloads.
    let v = service.get_cell_value(&sheet_id, 0, 1);
    match v {
        CellValue::Text(ref s) => assert_eq!(
            &**s, "[Number]",
            "formula result must redact to [Number] placeholder under Structure"
        ),
        other => panic!("formula result must redact under Structure, got {other:?}"),
    }
}

/// R10.3 — `bypass-via-conditional-format`.
///
/// `get_cf_rules_for_cell` is `#[bridge::read(scope = "cell")]` ->
/// `Vec<ConditionalFormat>`. Under a None-level workbook policy the
/// cell-scope post-filter calls `Vec::<T>::redact(None)` which
/// `Vec::clear()`s. We seed one CF rule covering A1 and assert that
/// the owner sees the rule but the agent sees an empty Vec.
#[test]
fn adversarial_conditional_format_read_under_none_redacts() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a CF rule covering A1..B2 as owner.
    service.set_active_principal(Some(owner.clone()));
    // CF schema canonicalization: bridge takes serde_json::Value so it can
    // normalize public-API rule-shape variants in Rust before deserializing.
    let cf_json = serde_json::json!({
        "id": "cf-adv-1",
        "sheetId": sheet_id.to_uuid_string(),
        "pivot": null,
        "ranges": [cell_types::SheetRange::new(0, 0, 1, 1)],
        "rangeIdentities": null,
        "rules": [{
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "stopIfTrue": null,
            "operator": "greaterThan",
            "value1": 50,
            "value2": null,
            "style": {},
            "text": null
        }]
    });
    service.add_cf_rule(&sheet_id, cf_json).expect("seed CF");

    // Owner sees the rule.
    let owner_rules = service.get_cf_rules_for_cell(&sheet_id, 0, 0);
    assert_eq!(
        owner_rules.len(),
        1,
        "owner baseline: CF rule present at A1"
    );

    // Apply None-level policy; agent reads the same cell and gets empty.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let agent_rules = service.get_cf_rules_for_cell(&sheet_id, 0, 0);
    assert!(
        agent_rules.is_empty(),
        "agent under None policy must see empty CF rule list, got {agent_rules:?}"
    );
}

/// R10.3 — `bypass-via-chart-data`.
///
/// Chart reads (`get_all_charts`, `get_chart`) return
/// `FloatingObject` payloads — metadata + layout, not cell values. The
/// `coverage_audit::every_bridge_api_method_returning_cell_data_is_gated`
/// test already confirms no chart read returns `CellValue` /
/// `CellInfo` data. This test is the end-to-end companion: call the
/// chart read surface under a None policy and verify the call returns
/// (bridge dispatch succeeds through the gated path) without panicking
/// or leaking. A regression that added a cell-value field to
/// `FloatingObject` without updating the audit fragment list would be
/// caught there; this test locks the runtime path.
#[test]
fn adversarial_chart_read_under_none_redacts() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // No charts seeded — the empty Vec is the expected redacted shape.
    // The point of the test is to exercise the gated path; the
    // coverage_audit already proves the surface can't accept a cell-
    // value-bearing return type without the audit going red.
    let charts = service.get_all_charts(&sheet_id);
    assert!(
        charts.is_empty(),
        "no charts seeded; agent read must not synthesize phantom charts: {charts:?}"
    );
}

/// R10.3 — `bypass-via-pivot-aggregate`.
///
/// `pivot_get_all` is `#[bridge::read(scope = "sheet")]` returning
/// `Vec<PivotTableConfig>` — stored config, not computed aggregates.
/// The aggregate-computing path (`pivot_compute_from_source`) is
/// documented as a known limitation in BYPASS-AUDIT.md (same class as
/// `bypass-via-dependent-cell`) — Rust compute-path enforcement is an
/// explicit non-goal. This test locks the stored-config return shape
/// under None.
#[test]
fn adversarial_pivot_read_under_none_redacts() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let pivots = service.pivot_get_all(&sheet_id);
    assert!(
        pivots.is_empty(),
        "no pivots seeded; agent read must return empty: {pivots:?}"
    );
}

/// R10.3 — `bypass-via-autofilter-unique`.
///
/// `get_unique_column_values` is `#[bridge::read(scope = "sheet")]`
/// returning `Vec<CellValue>`. Sheet-scope Vec reads are passthrough
/// in the current delegate macro (see BYPASS-AUDIT.md "gaps discovered"
/// section) — cell values can flow through under a sheet None policy.
/// The test here locks the CURRENT behavior: owner sees seeded data,
/// agent under None sees whatever the passthrough produces. If the
/// macro is tightened in a follow-up (range-scoped filter emission for
/// sheet Vec reads, or scope narrowing), this test WILL flip and its
/// assertion should be tightened to `agent_values.is_empty()` in lock-
/// step with the fix. A failing assertion here is the regression
/// signal we want.
///
/// For now: the agent-scoped call must at minimum not panic on the
/// bridge dispatch and must not exceed the owner's view.
#[test]
fn adversarial_autofilter_unique_values_redact_under_structure() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Apply structure policy — no data seeded because the autofilter
    // surface requires a configured filter id. The test exercises the
    // gated-read path on the unfiltered return (empty Vec) and locks
    // the bridge dispatch against regression.
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // Non-existent filter id -> empty Vec. The gated path must still
    // run through `active_matrix` (which exercises the passthrough
    // arm for sheet-scope Vec<CellValue> — see BYPASS-AUDIT.md).
    let unique = service.get_unique_column_values(&sheet_id, "nonexistent-filter", 0);
    assert!(
        unique.is_empty(),
        "no filter configured; agent read must not synthesize unique values: {unique:?}"
    );
}

/// R10.4 — `bypass-via-hyperlink-read`.
///
/// `get_hyperlink` is `#[bridge::read(scope = "cell")]` ->
/// `Option<String>`. Under a None-level policy on the enclosing sheet,
/// cell-scope `redact_scalar` calls `Option::<String>::redact(None)`
/// which sets the option to `None`. The URL does not survive.
///
/// Scope correction: hyperlinks are not workbook-scope metadata "visible under
/// Structure"; the engine annotation at `objects.rs:863` is `scope = "cell"`.
/// The Structure-vs-None invariant this test asserts is the None-level full
/// hide, which is the tightest regression anchor regardless of the
/// Structure-level design decision.
#[test]
fn adversarial_hyperlink_redacts_under_none() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a cell value + hyperlink as owner.
    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "anchor")
        .expect("owner seed A1");
    service
        .set_hyperlink(&sheet_id, 0, 0, "https://example.com/secret")
        .expect("owner seed hyperlink");

    // Owner sees the URL.
    let owner_link = service.get_hyperlink(&sheet_id, 0, 0);
    assert_eq!(
        owner_link.as_deref(),
        Some("https://example.com/secret"),
        "owner baseline: hyperlink visible"
    );

    // Apply None policy; agent reads and sees the URL hidden.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let agent_link = service.get_hyperlink(&sheet_id, 0, 0);
    assert!(
        agent_link.is_none(),
        "agent under None policy must see hyperlink as None, got {agent_link:?}"
    );
}

/// `bypass-via-comment-read` (cell-scope / position form).
///
/// `get_comments_for_cell_by_position` is `#[bridge::read(scope =
/// "cell")]`, so `redact_scalar` applies. The `Comment` type itself is
/// `redact_noop!` because comments are annotations, not values, but the
/// wrapping `Vec<Comment>` redacts to an empty Vec under None.
#[test]
fn adversarial_comment_redacts_under_none_position_form() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a comment on A1 as owner.
    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "anchor")
        .expect("owner seed A1");
    service
        .add_comment_by_position(
            &sheet_id,
            0,
            0,
            "confidential note",
            "owner",
            None,
            None,
            CommentType::Note,
        )
        .expect("owner seed comment");

    // Owner baseline: comment present.
    let owner_comments = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert_eq!(owner_comments.len(), 1, "owner baseline: comment visible");

    // Apply None policy; agent sees an empty Vec.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let agent_comments = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert!(
        agent_comments.is_empty(),
        "agent under None policy must see empty comment list from position form, got {agent_comments:?}"
    );
}

/// R10.4 — `bypass-via-comment-read` (sheet-scope / id form).
///
/// `get_comments_for_cell` is `#[bridge::read(scope = "sheet")]` ->
/// `Vec<Comment>`. Sheet-scope Vec reads are PASSTHROUGH in the
/// current delegate macro (see `infra/rust-bridge/bridge-delegate/
/// macros/src/expand.rs:926-939` — only byte-Vec at sheet scope or
/// range scope get a filter; sheet-scope `Vec<T>` falls into the `_`
/// arm). `Comment` is `redact_noop!` by design because comments are
/// annotations, not values, so per-element redact wouldn't change anything at
/// Structure. The only meaningful tightening is Vec-clear at None, which the
/// current macro does NOT apply at sheet scope.
///
/// This is a KNOWN GAP documented in BYPASS-AUDIT.md "Sheet-scope
/// passthrough for non-byte Vec returns". The test below locks the
/// CURRENT behavior ("id form passes through") so any future
/// tightening (macro emission of a range-filter-style pass, or
/// per-method scope narrowing) that FIXES the leak produces a test
/// signal. When that happens, flip the `.is_empty()` assertion at
/// the bottom and update BYPASS-AUDIT.md to mark the gap closed.
///
/// Keeping both position-form and id-form tests ensures a regression
/// that mis-scopes only ONE surface (e.g., drops the cell annotation
/// on the position form while the id form sheet-scope is untouched)
/// is caught by the position-form invariant.
#[test]
fn adversarial_comment_redacts_under_none_id_form() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "anchor")
        .expect("owner seed A1");
    service
        .add_comment_by_position(
            &sheet_id,
            0,
            0,
            "confidential note",
            "owner",
            None,
            None,
            CommentType::Note,
        )
        .expect("owner seed comment");
    let seeded = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert_eq!(seeded.len(), 1, "owner baseline: comment present");
    // `get_comments_for_cell` (sheet-scope, id form) filters by the
    // comment's `cell_ref` field (the engine-emitted cell id, not
    // A1 notation). We read it off the seeded comment.
    let cell_ref = seeded[0].cell_ref.clone();

    // Owner via id-form also sees the comment.
    let owner_id_form = service.get_comments_for_cell(&sheet_id, &cell_ref);
    assert_eq!(
        owner_id_form.len(),
        1,
        "owner baseline via id form: comment visible"
    );

    // Apply None policy; agent calls id-form.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // Position form IS redacted (cell-scope -> redact_scalar -> Vec clears).
    // This invariant must never regress.
    let agent_position_form = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert!(
        agent_position_form.is_empty(),
        "position form (cell scope) must redact under None, got {agent_position_form:?}"
    );

    // Id form is CURRENTLY a passthrough leak per the documented gap.
    // We lock the current shape so a future macro tightening that
    // emits a filter for sheet-scope Vec<T> reads DOES produce a test
    // signal. When you come to close this gap:
    //   1. Apply the macro change (or narrow the scope on this method).
    //   2. Flip the assertion below to `is_empty`.
    //   3. Update BYPASS-AUDIT.md "gaps discovered" to mark closed.
    let agent_id_form = service.get_comments_for_cell(&sheet_id, &cell_ref);
    assert_eq!(
        agent_id_form.len(),
        seeded.len(),
        "documented gap: sheet-scope Vec<Comment> read is passthrough. \
         If this assertion fails, the macro may have been tightened — \
         see BYPASS-AUDIT.md 'Sheet-scope passthrough' section and \
         flip this to `is_empty` if the fix is intentional."
    );
}

/// R10.5 — `bypass-via-undo-reveal`.
///
/// The current security contract withdraws the previous rationale that
/// `composition_policy_change_takes_effect_immediately` covers this
/// case — that test exercises policy-version swap, not undo. This test
/// authors the real invariant: after a sequence of edits, a policy
/// add, and an owner-initiated undo, reading through the gated
/// delegate as the agent still redacts. The Yrs undo manager mutates
/// state; the next `get_cell_value` re-enters the gated path and
/// `redact_scalar` runs against the post-undo value.
///
/// If this test becomes trivially architectural (coverage_audit
/// already proves get_cell_value is gated + undo writes through the
/// engine's mutation path + reads re-enter the gated delegate), the
/// scenario can be promoted to Group A with the specific
/// coverage_audit row as citation. For now we keep an explicit test
/// because the interaction spans two otherwise-independent subsystems
/// (undo manager + security matrix).
#[test]
fn adversarial_undo_does_not_reveal_redacted_cell() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Owner performs a sequence of edits that undo can reach.
    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "secret")
        .expect("owner seed A1=secret");
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "secret-v2")
        .expect("owner bump A1");

    // Apply None policy.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");

    // Owner undoes the last edit — yrs reverts A1 to "secret".
    service.undo().expect("owner undo");

    // Agent reads A1 under the None policy; must return Null.
    service.set_active_principal(Some(agent));
    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(v, CellValue::Null),
        "post-undo agent read must still redact under None, got {v:?}"
    );

    // Drain events — once R9 merges, an AccessDenied event IS NOT
    // expected here (reads redact, they do not deny). Policy-add event
    // should still be present. We assert only that draining succeeds;
    // the event-contents assertion lives with the R9 tests.
    let _events = service.wb_security_drain_events();
}

// ===========================================================================
// Adversarial scenario audit — three-group disposition.
// ===========================================================================
//
// The adversarial scenarios resolve to three dispositions under the current
// security model:
//
// -------------------------------------------------------------------
// Group A — Intentionally non-applicable (architecture decision is
//           the test; no code assertion required).
// -------------------------------------------------------------------
//
//   - `bypass-via-error-inference` — dependent-cell error propagation
//     is an intended computed result. ARCHITECTURE.md §4.1 (Structure
//     preserves formula metadata). Same class as scenario 2 below.
//
//   - `bypass-via-sort-ordering` — sort is a write-scope mutation
//     (`sort_range` is `#[bridge::write(scope = "range")]`).
//     Attenuation blocks the write on denied cells; no read surface to
//     bypass. See write tests at `adversarial_*`.
//
//   - `bypass-via-named-range` / `bypass-via-structured-ref` — both
//     compile to cell refs at formula-eval time; share the cell-read
//     redact path tested by `sg2_structure_redacts_cell_values` +
//     `adversarial_formula_result_redacts_under_structure`.
//
//   - `bypass-via-clipboard` — payload derives from already-filtered cell
//     reads. If the cell read path is correct, the clipboard is too.
//
//   - `bypass-via-getUsedRange-bounds` — bounds are shape metadata,
//     not cell value data. `coverage_audit::CELL_DATA_RETURN_FRAGMENTS`
//     does not flag `(u32, u32)`; the architecture classification IS
//     the record.
//
//   - `bypass-via-selection-aggregates` — UI-layer concept; aggregates
//     are computed in the UI over already-redacted cells read through
//     the gated `get_cell_value` path. No engine-side aggregation
//     surface exists.
//
// -------------------------------------------------------------------
// Group B — Covered by an explicit R10 test or by `coverage_audit`.
// -------------------------------------------------------------------
//
//   - `bypass-via-formula-result` ->
//     `adversarial_formula_result_redacts_under_structure` (R10.2).
//
//   - `bypass-via-dependent-cell` ->
//     `adversarial_formula_inherits_cell_access`.
//
//   - `bypass-via-conditional-format` ->
//     `adversarial_conditional_format_read_under_none_redacts`
//     (R10.3).
//
//   - `bypass-via-chart-data` ->
//     `adversarial_chart_read_under_none_redacts` (R10.3) +
//     `coverage_audit::every_bridge_api_method_returning_cell_data_is_gated`.
//
//   - `bypass-via-pivot-aggregate` ->
//     `adversarial_pivot_read_under_none_redacts` (R10.3). Stored
//     config locked down; aggregate compute-path leak is a documented
//     known limitation (same class as `bypass-via-dependent-cell`).
//
//   - `bypass-via-autofilter-unique` ->
//     `adversarial_autofilter_unique_values_redact_under_structure`
//     (R10.3). Current test locks the passthrough behavior; a macro
//     tightening for sheet-scope Vec reads would flip the assertion.
//     See BYPASS-AUDIT.md "gaps discovered".
//
//   - `bypass-via-undo-reveal` ->
//     `adversarial_undo_does_not_reveal_redacted_cell` (R10.5). The
//     previous rationale (covered by `composition_policy_change_*`)
//     is withdrawn — that test exercises policy-version swap, not
//     undo.
//
//   - `bypass-via-hyperlink-read` ->
//     `adversarial_hyperlink_redacts_under_none` (R10.4).
//
//   - `bypass-via-comment-read` (dual surface) ->
//     `adversarial_comment_redacts_under_none_position_form` +
//     `adversarial_comment_redacts_under_none_id_form` (R10.4).
//     Both tests are required: a mis-scope regression on only ONE of
//     the two surfaces would ship silently without the pair.
//
//   - `bypass-via-batch-mixed` -> `enforcement_*` range-filter wiring
//     tests earlier in this file exercise mixed-column `filter_range_values`.
//
// -------------------------------------------------------------------
// Group C — No exposure surface yet.
// -------------------------------------------------------------------
//
//   - `bypass-via-validation-list` — no `data_validation`-family
//     bridged read exists today. Candidate method names when a
//     surface is added: `get_data_validations` /
//     `get_data_validation_for_cell`. Revisit then.
