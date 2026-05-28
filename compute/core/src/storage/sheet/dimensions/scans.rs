use yrs::{Any, Doc, Map, MapRef, Out, Transact};

use super::yrs_access::get_sheet_submap;
use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::schema::{KEY_COL_WIDTHS, KEY_ROW_HEIGHTS};
use domain_types::units::{CharWidth, Points};

/// Scan all custom row heights for a sheet from Yrs storage.
pub fn get_all_custom_row_heights(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(usize, Points)> {
    let gi = match grid_index {
        Some(g) => g,
        None => return vec![],
    };

    let txn = doc.transact();
    let row_heights_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (row_id_key, height_val) in row_heights_map.iter(&txn) {
        let height = match height_val {
            Out::Any(Any::Number(h)) => h,
            _ => continue,
        };

        let position = match compute_document::hex::hex_to_id(row_id_key) {
            Some(raw) => {
                let rid = cell_types::RowId::from_raw(raw);
                match gi.row_index(&rid) {
                    Some(idx) => idx as usize,
                    None => continue,
                }
            }
            None => continue,
        };

        result.push((position, Points(height)));
    }

    result
}

/// Scan all custom column widths for a sheet from Yrs storage.
pub fn get_all_custom_col_widths(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(usize, CharWidth)> {
    let gi = match grid_index {
        Some(g) => g,
        None => return vec![],
    };

    let txn = doc.transact();
    let col_widths_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (col_id_key, width_val) in col_widths_map.iter(&txn) {
        let width = match width_val {
            Out::Any(Any::Number(w)) => w,
            _ => continue,
        };

        let position = match compute_document::hex::hex_to_id(col_id_key) {
            Some(raw) => {
                let cid = cell_types::ColId::from_raw(raw);
                match gi.col_index(&cid) {
                    Some(idx) => idx as usize,
                    None => continue,
                }
            }
            None => continue,
        };

        result.push((position, CharWidth(width)));
    }

    result
}

/// Return the highest column index that has identities in the GridIndex.
pub fn get_max_materialized_col(
    _doc: &Doc,
    _sheets: &MapRef,
    _sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Option<u32> {
    let gi = grid_index?;
    let count = gi.col_count();
    if count == 0 { None } else { Some(count - 1) }
}
