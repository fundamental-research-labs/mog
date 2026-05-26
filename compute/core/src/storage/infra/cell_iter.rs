//! Cell iteration, range clearing, cell relocation, and identity operations.
//!
//! GridIndex-backed port (GridIndex migration). All `(sheet, row, col) ↔ CellId`
//! resolution goes through `&GridIndex` / `&mut GridIndex`. Legacy
//! position sub-maps in the yrs doc are no longer consulted here.
//!
//! ## Responsibilities
//! - Iterate cells (all cells, cells in range) — via `grid.cells()` /
//!   `grid.cells_in_range(...)`.
//! - Clear cell ranges (with format preservation, returning cleared IDs).
//! - Relocate cells (cut-paste, drag-move with stable CellId preservation).
//! - Current region detection (Ctrl+Shift+* functionality).
//! - Cell identity operations (get/create CellId, get cells in range).
//!
//! ## Architecture
//! - `clear_cells_by_hex` is the position-agnostic value clear: preserves
//!   CellId (formulas referencing cleared cells get 0/empty, not #REF!).
//! - `clear_range_and_return_ids` fully deletes (for structural operations
//!   where #REF! is correct).
//! - `relocate_cells` is for cut-paste: CellIds are preserved, only
//!   positions change in the GridIndex.
//! - `get_current_region` expands outward from a cell until hitting empty
//!   rows/columns (via GridIndex `cell_id_at` probes).
//! - `get_data_bounds_for_range` constrains full-column selections to
//!   actual data.

use std::collections::HashSet;
use std::sync::Arc;

use compute_document::identity::GridIndex;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::grid_helpers::{get_cells_map, get_properties_map};
use crate::storage::cells::values::{remove_cell_position_from_yrs, write_cell_position_to_yrs};
use cell_types::{CellId, RangePos, SheetId};
use compute_document::cell_serde::yrs_any_to_cell_value;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_VALUE;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// How a range's row/column extent should be interpreted.
///
/// Normal ranges use their bounds literally. Full-column (`A:C`) and
/// full-row (`1:3`) ranges scan for actual data to determine the
/// effective bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeSpan {
    /// Use the range bounds as-is.
    Exact,
    /// The range spans full columns — discover the row extent from data.
    FullColumns,
    /// The range spans full rows — discover the column extent from data.
    FullRows,
}

/// Result of a cell relocation operation.
#[derive(Debug, Clone)]
pub struct RelocationResult {
    /// CellIds that were moved to new positions.
    pub moved_cell_ids: Vec<CellId>,
    /// `(row, col)` on the source sheet for each moved CellId, in the same
    /// order as `moved_cell_ids`. Required so the mutation handler can emit
    /// Null patches for the vacated source positions — without this, the
    /// viewport buffer keeps showing stale values until a full refresh.
    pub source_positions_vacated: Vec<(u32, u32)>,
    /// CellIds that were cleared at target (not part of the move).
    pub target_cells_cleared: Vec<CellId>,
    /// Whether the operation succeeded.
    pub success: bool,
    /// Error message if operation failed.
    pub error: Option<String>,
}

/// Cell data for iteration callbacks.
#[derive(Debug, Clone)]
pub struct IterCellData {
    pub cell_id: CellId,
    #[allow(dead_code)] // Populated for callers; engine queries serialize to JSON
    pub row: u32,
    #[allow(dead_code)] // Populated for callers; engine queries serialize to JSON
    pub col: u32,
    pub value: Option<CellValue>,
    pub formula: Option<String>,
}

/// Read a cell's value from the cells map. Returns None if null/missing.
fn read_cell_value<T: yrs::ReadTxn>(
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
fn read_cell_formula<T: yrs::ReadTxn>(
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
fn has_data_at<T: yrs::ReadTxn>(
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

// ---------------------------------------------------------------------------
// Storage Functions — Identity Operations
// ---------------------------------------------------------------------------

/// Get the CellId at a position, creating a marker cell if none exists.
///
/// GridIndex is the sole authority for (row, col) ↔ CellId. When a new
/// identity is created, a placeholder cell (value = Null) is also written
/// to the yrs `cells` map so readers that look up the cell by hex see an
/// entry.
pub(crate) fn get_or_create_cell_id(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    row: u32,
    col: u32,
) -> CellId {
    if let Some(existing) = grid.cell_id_at(row, col) {
        return existing;
    }

    let cell_id = grid.ensure_cell_id(row, col);

    // Persist a placeholder so downstream yrs reads (e.g. exports) see an
    // entry. `ensure_cell_id` already registered the grid-side mapping.
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = doc.transact_mut();
    if let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) {
        let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::Null)]);
        cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
    }

    cell_id
}

