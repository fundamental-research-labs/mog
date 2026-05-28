use compute_document::cell_serde::yrs_any_to_cell_value;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use yrs::{Any, Map, MapRef, Out};

use value_types::CellValue;

/// Read a cell's value from the cells map. Returns None if null/missing.
pub(super) fn read_cell_value<T: yrs::ReadTxn>(
    txn: &T,
    cells_map: &MapRef,
    cell_hex: &str,
) -> Option<CellValue> {
    let cell_map = match cells_map.get(txn, cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    let val = yrs_any_to_cell_value(&cell_map, txn);
    match val {
        CellValue::Null => None,
        other => Some(other),
    }
}

/// Read a cell's formula from the cells map.
pub(super) fn read_cell_formula<T: yrs::ReadTxn>(
    txn: &T,
    cells_map: &MapRef,
    cell_hex: &str,
) -> Option<String> {
    let cell_map = match cells_map.get(txn, cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match cell_map.get(txn, "f") {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

/// Check if a cell at a position has a non-null value. Returns true if
/// there is data (number, text, boolean, error, or formula).
pub(super) fn has_data_at<T: yrs::ReadTxn>(
    txn: &T,
    grid: &GridIndex,
    cells_map: &MapRef,
    row: u32,
    col: u32,
) -> bool {
    let Some(cell_id) = grid.cell_id_at(row, col) else {
        return false;
    };
    let cell_hex = id_to_hex(cell_id.as_u128());
    if read_cell_value(txn, cells_map, &cell_hex).is_some() {
        return true;
    }
    read_cell_formula(txn, cells_map, &cell_hex).is_some()
}
