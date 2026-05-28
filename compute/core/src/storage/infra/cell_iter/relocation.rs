use std::collections::HashSet;
use std::sync::Arc;

use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_VALUE;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::super::grid_helpers::{get_cells_map, get_properties_map};
use super::clear::clear_range_and_return_ids;
use super::types::RelocationResult;
use crate::storage::cells::values::{remove_cell_position_from_yrs, write_cell_position_to_yrs};
use cell_types::{CellId, RangePos, SheetId};

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
