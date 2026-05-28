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

bridge_delegate::delegate!(
    target = PlainService,
    dispatch = dispatch,
    skip_default_imports = true,
    crate::__bridge_descriptor_stub_plain,
);

#[test]
fn gated_false_with_no_principal_passthrough() {
    let svc = new_service();
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42);
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        0,
        "fast path must skip matrix fetch"
    );
}

#[test]
fn gated_false_with_some_principal_still_passthrough() {
    let svc = new_service();
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:foo"))));
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42);
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        0
    );
}

#[test]
fn security_active_flip_changes_path() {
    let svc = new_service();
    let _ = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    let calls_after_first = svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed);

    svc.security_active.store(true, Ordering::Relaxed);
    let _ = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    let calls_after_second = svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed);

    assert_eq!(calls_after_first, 0);
    assert_eq!(calls_after_second, 1);
}

#[test]
fn cell_write_gated_false_does_not_touch_matrix() {
    let mut svc = new_service();
    svc.set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 5)
        .unwrap();
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        0,
        "fast path must skip matrix fetch"
    );
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(Ordering::Relaxed),
        0,
        "fast path must skip check_write"
    );
}

#[test]
fn workbook_read_gated_false_skips_effective_access() {
    let svc = new_service();
    svc.dispatch.engine().workbook_effective = AccessLevel::None;
    let sheets = svc.list_sheets().unwrap();
    assert_eq!(sheets, vec![0, 1, 2]);
    assert_eq!(
        svc.dispatch
            .engine()
            .effective_access_calls
            .load(Ordering::Relaxed),
        0,
        "fast path must skip the workbook effective_access pre-check"
    );
}

#[test]
fn security_active_flip_true_to_false_returns_to_fast_path() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().workbook_effective = AccessLevel::Read;
    let _ = svc.list_sheets().unwrap();
    let calls_after_gated = svc
        .dispatch
        .engine()
        .effective_access_calls
        .load(Ordering::Relaxed);

    svc.security_active.store(false, Ordering::Relaxed);
    let _ = svc.list_sheets().unwrap();
    let calls_after_flip_off = svc
        .dispatch
        .engine()
        .effective_access_calls
        .load(Ordering::Relaxed);

    assert_eq!(calls_after_gated, 1);
    assert_eq!(
        calls_after_flip_off, 1,
        "flipping security_active back to false must restore fast path"
    );
}

#[test]
fn non_gated_service_has_no_principal_state() {
    let mut svc = PlainService {
        dispatch: FakeDispatch::new(),
    };
    svc.set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 7)
        .unwrap();
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(Ordering::Relaxed),
        0,
        "non-gated service never calls check_write"
    );
}

#[test]
fn non_gated_read_goes_straight_to_engine() {
    let svc = PlainService {
        dispatch: FakeDispatch::new(),
    };
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42);
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        0,
        "non-gated read never fetches matrix"
    );
}
