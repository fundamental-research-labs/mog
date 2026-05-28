//! Mutable cell operations for the cell mirror.
//!
//! The write subtree keeps the existing `CellMirror` inherent-method API split by
//! mutation domain. Column-store writes must preserve the distinction between data
//! extents and identity-only extents, and cache/version touches happen only after
//! any mutable `SheetMirror` borrow has ended.

mod cells;
mod display_metadata;
mod identity;
mod pivot_materialization;
mod position;
mod projection_materialization;

#[cfg(test)]
mod tests;

use cell_types::SheetPos;
use value_types::CellValue;

use super::types::SheetMirror;

pub(super) fn write_col_value(
    sheet: &mut SheetMirror,
    pos: SheetPos,
    value: CellValue,
) -> CellValue {
    let row = pos.row() as usize;
    let initial_len = std::cmp::max(sheet.rows as usize, row + 1);
    let col_vec = sheet
        .col_data
        .entry(pos.col())
        .or_insert_with(|| vec![CellValue::Null; initial_len]);
    let old_value = if row < col_vec.len() {
        col_vec[row].clone()
    } else {
        CellValue::Null
    };
    if row >= col_vec.len() {
        col_vec.resize(row + 1, CellValue::Null);
    }
    col_vec[row] = value;
    old_value
}

pub(super) fn clear_col_value(sheet: &mut SheetMirror, pos: SheetPos) -> bool {
    if let Some(col_vec) = sheet.col_data.get_mut(&pos.col())
        && (pos.row() as usize) < col_vec.len()
    {
        let was_non_null = !matches!(col_vec[pos.row() as usize], CellValue::Null);
        col_vec[pos.row() as usize] = CellValue::Null;
        return was_non_null;
    }
    false
}
