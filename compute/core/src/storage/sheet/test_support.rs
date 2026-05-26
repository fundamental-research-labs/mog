//! Shared test fixtures for the focused sheet sub-modules.
//!
//! Gated on `#[cfg(test)]` via the `sheet/mod.rs` declaration.

use cell_types::SheetId;

use crate::mirror::CellMirror;
use crate::storage::YrsStorage;

/// Build a `SheetId` from a small numeric seed (tests only).
pub(crate) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet named "Sheet1" ready for testing.
pub(crate) fn setup() -> (YrsStorage, CellMirror, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    (storage, mirror, sid)
}
