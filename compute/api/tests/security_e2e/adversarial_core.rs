use super::fixtures::*;

use compute_security::{AccessLevel, AccessPolicyPatch};
use value_types::{CellValue, ComputeError};

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
