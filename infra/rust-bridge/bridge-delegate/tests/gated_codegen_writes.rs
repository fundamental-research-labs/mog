#[path = "gated_codegen/support.rs"]
mod support;

pub use support::{
    AccessLevel, AccessTarget, CellAddr, CellRange, FakeDispatch, FakeEngine, PlainService,
    Principal, PrincipalPool, SheetAccessMatrix, SheetId, StubService, new_service,
};
pub use support::{compute_security, compute_wire, value_types};

#[path = "gated_codegen/descriptors.rs"]
mod descriptors;

use std::sync::atomic::Ordering;

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__bridge_descriptor_stub_gated,
);

#[test]
fn cell_write_gated_true_denied_when_matrix_denies() {
    let mut svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let err = svc
        .set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 5)
        .unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("Denied") || err_str.contains("denied"),
        "cell write under matrix-None must surface a Denied error, got: {}",
        err_str
    );
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(Ordering::Relaxed),
        0,
        "cell-scope writes do not call check_write"
    );
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        1,
        "cell-scope writes fetch the matrix once"
    );
}

#[test]
fn cell_write_gated_true_allowed_when_matrix_permits() {
    let mut svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::Write;
    svc.set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 5)
        .unwrap();
}

#[test]
fn structural_uses_admin_level() {
    let mut svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.insert_rows(SheetId(0), 0, 1).unwrap();
    let engine = svc.dispatch.engine();
    assert_eq!(engine.check_write_calls.load(Ordering::Relaxed), 1);
    assert_eq!(
        *engine.last_check_write_required.lock().unwrap(),
        Some(AccessLevel::Admin),
        "structural methods must require Admin access"
    );
}