/// Update a cell's position in the GridIndex.
///
/// Used by cell relocation operations. `register_cell` removes the stale
/// `(old_row, old_col)` ↔ `cell_id` mapping and installs the new one.
pub(crate) fn update_cell_position(
    _doc: &Doc,
    _sheets: &MapRef,
    _sheet_id: SheetId,
    grid: &mut GridIndex,
    cell_id: CellId,
    new_row: u32,
    new_col: u32,
) {
    grid.register_cell(cell_id, new_row, new_col);
}

// -------------------------------------------------------------------
// Clear Operations
// -------------------------------------------------------------------

/// Clear the `cells` map entries for the given cell hexes.
///
/// Position-agnostic: callers resolve `(row, col) → CellId` via
/// `grid_indexes` and hand the resulting hex strings here. Works on
/// XLSX-hydrated sheets.
///
/// When `clear_properties` is true, the properties map entry is removed
/// as well ("clear all" semantic). When false, only the value is nulled
/// and formatting is preserved ("clear contents").
pub fn clear_cells_by_hex(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    cell_hexes: &[String],
    clear_properties: bool,
) {
    if cell_hexes.is_empty() {
        return;
    }
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return;
    };
    let props_map = if clear_properties {
        get_properties_map(&txn, sheets, &sheet_hex)
    } else {
        None
    };

    for cell_hex in cell_hexes {
        // yrs `Map::insert` on an existing key replaces the MapRef,
        // so stale formula + cached-result keys are dropped. Write a
        // marker cell with only KEY_VALUE=Null so identity is preserved.
        let cell_prelim = MapPrelim::from([(KEY_VALUE, Any::Null)]);
        cells_map.insert(&mut txn, cell_hex.as_str(), cell_prelim);

        if let Some(ref pm) = props_map {
            pm.remove(&mut txn, cell_hex.as_str());
        }
    }
}

/// Clear all cells in a range and return their CellIds.
///
/// Fully deletes cells (removes from cells map + properties) and unbinds
/// them from the GridIndex. Used for structural operations where `#REF!`
/// errors are the correct behavior.
///
/// `exclude` is an optional set of CellIds to skip (for overlapping
/// moves — the relocation path uses this to avoid wiping cells that are
/// about to be re-registered at target positions).
pub fn clear_range_and_return_ids(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    range: &RangePos,
    exclude: Option<&HashSet<CellId>>,
) -> Vec<CellId> {
    // Snapshot matching CellIds before mutating the grid. `cells_in_range`
    // yields `(CellId, row, col)` — we only need the id here.
    let targets: Vec<CellId> = grid
        .cells_in_range(
            range.start_row(),
            range.start_col(),
            range.end_row(),
            range.end_col(),
        )
        .map(|(cid, _, _)| cid)
        .filter(|cid| match exclude {
            Some(exc) => !exc.contains(cid),
            None => true,
        })
        .collect();

    if targets.is_empty() {
        return Vec::new();
    }

    // Remove yrs cells + properties entries. For full delete we want the
    // cells map entry gone (not a marker cell), so we don't use
    // `clear_cells_by_hex` here — inline the minimal removal.
    {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let cells_map = get_cells_map(&txn, sheets, &sheet_hex);
        let props_map = get_properties_map(&txn, sheets, &sheet_hex);

        for cid in &targets {
            let cell_hex = id_to_hex(cid.as_u128());
            if let Some(ref cm) = cells_map {
                cm.remove(&mut txn, &cell_hex);
            }
            if let Some(ref pm) = props_map {
                pm.remove(&mut txn, &cell_hex);
            }
        }
    }

    // Drop identity bindings so these cells no longer resolve at their
    // former positions.
    for cid in &targets {
        grid.remove_cell(cid);
    }

    targets
}

// -------------------------------------------------------------------
// Iteration
// -------------------------------------------------------------------

/// Iterate over all cells in a sheet.
///
/// The callback receives `(row, col, &IterCellData)` for each cell
/// registered in the GridIndex. Values/formulas are read from the yrs
/// `cells` map by cell-hex.
pub(crate) fn for_each_cell<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    mut callback: F,
) where
    F: FnMut(u32, u32, &IterCellData),
{
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return;
    };

    // Collect first to decouple from the grid's internal iterator lifetime.
    let cells: Vec<(CellId, u32, u32)> = grid.cells().collect();
    for (cell_id, row, col) in cells {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let value = read_cell_value(&txn, &cells_map, &cell_hex);
        let formula = read_cell_formula(&txn, &cells_map, &cell_hex);

        let data = IterCellData {
            cell_id,
            row,
            col,
            value,
            formula,
        };
        callback(row, col, &data);
    }
}

