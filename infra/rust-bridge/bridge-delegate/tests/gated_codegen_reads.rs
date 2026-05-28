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
fn cell_read_uses_redact_scalar() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, u32::default(), "cell read must redact uniform None");
    assert_eq!(
        svc.dispatch.engine().matrix_calls.load(Ordering::Relaxed),
        1,
        "cell read must fetch the active matrix"
    );
}

#[test]
fn range_read_uses_filter_range_values() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let vals = svc
        .get_range(
            SheetId(0),
            CellRange {
                start: CellAddr { row: 0, col: 0 },
                end: CellAddr { row: 1, col: 1 },
            },
        )
        .unwrap();
    assert!(
        vals.iter().all(|v| *v == 0),
        "range filter redacts uniform None"
    );
}

#[test]
fn viewport_read_uses_filter_viewport_buffer() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let buf = svc.get_viewport(SheetId(0), 0).unwrap();
    assert!(buf.is_empty(), "viewport filter clears uniform None");
}

#[test]
fn workbook_read_gated_denied_when_effective_below_read() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:guest"))));
    svc.dispatch.engine().workbook_effective = AccessLevel::None;
    let err = svc.list_sheets().unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("Denied") || err_str.contains("denied"),
        "workbook-scope read below Read must surface Denied, got: {}",
        err_str
    );
    assert_eq!(
        svc.dispatch
            .engine()
            .effective_access_calls
            .load(Ordering::Relaxed),
        1,
        "gated workbook read must pre-check effective_access"
    );
}

#[test]
fn workbook_read_gated_allowed_when_effective_at_or_above_read() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:reader"))));
    svc.dispatch.engine().workbook_effective = AccessLevel::Read;
    let sheets = svc.list_sheets().unwrap();
    assert_eq!(sheets, vec![0, 1, 2]);
    assert_eq!(
        svc.dispatch
            .engine()
            .effective_access_calls
            .load(Ordering::Relaxed),
        1
    );
}

#[test]
fn sheet_scope_scalar_read_is_passthrough() {
    let svc = new_service();
    svc.security_active.store(true, Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let v = svc.sheet_row_count(SheetId(0)).unwrap();
    assert_eq!(v, 99, "scope=sheet + scalar must not be post-filtered");
}
