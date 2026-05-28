use super::super::*;
use crate::storage::YrsStorage;
use cell_types::{CellId, IdAllocator, SheetId};
use value_types::CellValue;
use yrs::Transact;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Create a storage with one sheet and a fresh `GridIndex` (the sole
/// identity authority for tests). The GridIndex is not correlated with
/// the yrs rowOrder/colOrder arrays installed by `add_sheet` — post
/// migration, these functions only consult the GridIndex for identity
/// and only the yrs `cells` map for cell values.
pub(super) fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");

    let grid = GridIndex::new(sheet_id, 100, 26, Arc::new(IdAllocator::new()));

    (storage, sheet_id, grid)
}

/// Seed a cell at (row, col) with a CellValue, registering its identity
/// in the GridIndex and persisting its value in the yrs `cells` map.
/// Returns the CellId.
pub(super) fn seed_cell(
    storage: &YrsStorage,
    grid: &mut GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    value: CellValue,
) -> CellId {
    let cell_id = grid.ensure_cell_id(row, col);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    {
        let mut txn = storage.doc().transact_mut();
        if let Some(cells_map) = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
            let v = match &value {
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
    }
    cell_id
}

/// Read the raw string value of a cell at a position via the GridIndex.
pub(super) fn read_value_at(
    storage: &YrsStorage,
    grid: &GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
) -> String {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = match get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex) {
        Some(m) => m,
        None => return String::new(),
    };
    match grid.cell_id_at(row, col) {
        Some(cell_id) => {
            let cell_hex = id_to_hex(cell_id.as_u128());
            read_cell_value_as_string(&txn, &cells_map, &cell_hex)
        }
        None => String::new(),
    }
}

pub(super) fn assert_cell_value_is_number(
    storage: &YrsStorage,
    grid: &GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    expected: Option<f64>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_id = grid
        .cell_id_at(row, col)
        .unwrap_or_else(|| panic!("cell at ({row},{col}) should be registered"));
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell at ({row},{col}) not found"),
    };
    match cell_map.get(&txn, KEY_VALUE) {
        Some(Out::Any(Any::Number(n))) => {
            if let Some(expected) = expected {
                assert!((n - expected).abs() < 1e-9);
            }
        }
        other => panic!("expected Number at ({row},{col}), got {:?}", other),
    }
}

pub(super) fn assert_cell_value_is_string(
    storage: &YrsStorage,
    grid: &GridIndex,
    sheet_id: SheetId,
    row: u32,
    col: u32,
    expected: &str,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = storage.doc().transact();
    let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell_id = grid
        .cell_id_at(row, col)
        .unwrap_or_else(|| panic!("cell at ({row},{col}) should be registered"));
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cell at ({row},{col}) not found"),
    };
    match cell_map.get(&txn, KEY_VALUE) {
        Some(Out::Any(Any::String(ref s))) => assert_eq!(s.as_ref(), expected),
        other => panic!(
            "expected String({expected:?}) at ({row},{col}), got {:?}",
            other
        ),
    }
}
