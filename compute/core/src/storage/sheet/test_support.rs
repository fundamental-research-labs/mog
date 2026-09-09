//! Shared test fixtures for the focused sheet sub-modules.
//!
//! Gated on `#[cfg(test)]` via the `sheet/mod.rs` declaration.

use cell_types::SheetId;

use crate::cells::CellStore;
use crate::storage::WorkbookStorage;

/// Build a `SheetId` from a small numeric seed (tests only).
pub(crate) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet named "Sheet1" ready for testing.
pub(crate) fn setup() -> (WorkbookStorage, CellStore, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = CellStore::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sid, "Sheet1", 100, 26)
        .unwrap();
    (storage, cell_store, sid)
}
