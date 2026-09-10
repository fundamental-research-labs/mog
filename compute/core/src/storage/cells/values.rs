//! Native cell value queries, parsing, and sparse identity helpers.

use crate::cells::CellStore;
use cell_types::SheetId;
use value_types::CellValue;

mod parsing;

pub(crate) use parsing::{
    InputParseContext, ParsedValue, parse_input_value_with_context, parse_time_string,
};
#[cfg(test)]
use parsing::{is_plain_number, parse_date_string, parse_formatted_number};

/// Get the effective value of a cell.
///
/// For formula cells, returns the computed value (from the cell store/compute engine).
/// For value cells, returns the raw value.
/// Returns `None` for empty cells.
pub fn get_effective_value(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    cell_store
        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
        .cloned()
}

/// Count authored and compact imported values without materializing cell identities.
pub fn get_cell_count(cell_store: &CellStore, sheet_id: &SheetId) -> usize {
    let Some(sheet) = cell_store.get_sheet(sheet_id) else {
        return 0;
    };
    let authored = sheet
        .cells_iter()
        .filter(|(id, _)| !sheet.is_ghost(id))
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
                                .value_at(&row, col)
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
