//! R2.4 smoke tests — principal state on `ComputeService`.
//!
//! Pins down:
//! - `ComputeService::new` reads the engine's `security_active` handle
//!   without panicking (the construction-order contract).
//! - `make_principal` canonicalizes a tag list through the pool; the
//!   wire-format returned is the canonical (sorted, deduped) `Vec<String>`.
//!   The service-side pool pre-warm means the next `set_active_principal`
//!   with the same tag set re-uses the existing slab.
//! - `set_active_principal` + `active_principal` round-trip via the
//!   ArcSwap slot using `Vec<String>` wire-form. `Principal` itself is
//!   not serialisable — see `compute_security::principal` for rationale.
//! - `security_active` starts `false` on a fresh empty document.

use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET1_UUID: &str = "33333333-3333-3333-3333-333333333333";

fn fresh_service() -> ComputeService {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let dispatch = Dispatch::from_engine(engine).expect("dispatch");
    ComputeService::new(dispatch)
}

#[test]
fn empty_doc_security_inactive() {
    let service = fresh_service();
    assert!(!service.security_active());
}

#[test]
fn active_principal_starts_none() {
    let service = fresh_service();
    assert!(service.active_principal().is_none());
}

#[test]
fn make_principal_canonicalizes_tag_order() {
    let service = fresh_service();
    // Different input orders must produce the same canonical tag list
    // and (because make_principal interns the pool) the same identity
    // on subsequent set/get.
    let c1 = service.make_principal(vec!["a".into(), "b".into()]);
    let c2 = service.make_principal(vec!["b".into(), "a".into()]);
    assert_eq!(
        c1, c2,
        "pool must canonicalize tag order into the same wire representation"
    );
}

#[test]
fn make_principal_dedups_repeated_tags() {
    let service = fresh_service();
    let c = service.make_principal(vec!["a".into(), "b".into(), "a".into()]);
    assert_eq!(c, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn set_and_read_active_principal() {
    let service = fresh_service();
    let canonical = service.make_principal(vec!["agent:copilot".into()]);
    service.set_active_principal(Some(canonical.clone()));
    let read = service.active_principal().expect("principal set");
    assert_eq!(read, canonical);
}

#[test]
fn reset_active_principal_to_none() {
    let service = fresh_service();
    service.set_active_principal(Some(vec!["agent:copilot".into()]));
    assert!(service.active_principal().is_some());
    service.set_active_principal(None);
    assert!(service.active_principal().is_none());
}

/// Bug-3 pin: `set_active_principal` takes `&self`, not `&mut self`. This
/// is enforced at the type level — if the test compiles, the property
/// holds. Concurrent resets on an `Arc<ComputeService>` must not require
/// a mut-borrow or any coordination with in-flight calls; the ArcSwap
/// is lock-free.
#[test]
fn set_active_principal_takes_shared_self() {
    let service = std::sync::Arc::new(fresh_service());
    let s2 = std::sync::Arc::clone(&service);
    // Both handles are shared references — if `set_active_principal`
    // required `&mut self`, this would fail to borrow.
    service.set_active_principal(Some(vec!["a".into()]));
    s2.set_active_principal(Some(vec!["b".into()]));
    assert_eq!(service.active_principal(), Some(vec!["b".to_string()]));
}
