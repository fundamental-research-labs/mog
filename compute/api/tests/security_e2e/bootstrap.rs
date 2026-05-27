use super::fixtures::*;

use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::YrsComputeEngine;
use compute_security::AccessLevel;
use value_types::ComputeError;

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
