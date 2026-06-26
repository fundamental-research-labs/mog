use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use yrs::{Doc, MapRef, Transact};

use super::super::grid_helpers::get_cells_map;
use super::read::has_data_at;
use super::types::RangeSpan;
use cell_types::{RangePos, SheetId};

/// Get the current region around a cell (Ctrl+Shift+* functionality).
///
/// The current region is the contiguous block of cells containing data
/// that surrounds the specified cell, bounded by empty rows/columns.
/// This matches Excel's "Select Current Region" behavior.
///
/// If the starting cell is empty and has no adjacent data, returns a
/// single-cell range.
pub fn get_current_region(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
) -> RangePos {
    get_current_region_with_extra_data(doc, sheets, sheet_id, grid, start_row, start_col, |_, _| {
        false
    })
}

/// Like [`get_current_region`], but lets higher layers contribute cell
/// occupancy from mirror-backed sources such as range payloads, projection
/// values, and imported dense data.
pub fn get_current_region_with_extra_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    extra_has_data: impl Fn(u32, u32) -> bool,
) -> RangePos {
    let max_row: u32 = 10_000;
    let max_col: u32 = 500;

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let single_cell = RangePos::new(sheet_id, start_row, start_col, start_row, start_col);

    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);
    let has_data = |row: u32, col: u32| -> bool {
        cells_map
            .as_ref()
            .is_some_and(|cells_map| has_data_at(&txn, grid, cells_map, row, col))
            || extra_has_data(row, col)
    };

    // Check if start cell has data
    let start_has_data = has_data(start_row, start_col);

    let mut top = start_row;
    let mut bottom = start_row;
    let mut left = start_col;
    let mut right = start_col;

    // If starting cell is empty, check cardinal directions for adjacent data
    if !start_has_data {
        let has_above = start_row > 0 && has_data(start_row - 1, start_col);
        let has_below = start_row < max_row && has_data(start_row + 1, start_col);
        let has_left = start_col > 0 && has_data(start_row, start_col - 1);
        let has_right = start_col < max_col && has_data(start_row, start_col + 1);

        if !has_above && !has_below && !has_left && !has_right {
            return single_cell;
        }
    }

    let row_has_data_in_cols =
        |row: u32, left: u32, right: u32| -> bool { (left..=right).any(|col| has_data(row, col)) };
    let col_has_data_in_rows =
        |col: u32, top: u32, bottom: u32| -> bool { (top..=bottom).any(|row| has_data(row, col)) };

    // Expand outward until no more data is found in any direction. Consume each
    // contiguous run before checking the orthogonal boundary; otherwise a tall
    // dense region repeatedly rescans the same blank side column once per row.
    loop {
        let previous = (top, bottom, left, right);

        while top > 0 && row_has_data_in_cols(top - 1, left, right) {
            top -= 1;
        }
        while bottom < max_row && row_has_data_in_cols(bottom + 1, left, right) {
            bottom += 1;
        }
        while left > 0 && col_has_data_in_rows(left - 1, top, bottom) {
            left -= 1;
        }
        while right < max_col && col_has_data_in_rows(right + 1, top, bottom) {
            right += 1;
        }

        if (top, bottom, left, right) == previous {
            break;
        }
    }

    RangePos::new(sheet_id, top, left, bottom, right)
}

/// Constrain a full column/row selection to actual data bounds.
///
/// When a user selects an entire column (clicking the header) and performs
/// an operation like sort, Excel detects the actual data range and operates
/// only on that, not all 1M+ rows. For normal selections, returns the
/// range unchanged.
///
/// Returns `None` if no data is found in the selected columns/rows.
pub(crate) fn get_data_bounds_for_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    range: &RangePos,
    span: RangeSpan,
) -> Option<RangePos> {
    get_data_bounds_for_range_with_extra_data(doc, sheets, sheet_id, grid, range, span, |_, _| {
        false
    })
}

/// Like [`get_data_bounds_for_range`], but uses higher-layer mirror-backed
/// occupancy in addition to Yrs cell-map data.
pub(crate) fn get_data_bounds_for_range_with_extra_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    range: &RangePos,
    span: RangeSpan,
    extra_has_data: impl Fn(u32, u32) -> bool + Copy,
) -> Option<RangePos> {
    // If not a full column/row selection, return as-is
    if span == RangeSpan::Exact {
        return Some(*range);
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);

    let has_data = |row: u32, col: u32| -> bool {
        cells_map
            .as_ref()
            .is_some_and(|cells_map| has_data_at(&txn, grid, cells_map, row, col))
            || extra_has_data(row, col)
    };

    if span == RangeSpan::FullColumns {
        let search_limit: u32 = 10_000;

        // Find first row with data in any of the selected columns
        let mut first_data_row: Option<u32> = None;
        'outer: for row in 0..search_limit {
            for col in range.start_col()..=range.end_col() {
                if has_data(row, col) {
                    first_data_row = Some(row);
                    break 'outer;
                }
            }
        }

        let first_data_row = first_data_row?;

        // Use get_current_region to find the contiguous data block
        let data_region = get_current_region_with_extra_data(
            doc,
            sheets,
            sheet_id,
            grid,
            first_data_row,
            range.start_col(),
            extra_has_data,
        );

        Some(RangePos::new(
            sheet_id,
            data_region.start_row(),
            range.start_col(),
            data_region.end_row(),
            range.end_col(),
        ))
    } else {
        // is_full_row
        let search_limit: u32 = 1_000;

        // Find first column with data in any of the selected rows
        let mut first_data_col: Option<u32> = None;
        'outer: for col in 0..search_limit {
            for row in range.start_row()..=range.end_row() {
                if has_data(row, col) {
                    first_data_col = Some(col);
                    break 'outer;
                }
            }
        }

        let first_data_col = first_data_col?;

        let data_region = get_current_region_with_extra_data(
            doc,
            sheets,
            sheet_id,
            grid,
            range.start_row(),
            first_data_col,
            extra_has_data,
        );

        Some(RangePos::new(
            sheet_id,
            range.start_row(),
            data_region.start_col(),
            range.end_row(),
            data_region.end_col(),
        ))
    }
}
