use super::fixtures::*;

use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::YrsComputeEngine;
use compute_security::{AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, Template};
use value_types::CellValue;

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
