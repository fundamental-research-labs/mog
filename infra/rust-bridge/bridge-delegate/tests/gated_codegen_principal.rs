#[path = "gated_codegen/support.rs"]
mod support;

pub use support::{
    AccessLevel, AccessTarget, CellAddr, CellRange, FakeDispatch, FakeEngine, PlainService,
    Principal, PrincipalPool, SheetAccessMatrix, SheetId, StubService, new_service,
};
pub use support::{compute_security, compute_wire, value_types};

#[path = "gated_codegen/descriptors.rs"]
mod descriptors;

use std::sync::Arc;
use std::sync::atomic::Ordering;

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__bridge_descriptor_stub_gated,
);

#[test]
fn gated_true_with_no_principal_uses_anonymous() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, u32::default(), "anonymous + None level must redact");
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        1,
        "gated path must fetch matrix"
    );
}

#[test]
fn gated_true_with_some_principal_normal_resolution() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:owner"))));
    svc.dispatch.engine().matrix_level = AccessLevel::Read;
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42, "Read level passes through raw value");
}

#[test]
fn needs_principal_bypasses_fast_path() {
    let mut svc = new_service();
    let pid = svc.add_policy(123).unwrap();
    assert_eq!(pid, 7);
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(Ordering::Relaxed),
        1,
        "needs_principal bypasses fast path"
    );
}

#[test]
fn needs_principal_signature_strips_trailing_param() {
    let mut svc = new_service();
    let _pid = svc.add_policy(1).unwrap();
}

#[test]
fn needs_principal_uses_active_principal_when_present() {
    let mut svc = new_service();
    let principal = Principal::named("agent:owner");
    svc.active_principal
        .store(Arc::new(Some(principal.clone())));

    let pid = svc.add_policy(123).unwrap();
    assert_eq!(pid, 7);
    assert_eq!(
        svc.dispatch.engine().last_add_policy_caller.as_ref(),
        Some(&principal),
        "needs_principal must pass the active principal into the engine"
    );
}
