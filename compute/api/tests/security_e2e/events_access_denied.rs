use super::fixtures::*;

use compute_security::{AccessLevel, AccessTarget};

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
