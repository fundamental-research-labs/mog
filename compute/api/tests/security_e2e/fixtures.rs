use std::sync::Arc;

use cell_types::SheetId;
use compute_api::ComputeService;
use compute_api::dispatch::Dispatch;
use compute_core::storage::engine::YrsComputeEngine;
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, PolicyId, PolicyMetadata, TagMatcher,
};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};
use value_types::ComputeError;

pub(super) const SHEET1_UUID: &str = "44444444-4444-4444-4444-444444444444";

// ---------------------------------------------------------------------------
// Fixtures — construction helpers shared across the whole file.
//
// The engine, dispatch, and service are plumbed without going through
// `Workbook::from_snapshot` so the tests can take both owner-tagged and
// agent-tagged views of the same document by swapping `set_active_principal`.
// ---------------------------------------------------------------------------

pub(super) fn snapshot_with_sheet(sheet_id: &str) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

pub(super) fn fresh_service() -> (ComputeService, SheetId) {
    let snapshot = snapshot_with_sheet(SHEET1_UUID);
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let dispatch = Dispatch::from_engine(engine).expect("dispatch");
    let service = ComputeService::new(dispatch);
    let sheet_id = SheetId::from_uuid_str(SHEET1_UUID).expect("parse sheet id");
    (service, sheet_id)
}

pub(super) fn fresh_service_uuid(uuid: &str) -> (ComputeService, SheetId) {
    let snapshot = snapshot_with_sheet(uuid);
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let dispatch = Dispatch::from_engine(engine).expect("dispatch");
    let service = ComputeService::new(dispatch);
    let sheet_id = SheetId::from_uuid_str(uuid).expect("parse sheet id");
    (service, sheet_id)
}

pub(super) fn workbook_policy(tag: &str, level: AccessLevel) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Workbook,
        level,
        priority: 10,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("security-e2e"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

pub(super) fn sheet_policy(tag: &str, sheet_id: SheetId, level: AccessLevel) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Sheet { sheet_id },
        level,
        priority: 20,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("security-e2e"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

/// Shorthand: populate a cell as owner, then swap to a restricted principal.
///
/// Takes the restricted principal as a tag list — `make_principal` returns
/// the canonical wire form (`Vec<String>`) and `set_active_principal`
/// takes the same. `Principal` itself is Rust-side only (not serde); tests
/// that need the actual `Principal` struct for cross-boundary engine calls
/// like `wb_security_effective_access` reach for `intern_principal`
/// instead.
pub(super) fn seed_as_owner_then_swap(
    service: &mut ComputeService,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
    restricted: Vec<String>,
) {
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(sheet_id, row, col, value)
        .expect("owner write");
    service.set_active_principal(Some(restricted));
}

/// Promote a raw `ComputeError::SecurityDenied` to the typed variant and
/// match against that. The delegate surface returns `ComputeError` (not
/// `ComputeApiError`) for gated writes; the SDK layer promotes it before
/// surfacing to bindings.
pub(super) fn is_engine_security_denied(err: &ComputeError) -> bool {
    matches!(err, ComputeError::SecurityDenied { .. })
}
