use super::*;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Create a YrsStorage with a single sheet.
///
/// `add_sheet()` creates the yrs sheet sub-maps, cells, rowOrder, colOrder.
pub(super) fn storage_with_sheet() -> (YrsStorage, crate::mirror::CellMirror, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .unwrap();
    (storage, mirror, sheet_id)
}

/// Build a fresh `GridIndex` matching the test sheet dimensions
/// used by `storage_with_sheet()`.
pub(super) fn make_grid_index(sheet_id: SheetId) -> crate::identity::GridIndex {
    crate::identity::GridIndex::new(
        sheet_id,
        100,
        26,
        std::sync::Arc::new(cell_types::IdAllocator::new()),
    )
}