/// Iterate over cells in a specific range.
///
/// The callback receives `(row, col, Option<&IterCellData>)` for each
/// position in the range. If there is no cell at a position, the data is
/// `None`.
pub(crate) fn for_each_cell_in_range<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    range: &RangePos,
    mut callback: F,
) where
    F: FnMut(u32, u32, Option<&IterCellData>),
{
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);

    for row in range.start_row()..=range.end_row() {
        for col in range.start_col()..=range.end_col() {
            let data_opt = grid.cell_id_at(row, col).and_then(|cell_id| {
                let cells_map = cells_map.as_ref()?;
                let cell_hex = id_to_hex(cell_id.as_u128());
                let value = read_cell_value(&txn, cells_map, &cell_hex);
                let formula = read_cell_formula(&txn, cells_map, &cell_hex);
                Some(IterCellData {
                    cell_id,
                    row,
                    col,
                    value,
                    formula,
                })
            });
            callback(row, col, data_opt.as_ref());
        }
    }
}

// -------------------------------------------------------------------
// Region Detection
// -------------------------------------------------------------------

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
    let max_row: u32 = 10_000;
    let max_col: u32 = 500;

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let single_cell = RangePos::new(sheet_id, start_row, start_col, start_row, start_col);

    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return single_cell;
    };

    let has_data = |row: u32, col: u32| -> bool { has_data_at(&txn, grid, &cells_map, row, col) };

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

    // Expand outward until no more data found in any direction
    let mut expanded = true;
    while expanded {
        expanded = false;

        // Try expanding up
        if top > 0 {
            let mut found = false;
            for col in left..=right {
                if has_data(top - 1, col) {
                    found = true;
                    break;
                }
            }
            if found {
                top -= 1;
                expanded = true;
            }
        }

        // Try expanding down
        if bottom < max_row {
            let mut found = false;
            for col in left..=right {
                if has_data(bottom + 1, col) {
                    found = true;
                    break;
                }
            }
            if found {
                bottom += 1;
                expanded = true;
            }
        }

        // Try expanding left
        if left > 0 {
            let mut found = false;
            for row in top..=bottom {
                if has_data(row, left - 1) {
                    found = true;
                    break;
                }
            }
            if found {
                left -= 1;
                expanded = true;
            }
        }

        // Try expanding right
        if right < max_col {
            let mut found = false;
            for row in top..=bottom {
                if has_data(row, right + 1) {
                    found = true;
                    break;
                }
            }
            if found {
                right += 1;
                expanded = true;
            }
        }
    }

    RangePos::new(sheet_id, top, left, bottom, right)
}

