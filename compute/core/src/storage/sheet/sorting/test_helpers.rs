use std::sync::Arc;

use cell_types::{CellId, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::CellValue;
use yrs::{Any, Map, MapPrelim, Origin, Transact};

use crate::storage::infra::grid_helpers::get_cells_map;
use crate::storage::{KEY_VALUE, YrsStorage};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Create a storage with one sheet plus a fresh `GridIndex` that serves
/// as the authoritative identity store for that sheet in the test.
///
/// The GridIndex is built via `GridIndex::new` with a fresh
/// `IdAllocator`; it does not share identities with the yrs rowOrder /
/// colOrder arrays installed by `add_sheet`. Sort-path tests don't need
/// that correspondence because, post-migration, sort consults only the
/// GridIndex for identity/positions and only yrs for cell values.
pub(super) fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(cell_types::IdAllocator::new()));

    (storage, sheet_id, grid)
}

/// Place a cell with a given CellId, value, and position.
/// Writes the value into the yrs `cells` map (keyed by cell_hex) and
/// registers the CellId in the GridIndex at (row, col).
pub(super) fn place_cell(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    value: &CellValue,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Write cell into cells map (keyed by cell_hex — identity-only)
    if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        let v = match value {
            CellValue::Number(n) => Any::Number(n.get()),
            CellValue::Text(s) => Any::String(Arc::clone(s)),
            CellValue::Boolean(b) => Any::Bool(*b),
            CellValue::Null => Any::Null,
            CellValue::Error(e, _) => Any::String(Arc::from(e.as_str())),
            _ => Any::Null,
        };
        let cell_prelim = MapPrelim::from([(KEY_VALUE, v)]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }

    drop(txn);

    // Register in GridIndex (sole identity authority).
    grid.register_cell(cell_id, row, col);
}

/// Read a cell's position via the GridIndex.
pub(super) fn read_cell_position(grid: &GridIndex, cell_id: CellId) -> Option<(u32, u32)> {
    grid.cell_position(&cell_id)
}
