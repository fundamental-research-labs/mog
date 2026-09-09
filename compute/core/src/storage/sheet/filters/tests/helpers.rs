use crate::storage::WorkbookStorage;
use cell_types::SheetId;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (WorkbookStorage, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

pub(super) fn test_get_cell_format(_row: u32, _col: u32) -> domain_types::CellFormat {
    domain_types::CellFormat::default()
}
