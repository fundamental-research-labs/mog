//! Native cell value queries, parsing, and sparse identity helpers.

use crate::mirror::CellMirror;
use cell_types::{CellId, SheetId};
use value_types::CellValue;

mod parsing;

pub(crate) use parsing::{
    InputParseContext, ParsedValue, parse_input_value_with_context, parse_time_string,
};
#[cfg(test)]
use parsing::{is_plain_number, parse_date_string, parse_formatted_number};

/// If `(row, col)` falls inside a Range, derive the virtual CellId and
/// pre-register it in the GridIndex so that `ensure_cell_id` returns it
/// instead of minting a fresh random CellId.
pub(crate) fn maybe_register_virtual_cell_id(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    grid_index: &mut crate::identity::GridIndex,
    row: u32,
    col: u32,
) {
    if grid_index.cell_id_at(row, col).is_some() {
        return;
    }
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return;
    };
    if sheet.range_views_is_empty() {
        return;
    }
    let Some(row_id) = sheet.row_id_at(row) else {
        return;
    };
    let Some(col_id) = sheet.col_id_at(col) else {
        return;
    };
    // Check if any RangeView covers this (row_id, col_id)
    for rv in sheet.iter_ranges().map(|(_, rv)| rv) {
        if rv.row_offset_by_id.contains_key(&row_id) && rv.col_offset_by_id.contains_key(&col_id) {
            let virtual_id = CellId::virtual_at(*sheet_id, row_id, col_id);
            grid_index.register_cell(virtual_id, row, col);
            return;
        }
    }
}

/// Get the effective value of a cell.
///
/// For formula cells, returns the computed value (from the mirror/compute engine).
/// For value cells, returns the raw value.
/// Returns `None` for empty cells.
pub fn get_effective_value(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    mirror
        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
        .cloned()
}

/// Count authored and compact imported values without materializing cell identities.
pub fn get_cell_count(mirror: &CellMirror, sheet_id: &SheetId) -> usize {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return 0;
    };
    let authored = sheet
        .cells_iter()
        .filter(|(_, entry)| !entry.is_ghost())
        .count();
    let imported: usize = sheet
        .iter_ranges()
        .map(|(_, range)| {
            range
                .row_offset_by_id
                .keys()
                .map(|row| {
                    range
                        .col_offset_by_id
                        .keys()
                        .filter(|col| {
                            range
                                .value_at(row, col)
                                .is_some_and(|value| !value.is_null())
                        })
                        .count()
                })
                .sum::<usize>()
        })
        .sum();
    authored + imported
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests;

// ---------------------------------------------------------------------------
// Cell read/write methods on WorkbookStorage
// ---------------------------------------------------------------------------
