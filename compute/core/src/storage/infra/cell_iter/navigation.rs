use std::collections::HashSet;

use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use yrs::{Doc, MapRef, Transact};

use super::super::grid_helpers::get_cells_map;
use super::read::has_data_at;
use cell_types::SheetId;

/// Find the data edge from a cell in a given direction (Ctrl+Arrow navigation).
///
/// Implements Excel's Ctrl+Arrow behaviour:
/// 1. Current empty, next empty  → jump to first non-empty (or sheet edge)
/// 2. Current empty, next data   → jump to that adjacent cell
/// 3. Current data, next empty   → jump over empties to next data (or sheet edge)
/// 4. Current data, next data    → walk to last cell before empty (contiguous edge)
///
/// Hidden rows/columns act as boundaries; merged cells are treated as single
/// blocks and navigation always lands on the merge origin (top-left).
pub fn find_data_edge(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    direction: &str,
) -> snapshot_types::queries::CellPosition {
    use crate::storage::sheet::{dimensions, merges};

    const MAX_ROW: u32 = 1_048_575;
    const MAX_COL: u32 = 16_383;

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let fallback = snapshot_types::queries::CellPosition {
        row: start_row,
        col: start_col,
    };

    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return fallback;
    };

    // Pre-fetch hidden sets for efficiency
    let hidden_rows: HashSet<u32> = dimensions::get_hidden_rows(doc, sheets, &sheet_id)
        .into_iter()
        .collect();
    let hidden_cols: HashSet<u32> = dimensions::get_hidden_columns(doc, sheets, &sheet_id)
        .into_iter()
        .collect();

    // Direction deltas
    let (dr, dc): (i64, i64) = match direction {
        "up" => (-1, 0),
        "down" => (1, 0),
        "left" => (0, -1),
        "right" => (0, 1),
        _ => {
            return snapshot_types::queries::CellPosition {
                row: start_row,
                col: start_col,
            };
        }
    };

    // --- helpers ---

    let in_bounds =
        |r: i64, c: i64| -> bool { r >= 0 && r <= MAX_ROW as i64 && c >= 0 && c <= MAX_COL as i64 };

    let is_hidden =
        |r: u32, c: u32| -> bool { hidden_rows.contains(&r) || hidden_cols.contains(&c) };

    let check_data = |r: u32, c: u32| -> bool { has_data_at(&txn, grid, &cells_map, r, c) };

    // Check data at a cell, accounting for merges (check merge origin).
    let cell_has_data = |r: u32, c: u32| -> bool {
        if let Some(info) = merges::get_merge_for_cell(doc, sheets, sheet_id, grid, r, c) {
            let m = &info.merge;
            return check_data(m.start_row, m.start_col);
        }
        check_data(r, c)
    };

    // Advance past a merged cell in the walking direction.
    let advance_past_merge = |r: u32, c: u32| -> (i64, i64) {
        if let Some(info) = merges::get_merge_for_cell(doc, sheets, sheet_id, grid, r, c) {
            let m = &info.merge;
            if dr > 0 {
                return (m.end_row as i64 + 1, c as i64);
            }
            if dr < 0 {
                return (m.start_row as i64 - 1, c as i64);
            }
            if dc > 0 {
                return (r as i64, m.end_col as i64 + 1);
            }
            if dc < 0 {
                return (r as i64, m.start_col as i64 - 1);
            }
        }
        (r as i64 + dr, c as i64 + dc)
    };

    // Return merge origin for a cell, or the cell itself.
    let to_merge_origin = |r: u32, c: u32| -> snapshot_types::queries::CellPosition {
        if let Some(info) = merges::get_merge_for_cell(doc, sheets, sheet_id, grid, r, c) {
            let m = &info.merge;
            return snapshot_types::queries::CellPosition {
                row: m.start_row,
                col: m.start_col,
            };
        }
        snapshot_types::queries::CellPosition { row: r, col: c }
    };

    let clamp = |r: i64, c: i64| -> snapshot_types::queries::CellPosition {
        snapshot_types::queries::CellPosition {
            row: r.max(0).min(MAX_ROW as i64) as u32,
            col: c.max(0).min(MAX_COL as i64) as u32,
        }
    };

    let start_pos = snapshot_types::queries::CellPosition {
        row: start_row,
        col: start_col,
    };

    // --- algorithm ---

    let current_has_data = cell_has_data(start_row, start_col);

    // Get next position (skip past current merge if applicable)
    let (mut ri, mut ci) = advance_past_merge(start_row, start_col);

    // Already at edge
    if !in_bounds(ri, ci) {
        return start_pos;
    }

    let r = ri as u32;
    let c = ci as u32;

    // Stop at hidden boundary
    if is_hidden(r, c) {
        return start_pos;
    }

    let next_has_data = cell_has_data(r, c);

    if !current_has_data {
        // Case 2: next has data → stop at adjacent cell
        if next_has_data {
            return to_merge_origin(r, c);
        }

        // Case 1: both empty → find first non-empty
        while in_bounds(ri, ci) {
            let rr = ri as u32;
            let cc = ci as u32;
            if is_hidden(rr, cc) {
                return to_merge_origin((ri - dr) as u32, (ci - dc) as u32);
            }
            if cell_has_data(rr, cc) {
                return to_merge_origin(rr, cc);
            }
            ri += dr;
            ci += dc;
        }
        // Hit sheet edge without finding data
        return clamp(ri - dr, ci - dc);
    }

    // Current has data
    if !next_has_data {
        // Case 3: next empty → jump over empties to next data
        while in_bounds(ri, ci) {
            let rr = ri as u32;
            let cc = ci as u32;
            if is_hidden(rr, cc) {
                return to_merge_origin((ri - dr) as u32, (ci - dc) as u32);
            }
            if cell_has_data(rr, cc) {
                return to_merge_origin(rr, cc);
            }
            ri += dr;
            ci += dc;
        }
        return clamp(ri - dr, ci - dc);
    }

    // Case 4: both have data → walk to edge of contiguous region
    let mut prev_r = start_row;
    let mut prev_c = start_col;
    while in_bounds(ri, ci) {
        let rr = ri as u32;
        let cc = ci as u32;
        if is_hidden(rr, cc) {
            return to_merge_origin(prev_r, prev_c);
        }
        if !cell_has_data(rr, cc) {
            return to_merge_origin(prev_r, prev_c);
        }
        prev_r = rr;
        prev_c = cc;
        let next = advance_past_merge(rr, cc);
        ri = next.0;
        ci = next.1;
    }
    to_merge_origin(prev_r, prev_c)
}
