use super::*;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Create a WorkbookStorage with a single sheet.
///
/// `add_sheet()` creates native sheet metadata and compact axes.
pub(super) fn storage_with_sheet() -> (WorkbookStorage, crate::mirror::CellMirror, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .unwrap();
    (storage, mirror, sheet_id)
}
