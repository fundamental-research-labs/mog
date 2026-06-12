use super::*;
use crate::storage::YrsStorage;
use crate::storage::infra::grid_helpers::get_cells_map;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::hyperlink::HyperlinkTargetKind;
use std::sync::Arc;
use yrs::{Any, Map, MapPrelim, Origin, Transact};

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));
    (storage, sheet_id, grid)
}

fn seed_text_cell(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    text: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_id = grid.ensure_cell_id(row, col);
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::String(Arc::from(text.to_string())))]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }
}

#[test]
fn set_hyperlink_internal_target_stores_domain_metadata() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_text_cell(&storage, &mut grid, sheet_id, 0, 0, "Jump to target");

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "Target!B2",
    );

    assert_eq!(
        get_hyperlink(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid, 0, 0),
        Some("Target!B2".to_string())
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target, None);
    assert_eq!(links[0].location.as_deref(), Some("Target!B2"));
    assert_eq!(links[0].display.as_deref(), Some("Jump to target"));
    assert_eq!(
        links[0].target_kind,
        Some(HyperlinkTargetKind::InlineLocation)
    );
    assert_eq!(links[0].target_mode, None);
}

#[test]
fn set_hyperlink_external_target_stores_domain_metadata() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_text_cell(&storage, &mut grid, sheet_id, 0, 0, "Open docs");

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://example.com/docs",
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target.as_deref(), Some("https://example.com/docs"));
    assert_eq!(links[0].location, None);
    assert_eq!(links[0].display.as_deref(), Some("Open docs"));
    assert_eq!(
        links[0].target_kind,
        Some(HyperlinkTargetKind::Relationship)
    );
    assert_eq!(links[0].target_mode.as_deref(), Some("External"));
}

#[test]
fn set_hyperlink_replaces_stale_target_representation() {
    let (storage, sheet_id, mut grid) = storage_with_sheet();
    seed_text_cell(&storage, &mut grid, sheet_id, 0, 0, "Open docs");

    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "Target!B2",
    );
    set_hyperlink(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        &mut grid,
        0,
        0,
        "https://example.com/docs",
    );

    let links = get_all_hyperlinks(storage.doc(), &storage.sheets_ref(), &sheet_id, &grid);
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].target.as_deref(), Some("https://example.com/docs"));
    assert_eq!(links[0].location, None);
    assert_eq!(
        links[0].target_kind,
        Some(HyperlinkTargetKind::Relationship)
    );
    assert_eq!(links[0].target_mode.as_deref(), Some("External"));
}
