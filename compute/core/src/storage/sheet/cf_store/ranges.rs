use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use crate::storage::infra::grid_helpers::sheet_id_to_hex;

use super::yrs_io::{get_cf_map, read_cf_from_yrs_map, write_cf_to_yrs};
use crate::engine_types::cf::CFCellRange;

pub(super) fn cell_in_range(range: &CFCellRange, row: u32, col: u32) -> bool {
    range.contains(row, col)
}

// =============================================================================
// Range Operations
// =============================================================================

/// Replace a format's ranges atomically. Empty ranges deletes the format.
pub fn update_cf_ranges(
    doc: &Doc,
    sheets: &MapRef,
    format_id: &str,
    sheet_id: &SheetId,
    new_ranges: &[CFCellRange],
) -> bool {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let cf_map = match get_cf_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return false,
    };
    let existing_map = match cf_map.get(&txn, format_id) {
        Some(Out::YMap(m)) => m,
        _ => return false,
    };
    let mut cf = match read_cf_from_yrs_map(&existing_map, &txn) {
        Some(c) => c,
        None => return false,
    };
    if new_ranges.is_empty() {
        cf_map.remove(&mut txn, format_id);
    } else {
        cf.ranges = new_ranges.to_vec();
        cf_map.remove(&mut txn, format_id);
        write_cf_to_yrs(&mut txn, &cf_map, &cf);
    }
    true
}

// =============================================================================
// Range Geometry (standalone functions)
// =============================================================================

/// Check if two ranges overlap (share any cells).
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_ranges_overlap(a: &CFCellRange, b: &CFCellRange) -> bool {
    a.intersects(b)
}

/// Check if outer completely contains inner.
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_range_contains(outer: &CFCellRange, inner: &CFCellRange) -> bool {
    outer.contains_range(inner)
}

/// Subtract one range from another, returning up to 4 non-overlapping strips.
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_subtract_range(
    original: &CFCellRange,
    subtract: &CFCellRange,
) -> Vec<CFCellRange> {
    if !original.intersects(subtract) {
        return vec![*original];
    }
    if subtract.contains_range(original) {
        return vec![];
    }
    let mut results = Vec::new();
    if subtract.start_row() > original.start_row() {
        results.push(CFCellRange::new(
            original.start_row(),
            original.start_col(),
            subtract.start_row() - 1,
            original.end_col(),
        ));
    }
    if subtract.end_row() < original.end_row() {
        results.push(CFCellRange::new(
            subtract.end_row() + 1,
            original.start_col(),
            original.end_row(),
            original.end_col(),
        ));
    }
    let middle_start_row = original.start_row().max(subtract.start_row());
    let middle_end_row = original.end_row().min(subtract.end_row());
    if subtract.start_col() > original.start_col() {
        results.push(CFCellRange::new(
            middle_start_row,
            original.start_col(),
            middle_end_row,
            subtract.start_col() - 1,
        ));
    }
    if subtract.end_col() < original.end_col() {
        results.push(CFCellRange::new(
            middle_start_row,
            subtract.end_col() + 1,
            middle_end_row,
            original.end_col(),
        ));
    }
    results
}

/// Calculate the intersection of two ranges.
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_intersect_ranges(a: &CFCellRange, b: &CFCellRange) -> Option<CFCellRange> {
    a.intersection(b)
}

/// Check if a range is valid (end >= start).
// Internal CF range math — used by bridge-worthy CF operations
pub(crate) fn cf_is_valid_range(range: &CFCellRange) -> bool {
    range.start_row() <= range.end_row() && range.start_col() <= range.end_col()
}