// ---------------------------------------------------------------------------
// Ctrl+Arrow navigation (find data edge)
// ---------------------------------------------------------------------------

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
    // If not a full column/row selection, return as-is
    if span == RangeSpan::Exact {
        return Some(*range);
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex)?;

    let has_data = |row: u32, col: u32| -> bool { has_data_at(&txn, grid, &cells_map, row, col) };

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
        let data_region = get_current_region(
            doc,
            sheets,
            sheet_id,
            grid,
            first_data_row,
            range.start_col(),
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

        let data_region = get_current_region(
            doc,
            sheets,
            sheet_id,
            grid,
            range.start_row(),
            first_data_col,
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

// -------------------------------------------------------------------
// Relocation
// -------------------------------------------------------------------

/// Relocate cells from source range to target position.
///
/// This is the architecturally correct implementation for cut-paste and
/// drag-move:
/// - CellIds are PRESERVED (stable identities)
/// - Positions are updated in the GridIndex (in-memory authority)
/// - Formulas referencing moved cells automatically work (they reference CellIds)
///
/// This differs from copy-paste which creates NEW CellIds at the target.
///
/// Edge cases handled:
/// 1. Overlapping source and target ranges: cells being moved are excluded
///    from the target clear step.
/// 2. Cross-sheet moves: the cell's yrs data entry is transferred from the
///    source sheet's cells map to the target sheet's cells map (cells are
///    keyed by cell-hex, so the cell's hex survives unchanged).
/// 3. Target cells already have data: cleared first (unless being moved).
///
/// Callers pass:
/// - `source_grid`: the source sheet's GridIndex (always mutated — we
///   remove moved cells from it on cross-sheet moves and re-register on
///   same-sheet moves).
/// - `target_grid`: the target sheet's GridIndex. Pass `None` for
///   same-sheet moves (`source_grid` is reused).
#[allow(clippy::too_many_arguments)]
pub fn relocate_cells(
    doc: &Doc,
    sheets: &MapRef,
    source_sheet: SheetId,
    source_range: &RangePos,
    target_sheet: SheetId,
    target_start_row: u32,
    target_start_col: u32,
    source_grid: &mut GridIndex,
    mut target_grid: Option<&mut GridIndex>,
) -> RelocationResult {
    let same_sheet = source_sheet == target_sheet;
    debug_assert_eq!(
        same_sheet,
        target_grid.is_none(),
        "relocate_cells: target_grid must be None iff source and target sheets are the same"
    );

    // --- 1. Snapshot source cells (CellId + original position) ---
    let source_cells: Vec<(CellId, u32, u32)> = source_grid
        .cells_in_range(
            source_range.start_row(),
            source_range.start_col(),
            source_range.end_row(),
            source_range.end_col(),
        )
        .collect();

    if source_cells.is_empty() {
        return RelocationResult {
            moved_cell_ids: vec![],
            source_positions_vacated: vec![],
            target_cells_cleared: vec![],
            success: true,
            error: None,
        };
    }

    // --- 2. Calculate deltas ---
    let row_delta = target_start_row as i64 - source_range.start_row() as i64;
    let col_delta = target_start_col as i64 - source_range.start_col() as i64;

    // --- 3. Build set of moving CellIds for exclude ---
    let moving_ids: HashSet<CellId> = source_cells.iter().map(|(id, _, _)| *id).collect();

    // --- 4. Clear target range (excluding cells being moved) ---
    let target_range = RangePos::new(
        target_sheet,
        target_start_row,
        target_start_col,
        (source_range.end_row() as i64 + row_delta) as u32,
        (source_range.end_col() as i64 + col_delta) as u32,
    );

    let cleared = {
        let grid_for_clear: &mut GridIndex = match target_grid.as_deref_mut() {
            Some(tg) => tg,
            None => &mut *source_grid,
        };
        clear_range_and_return_ids(
            doc,
            sheets,
            target_sheet,
            grid_for_clear,
            &target_range,
            Some(&moving_ids),
        )
    };

    // --- 5. Apply moves ---
    // For cross-sheet: transfer cell data (value, formula, properties) from
    // source sheet's maps to target sheet's maps. For same-sheet: the data
    // stays put (cells map is keyed by cell-hex), we only rebind positions.
    if !same_sheet {
        let source_hex = id_to_hex(source_sheet.as_u128());
        let target_hex = id_to_hex(target_sheet.as_u128());
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let source_cells_map = get_cells_map(&txn, sheets, &source_hex);
        let target_cells_map = get_cells_map(&txn, sheets, &target_hex);
        let source_props = get_properties_map(&txn, sheets, &source_hex);
        let target_props = get_properties_map(&txn, sheets, &target_hex);

        for (cell_id, _, _) in &source_cells {
            let cell_hex = id_to_hex(cell_id.as_u128());

            // Transfer cell data entry
            if let (Some(s_cells), Some(t_cells)) = (&source_cells_map, &target_cells_map)
                && let Some(Out::YMap(cell_map)) = s_cells.get(&txn, &cell_hex)
            {
                let v = match cell_map.get(&txn, KEY_VALUE) {
                    Some(Out::Any(a)) => a.clone(),
                    _ => Any::Null,
                };
                let prelim = match cell_map.get(&txn, "f") {
                    Some(Out::Any(Any::String(f))) => {
                        MapPrelim::from([(KEY_VALUE, v), ("f", Any::String(f.clone()))])
                    }
                    _ => MapPrelim::from([(KEY_VALUE, v)]),
                };
                s_cells.remove(&mut txn, &cell_hex);
                t_cells.insert(&mut txn, &*cell_hex, prelim);
            }

            // Transfer properties entry
            if let (Some(sp), Some(tp)) = (&source_props, &target_props) {
                if let Some(Out::Any(prop_val)) = sp.get(&txn, &cell_hex) {
                    tp.insert(&mut txn, &*cell_hex, prop_val.clone());
                }
                sp.remove(&mut txn, &cell_hex);
            }
        }
    }

    // Rebind positions in the grid index(es).
    match target_grid {
        Some(tg) => {
            // Cross-sheet: remove from source grid, register in target grid.
            for (cell_id, _, _) in &source_cells {
                source_grid.remove_cell(cell_id);
            }
            for (cell_id, old_row, old_col) in &source_cells {
                let new_row = (*old_row as i64 + row_delta) as u32;
                let new_col = (*old_col as i64 + col_delta) as u32;
                tg.register_cell(*cell_id, new_row, new_col);
            }
        }
        None => {
            // Same-sheet: register_cell on the (now-authoritative) source grid.
            // `register_cell` cleans up any stale old position automatically.
            for (cell_id, old_row, old_col) in &source_cells {
                let new_row = (*old_row as i64 + row_delta) as u32;
                let new_col = (*old_col as i64 + col_delta) as u32;
                source_grid.register_cell(*cell_id, new_row, new_col);
            }

            // Persist the new positions to yrs so the undo manager can
            // reverse the move. For same-sheet relocate the cells map entry
            // stays at the same key (cell-hex is stable), so without this
            // write the undo manager has no record of the position change
            // and undo only reverts the destination clear — leaving the
            // source positions permanently empty (half-undo bug).
            //
            // We do two things per moved cell inside one transaction:
            //  (a) Update gridIndex/{posToId, idToPos}: yrs undo reverses
            //      the position binding → GridIndexCellChange fires → the
            //      engine re-registers the cell at its original position.
            //  (b) Touch the cells map: remove + re-insert the cell entry
            //      so yrs undo emits a CellChange::Modified event that
            //      causes apply_cell_changes to re-read the value from yrs
            //      and emit a viewport patch for the restored position.
            let sheet_hex = id_to_hex(source_sheet.as_u128());
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            let cells_map = get_cells_map(&txn, sheets, &sheet_hex);
            for (cell_id, old_row, old_col) in &source_cells {
                let new_row = (*old_row as i64 + row_delta) as u32;
                let new_col = (*old_col as i64 + col_delta) as u32;
                let cell_hex = id_to_hex(cell_id.as_u128());

                // (a) Update yrs gridIndex for new position.
                // `remove_cell_position_from_yrs` reads the current idToPos
                // (still pointing at old_row/old_col since we haven't touched
                // yrs yet) and removes both idToPos[cell_hex] and posToId[old_key].
                remove_cell_position_from_yrs(&mut txn, sheets, &sheet_hex, &cell_hex);
                // Write new position: posToId[new_key] = cell_hex, idToPos[cell_hex] = new_key.
                if let (Some(rh), Some(ch)) = (
                    source_grid.row_id_hex(new_row),
                    source_grid.col_id_hex(new_col),
                ) {
                    write_cell_position_to_yrs(
                        &mut txn,
                        sheets,
                        &sheet_hex,
                        &cell_hex,
                        rh.as_str(),
                        ch.as_str(),
                    );
                }

                // (b) Touch the VALUE key inside the cell's YMap.
                // The net yrs state is identical, but the CRDT clock for the
                // VALUE key advances so undo produces a CellChange::Modified
                // event for this cell. Without this, the observer never fires
                // for moved cells during undo and no viewport patch is emitted
                // for the restored source position.
                if let Some(ref cm) = cells_map
                    && let Some(Out::YMap(cell_map)) = cm.get(&txn, &cell_hex)
                {
                    let current_value = match cell_map.get(&txn, KEY_VALUE) {
                        Some(Out::Any(a)) => a.clone(),
                        _ => Any::Null,
                    };
                    // Re-write the same value: CRDT clock advances, undo
                    // observable even though logical value is unchanged.
                    cell_map.insert(&mut txn, KEY_VALUE, current_value);
                }
            }
        }
    }

    let moved_ids: Vec<CellId> = source_cells.iter().map(|(id, _, _)| *id).collect();
    let source_positions_vacated: Vec<(u32, u32)> =
        source_cells.iter().map(|(_, r, c)| (*r, *c)).collect();

    RelocationResult {
        moved_cell_ids: moved_ids,
        source_positions_vacated,
        target_cells_cleared: cleared,
        success: true,
        error: None,
    }
}

// Prevent the unused-import warning when this file is built without the
// legacy `Arc<String>` helpers still referenced by relocate_cells's
// cross-sheet transfer path above (Arc is used indirectly via yrs `Any`
// values).
#[allow(dead_code)]
fn _arc_touch() -> Option<Arc<str>> {
    None
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::{IdAllocator, SheetId};
    use compute_document::schema::{KEY_COL_ORDER, KEY_ROW_ORDER};
    use value_types::{CellValue, FiniteF64};
    use yrs::{Array, ArrayPrelim};

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a storage with one sheet plus a GridIndex seeded with the
    /// sheet's RowIds/ColIds. Returns `(storage, sheet_id, grid)`.
    fn storage_with_grid() -> (YrsStorage, SheetId, GridIndex) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sheet_id = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
            .expect("add_sheet should succeed");

        let alloc = &*crate::storage::STORAGE_ID_ALLOC;

        // Initialise rowOrder / colOrder YArrays and collect the hexes so
        // we can build a matching GridIndex.
        let (row_hexes, col_hexes) = {
            let mut row_hexes = Vec::new();
            let mut col_hexes = Vec::new();
            let mut txn = storage.doc().transact_mut();
            let sheet_hex = id_to_hex(sheet_id.as_u128());
            if let Some(Out::YMap(sheet_map)) = storage.sheets_ref().get(&txn, &*sheet_hex) {
                let row_arr = sheet_map.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
                for _ in 0..100u32 {
                    let rid = alloc.next_row_id();
                    let hex = id_to_hex(rid.as_u128());
                    row_arr.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
                    row_hexes.push(hex.to_string());
                }
                let col_arr = sheet_map.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
                for _ in 0..26u32 {
                    let cid = alloc.next_col_id();
                    let hex = id_to_hex(cid.as_u128());
                    col_arr.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
                    col_hexes.push(hex.to_string());
                }
            }
            (row_hexes, col_hexes)
        };

        // Build a fresh Arc<IdAllocator> for the grid — the storage-level
        // static allocator is not directly shareable.
        let alloc_arc: std::sync::Arc<IdAllocator> = std::sync::Arc::new(IdAllocator::new());
        let grid = GridIndex::from_yrs_arrays(sheet_id, &row_hexes, &col_hexes, alloc_arc);

        (storage, sheet_id, grid)
    }

    /// Seed a cell at `(row, col)` by registering a CellId in `grid` and
    /// writing the value to the yrs `cells` map.
    fn seed_cell(
        storage: &YrsStorage,
        sheet_id: SheetId,
        grid: &mut GridIndex,
        row: u32,
        col: u32,
        value: CellValue,
    ) -> CellId {
        let cell_id =
            get_or_create_cell_id(storage.doc(), storage.sheets(), sheet_id, grid, row, col);
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

    fn seed_cell_with_formula(
        storage: &YrsStorage,
        sheet_id: SheetId,
        grid: &mut GridIndex,
        row: u32,
        col: u32,
        value: CellValue,
        formula: &str,
    ) -> CellId {
        let cell_id =
            get_or_create_cell_id(storage.doc(), storage.sheets(), sheet_id, grid, row, col);
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
                    _ => Any::Null,
                };
                let cell_prelim =
                    MapPrelim::from([(KEY_VALUE, v), ("f", Any::String(Arc::from(formula)))]);
                cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
            }
        }
        cell_id
    }

    // -------------------------------------------------------------------
    // Identity: get_or_create_cell_id
    // -------------------------------------------------------------------

    #[test]
    fn test_get_or_create_cell_id_creates_new() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
        assert_ne!(id1.as_u128(), 0);
        assert_eq!(grid.cell_id_at(0, 0), Some(id1));
    }

    #[test]
    fn test_get_or_create_cell_id_returns_existing() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
        let id2 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_get_or_create_different_positions() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);
        let id2 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 1);
        assert_ne!(id1, id2);
    }

    // -------------------------------------------------------------------
    // Identity lookups (GridIndex pass-through)
    // -------------------------------------------------------------------

    #[test]
    fn test_grid_cell_id_at_found() {
        let (storage, sid, mut grid) = storage_with_grid();
        let created_id =
            get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 3, 5);
        assert_eq!(grid.cell_id_at(3, 5), Some(created_id));
    }

    #[test]
    fn test_grid_cell_id_at_not_found() {
        let (_storage, _sid, grid) = storage_with_grid();
        assert!(grid.cell_id_at(99, 25).is_none());
    }

    #[test]
    fn test_grid_cells_in_range_empty() {
        let (_storage, _sid, grid) = storage_with_grid();
        let cells: Vec<_> = grid.cells_in_range(0, 0, 5, 5).collect();
        assert!(cells.is_empty());
    }

    #[test]
    fn test_grid_cells_in_range_finds_cells() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
        );
        let id2 = seed_cell(
            &storage,
            sid,
            &mut grid,
            1,
            1,
            CellValue::Number(FiniteF64::must(2.0)),
        );
        let _id3 = seed_cell(
            &storage,
            sid,
            &mut grid,
            5,
            5,
            CellValue::Number(FiniteF64::must(3.0)),
        );

        let cells: Vec<_> = grid.cells_in_range(0, 0, 2, 2).map(|(c, _, _)| c).collect();
        assert_eq!(cells.len(), 2);
        assert!(cells.contains(&id1));
        assert!(cells.contains(&id2));
    }

    #[test]
    fn test_grid_cells_in_range_single_cell() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = seed_cell(
            &storage,
            sid,
            &mut grid,
            2,
            3,
            CellValue::Number(FiniteF64::must(1.0)),
        );

        let cells: Vec<_> = grid.cells_in_range(2, 3, 2, 3).map(|(c, _, _)| c).collect();
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0], id1);
    }

    // -------------------------------------------------------------------
    // Identity: update_cell_position
    // -------------------------------------------------------------------

    #[test]
    fn test_update_cell_position() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = get_or_create_cell_id(storage.doc(), storage.sheets(), sid, &mut grid, 0, 0);

        update_cell_position(storage.doc(), storage.sheets(), sid, &mut grid, id1, 5, 5);

        assert!(grid.cell_id_at(0, 0).is_none());
        assert_eq!(grid.cell_id_at(5, 5), Some(id1));
    }

    // -------------------------------------------------------------------
    // clear_cells_by_hex: works on XLSX-hydrated sheets
    // -------------------------------------------------------------------

    /// Overwrite semantics: yrs `Map::insert` of a fresh `MapPrelim` onto
    /// an existing key must REPLACE the prior MapRef, not merge. This is
    /// the load-bearing assumption behind `clear_cells_by_hex`: an
    /// existing cell's `f` / cached-result keys must not survive the
    /// clear.
    #[test]
    fn test_clear_cells_by_hex_overwrites_existing_cell_map() {
        let (storage, sid, mut grid) = storage_with_grid();
        let cell_id = seed_cell_with_formula(
            &storage,
            sid,
            &mut grid,
            0,
            0,
            CellValue::Number(FiniteF64::must(42.0)),
            "=A2+B2",
        );
        let cell_hex = id_to_hex(cell_id.as_u128()).to_string();

        clear_cells_by_hex(
            storage.doc(),
            storage.sheets(),
            sid,
            &[cell_hex.clone()],
            true,
        );

        let sheet_hex = id_to_hex(sid.as_u128());
        let txn = storage.doc().transact();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
        let cell_map = match cells_map.get(&txn, cell_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => panic!("cell map missing after clear"),
        };

        let keys: Vec<String> = cell_map.iter(&txn).map(|(k, _)| k.to_string()).collect();
        assert_eq!(
            keys,
            vec![KEY_VALUE.to_string()],
            "after clear_cells_by_hex the cell map must contain ONLY KEY_VALUE; \
             formula and any other keys must be gone. Actual keys: {:?}",
            keys
        );

        match cell_map.get(&txn, KEY_VALUE) {
            Some(Out::Any(Any::Null)) => {}
            other => panic!("value should be Null after clear, got: {:?}", other),
        }
    }

    // -------------------------------------------------------------------
    // clear_range_and_return_ids: fully deletes
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_range_and_return_ids_basic() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
        );
        let id2 = seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            1,
            CellValue::Number(FiniteF64::must(2.0)),
        );

        let range = RangePos::new(sid, 0, 0, 0, 1);
        let cleared = clear_range_and_return_ids(
            storage.doc(),
            storage.sheets(),
            sid,
            &mut grid,
            &range,
            None,
        );

        assert_eq!(cleared.len(), 2);
        assert!(cleared.contains(&id1));
        assert!(cleared.contains(&id2));

        assert!(grid.cell_id_at(0, 0).is_none());
        assert!(grid.cell_id_at(0, 1).is_none());
    }

    #[test]
    fn test_clear_range_and_return_ids_empty() {
        let (storage, sid, mut grid) = storage_with_grid();
        let range = RangePos::new(sid, 0, 0, 5, 5);
        let cleared = clear_range_and_return_ids(
            storage.doc(),
            storage.sheets(),
            sid,
            &mut grid,
            &range,
            None,
        );
        assert!(cleared.is_empty());
    }

    // -------------------------------------------------------------------
    // for_each_cell: iterates all cells
    // -------------------------------------------------------------------

    #[test]
    fn test_for_each_cell_basic() {
        let (storage, sid, mut grid) = storage_with_grid();
        seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            0,
            CellValue::Number(FiniteF64::must(10.0)),
        );
        seed_cell(
            &storage,
            sid,
            &mut grid,
            1,
            1,
            CellValue::Number(FiniteF64::must(20.0)),
        );
        seed_cell(
            &storage,
            sid,
            &mut grid,
            2,
            2,
            CellValue::Number(FiniteF64::must(30.0)),
        );

        let mut visited = Vec::new();
        for_each_cell(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            |row, col, data| {
                visited.push((row, col, data.cell_id));
            },
        );

        assert_eq!(visited.len(), 3);
    }

    #[test]
    fn test_for_each_cell_empty_sheet() {
        let (storage, sid, grid) = storage_with_grid();
        let mut count = 0;
        for_each_cell(storage.doc(), storage.sheets(), sid, &grid, |_, _, _| {
            count += 1;
        });
        assert_eq!(count, 0);
    }

    // -------------------------------------------------------------------
    // for_each_cell_in_range: only range cells
    // -------------------------------------------------------------------

    #[test]
    fn test_for_each_cell_in_range_basic() {
        let (storage, sid, mut grid) = storage_with_grid();
        seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            0,
            CellValue::Number(FiniteF64::must(1.0)),
        );
        seed_cell(
            &storage,
            sid,
            &mut grid,
            5,
            5,
            CellValue::Number(FiniteF64::must(99.0)),
        );

        let range = RangePos::new(sid, 0, 0, 1, 1);
        let mut with_data = 0;
        let mut without_data = 0;

        for_each_cell_in_range(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            &range,
            |_, _, data| {
                if data.is_some() {
                    with_data += 1;
                } else {
                    without_data += 1;
                }
            },
        );

        assert_eq!(with_data, 1);
        assert_eq!(without_data, 3);
    }

    #[test]
    fn test_for_each_cell_in_range_all_empty() {
        let (storage, sid, grid) = storage_with_grid();
        let range = RangePos::new(sid, 0, 0, 1, 1);

        let mut all_none = true;
        for_each_cell_in_range(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            &range,
            |_, _, data| {
                if data.is_some() {
                    all_none = false;
                }
            },
        );
        assert!(all_none);
    }

    // -------------------------------------------------------------------
    // get_current_region: contiguous block
    // -------------------------------------------------------------------

    #[test]
    fn test_get_current_region_contiguous_block() {
        let (storage, sid, mut grid) = storage_with_grid();
        for row in 0..3u32 {
            for col in 0..3u32 {
                seed_cell(
                    &storage,
                    sid,
                    &mut grid,
                    row,
                    col,
                    CellValue::Number(FiniteF64::must((row * 3 + col) as f64)),
                );
            }
        }

        let region = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 1, 1);
        assert_eq!(region.start_row(), 0);
        assert_eq!(region.start_col(), 0);
        assert_eq!(region.end_row(), 2);
        assert_eq!(region.end_col(), 2);
    }

    #[test]
    fn test_get_current_region_isolated_empty_cell() {
        let (storage, sid, grid) = storage_with_grid();
        let region = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 50, 10);
        assert_eq!(region.start_row(), 50);
        assert_eq!(region.start_col(), 10);
        assert_eq!(region.end_row(), 50);
        assert_eq!(region.end_col(), 10);
    }

    #[test]
    fn test_get_current_region_isolated_cell() {
        let (storage, sid, mut grid) = storage_with_grid();
        seed_cell(
            &storage,
            sid,
            &mut grid,
            10,
            10,
            CellValue::Number(FiniteF64::must(1.0)),
        );

        let region = get_current_region(storage.doc(), storage.sheets(), sid, &grid, 10, 10);
        assert_eq!(region.start_row(), 10);
        assert_eq!(region.start_col(), 10);
        assert_eq!(region.end_row(), 10);
        assert_eq!(region.end_col(), 10);
    }

    #[test]
    fn test_get_data_bounds_normal_range() {
        let (storage, sid, grid) = storage_with_grid();
        let range = RangePos::new(sid, 0, 0, 5, 5);
        let result = get_data_bounds_for_range(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            &range,
            RangeSpan::Exact,
        );
        assert_eq!(result, Some(range));
    }

    #[test]
    fn test_get_data_bounds_full_column_no_data() {
        let (storage, sid, grid) = storage_with_grid();
        let range = RangePos::new(sid, 0, 0, 99, 0);
        let result = get_data_bounds_for_range(
            storage.doc(),
            storage.sheets(),
            sid,
            &grid,
            &range,
            RangeSpan::FullColumns,
        );
        assert!(result.is_none());
    }

    // -------------------------------------------------------------------
    // relocate_cells: same sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_relocate_cells_same_sheet() {
        let (storage, sid, mut grid) = storage_with_grid();
        let id1 = seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            0,
            CellValue::Number(FiniteF64::must(10.0)),
        );
        let id2 = seed_cell(
            &storage,
            sid,
            &mut grid,
            0,
            1,
            CellValue::Number(FiniteF64::must(20.0)),
        );

        let source = RangePos::new(sid, 0, 0, 0, 1);
        let result = relocate_cells(
            storage.doc(),
            storage.sheets(),
            sid,
            &source,
            sid,
            5,
            5,
            &mut grid,
            None,
        );

        assert!(result.success);
        assert_eq!(result.moved_cell_ids.len(), 2);
        assert!(result.moved_cell_ids.contains(&id1));
        assert!(result.moved_cell_ids.contains(&id2));

        assert_eq!(grid.cell_id_at(5, 5), Some(id1));
        assert_eq!(grid.cell_id_at(5, 6), Some(id2));
        assert!(grid.cell_id_at(0, 0).is_none());
        assert!(grid.cell_id_at(0, 1).is_none());
    }

    #[test]
    fn test_relocate_cells_empty_source() {
        let (storage, sid, mut grid) = storage_with_grid();
        let source = RangePos::new(sid, 0, 0, 0, 0);
        let result = relocate_cells(
            storage.doc(),
            storage.sheets(),
            sid,
            &source,
            sid,
            5,
            5,
            &mut grid,
            None,
        );
        assert!(result.success);
        assert!(result.moved_cell_ids.is_empty());
    }

    // -------------------------------------------------------------------
    // CellRange
    // -------------------------------------------------------------------

    #[test]
    fn test_cell_range_new() {
        let sid = make_sheet_id(1);
        let range = RangePos::new(sid, 0, 0, 10, 5);
        assert_eq!(range.sheet(), sid);
        assert_eq!(range.start_row(), 0);
        assert_eq!(range.start_col(), 0);
        assert_eq!(range.end_row(), 10);
        assert_eq!(range.end_col(), 5);
    }
}
