use super::fixtures::*;

use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::ComputeEngine;
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
        "first policy must activate security"
    );
}

// ===========================================================================
// Seed-on-load — R2.3
// ===========================================================================

#[test]
fn wrapping_configured_engine_activates_service_before_any_call() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_with_sheet(SHEET1_UUID)).expect("from_snapshot");
    let pool = compute_security::PrincipalPool::new();
    let owner = pool.intern(vec!["mog:owner".into()]);
    engine
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure), &owner)
        .expect("seed native policy");

    let service = ComputeService::new(Dispatch::from_engine(engine).expect("dispatch"));
    assert!(service.security_active());
    assert_eq!(service.wb_security_list_policies().len(), 1);
}
