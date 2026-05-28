use crate::storage::infra::grid_helpers::get_cells_map;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use yrs::{Any, Doc, Map, MapRef, Out, Transact};

pub(super) fn read_cell_value<T: yrs::ReadTxn>(
    txn: &T,
    cells_map: &MapRef,
    cell_id_hex: &str,
) -> Option<String> {
    let cell_map = match cells_map.get(txn, cell_id_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match cell_map.get(txn, KEY_VALUE) {
        Some(Out::Any(Any::Null)) | Some(Out::Any(Any::Undefined)) | None => None,
        Some(Out::Any(Any::String(s))) if s.is_empty() => None,
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        Some(Out::Any(Any::Number(n))) => Some(n.to_string()),
        Some(Out::Any(Any::Bool(b))) => Some(b.to_string()),
        _ => None,
    }
}

/// Check whether merging a range would clear data from non-origin cells.
///
/// Returns `(has_data_loss, cells_with_data)`.
pub fn check_merge_data_loss(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> (bool, u32) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return (false, 0),
    };

    let mut count: u32 = 0;
    for (cell_id, r, c) in grid.cells_in_range(start_row, start_col, end_row, end_col) {
        if r == start_row && c == start_col {
            continue; // skip origin
        }
        let cell_hex = id_to_hex(cell_id.as_u128());
        if read_cell_value(&txn, &cells_map, &cell_hex).is_some() {
            count += 1;
        }
    }

    (count > 0, count)
}
