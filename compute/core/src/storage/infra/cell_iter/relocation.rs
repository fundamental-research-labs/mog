use std::collections::HashSet;
use std::sync::Arc;

use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_ARRAY_REF, KEY_FORMULA_METADATA, KEY_VALUE};
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::types::AsPrelim;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::super::grid_helpers::{get_cells_map, get_properties_map};
use super::clear::clear_range_and_return_ids;
use super::types::RelocationResult;
use crate::storage::cells::values::{remove_cell_position_from_yrs, write_cell_position_to_yrs};
use cell_types::{CellId, RangePos, SheetId, SheetPos};

/// Parse a local A1 cell/range reference into zero-based inclusive bounds.
/// Formula metadata `ref`/`ar` values are local worksheet geometry; a
/// qualified reference cannot be safely translated by this operation.
fn parse_local_a1_bounds(value: &str) -> Option<(u32, u32, u32, u32)> {
    if value.contains('!') {
        return None;
    }
    let range = compute_parser::parse_a1_range(value)?;
    let (sr, sc) = match range.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (er, ec) = match range.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some((sr, sc, er, ec))
}

/// Translate a coordinate-bearing metadata range only when it is exactly the
/// complete source range.  A partial move cannot retain an executable shared,
/// array, or CSE extent without replaying the old geometry at the destination.
fn translate_complete_range(
    value: &str,
    source_bounds: (u32, u32, u32, u32),
    target_row: u32,
    target_col: u32,
) -> Option<String> {
    let (sr, sc, er, ec) = parse_local_a1_bounds(value)?;
    if (sr, sc, er, ec) != source_bounds {
        return None;
    }
    let row_delta = target_row as i64 - source_bounds.0 as i64;
    let col_delta = target_col as i64 - source_bounds.1 as i64;
    let target_end_row = er as i64 + row_delta;
    let target_end_col = ec as i64 + col_delta;
    if target_end_row < 0 || target_end_col < 0 {
        return None;
    }
    let start = SheetPos::new(target_row, target_col);
    let end = SheetPos::new(target_end_row as u32, target_end_col as u32);
    Some(format!("{start}:{end}"))
}

/// Shared formula followers omit `ref`; retain them only when the source
/// operation also contains an anchor whose `si` declares this exact complete
/// range. Without that proof a single-cell/partial move would leave a shared
/// follower attached to a stale group.
fn complete_shared_indices<T: yrs::ReadTxn>(
    cells_map: &MapRef,
    txn: &T,
    source_cells: &[(CellId, u32, u32)],
    source_bounds: (u32, u32, u32, u32),
) -> HashSet<u32> {
    let mut indices = HashSet::new();
    for (cell_id, _, _) in source_cells {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let Some(Out::YMap(cell_map)) = cells_map.get(txn, &cell_hex) else {
            continue;
        };
        let Some(Out::Any(Any::String(json))) = cell_map.get(txn, KEY_FORMULA_METADATA) else {
            continue;
        };
        let Ok(formula) = serde_json::from_str::<ooxml_types::worksheet::CellFormula>(&json) else {
            continue;
        };
        if formula.t != ooxml_types::worksheet::CellFormulaType::Shared {
            continue;
        }
        let Some(si) = formula.si else {
            continue;
        };
        if formula.r#ref.as_deref().and_then(parse_local_a1_bounds) == Some(source_bounds) {
            indices.insert(si);
        }
    }
    indices
}

/// Reconcile persisted formula metadata with a cut/move geometry.
///
/// Normal metadata is an authored marker and remains cell-owned.  Shared and
/// array metadata is translated only when its complete declared extent is the
/// moved range; otherwise the executable marker and CSE extent are removed,
/// leaving the formula identity/body for ordinary recalculation.  Data-table
/// regions are workbook-level records and are not moved by this cell operation,
/// so their cell-level executable metadata is always invalidated.
fn sanitize_moved_formula_metadata(
    cell_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    source_bounds: (u32, u32, u32, u32),
    target_row: u32,
    target_col: u32,
    complete_shared_indices: &HashSet<u32>,
) {
    let formula_metadata = match cell_map.get(&*txn, KEY_FORMULA_METADATA) {
        Some(Out::Any(Any::String(json))) => Some(json.to_string()),
        _ => None,
    };
    let array_ref = match cell_map.get(&*txn, KEY_ARRAY_REF) {
        Some(Out::Any(Any::String(value))) => Some(value.to_string()),
        _ => None,
    };

    let translated_array_ref = array_ref
        .as_deref()
        .and_then(|value| translate_complete_range(value, source_bounds, target_row, target_col));
    let array_ref_is_stale = array_ref.is_some() && translated_array_ref.is_none();

    let mut remove_formula_metadata = false;
    let mut translated_formula_metadata = None;
    if let Some(json) = formula_metadata {
        if let Ok(mut formula) = serde_json::from_str::<ooxml_types::worksheet::CellFormula>(&json)
        {
            match formula.t {
                ooxml_types::worksheet::CellFormulaType::Normal => {
                    // Normal metadata is non-executable geometry. Preserve
                    // the authored JSON byte-for-byte below.
                }
                ooxml_types::worksheet::CellFormulaType::Shared
                | ooxml_types::worksheet::CellFormulaType::Array => {
                    let translated_ref = formula.r#ref.as_deref().and_then(|value| {
                        translate_complete_range(value, source_bounds, target_row, target_col)
                    });
                    if formula.t == ooxml_types::worksheet::CellFormulaType::Shared
                        && formula.r#ref.is_none()
                        && formula
                            .si
                            .is_some_and(|si| complete_shared_indices.contains(&si))
                    {
                        // A follower is safe only when the operation also
                        // moved its matching complete-range anchor.
                        translated_formula_metadata = Some(json);
                    } else if let Some(translated_ref) = translated_ref {
                        // Array metadata and an existing CSE marker must agree;
                        // otherwise retain neither executable representation.
                        if formula.t == ooxml_types::worksheet::CellFormulaType::Array
                            && array_ref_is_stale
                        {
                            remove_formula_metadata = true;
                        } else {
                            formula.r#ref = Some(translated_ref);
                            translated_formula_metadata = serde_json::to_string(&formula).ok();
                        }
                    } else {
                        remove_formula_metadata = true;
                    }
                }
                ooxml_types::worksheet::CellFormulaType::DataTable => {
                    // The authoritative DataTableRegion is not part of this
                    // cell move, so retaining this marker would replay stale
                    // workbook-level geometry at the destination.
                    remove_formula_metadata = true;
                }
            }
        }
    }

    if remove_formula_metadata {
        cell_map.remove(txn, KEY_FORMULA_METADATA);
    } else if let Some(json) = translated_formula_metadata {
        cell_map.insert(txn, KEY_FORMULA_METADATA, Any::String(Arc::from(json)));
    }

    match translated_array_ref {
        Some(value) if !remove_formula_metadata => {
            cell_map.insert(txn, KEY_ARRAY_REF, Any::String(Arc::from(value)));
        }
        _ if array_ref.is_some() => {
            cell_map.remove(txn, KEY_ARRAY_REF);
        }
        _ => {}
    }
}

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
        let complete_shared = source_cells_map
            .as_ref()
            .map(|cells| {
                complete_shared_indices(
                    cells,
                    &txn,
                    &source_cells,
                    (
                        source_range.start_row(),
                        source_range.start_col(),
                        source_range.end_row(),
                        source_range.end_col(),
                    ),
                )
            })
            .unwrap_or_default();

        for (cell_id, _, _) in &source_cells {
            let cell_hex = id_to_hex(cell_id.as_u128());

            // Transfer the complete structured cell entry.  A cell map owns
            // more than the display value and legacy formula body: imported
            // formula metadata (`fm`), CSE range (`ar`), formula result mode
            // (`frm`), identity formula fields (`ft`/`fr`/`fda`/`fv`/`fa`),
            // and rich-string state (`rt`) all live beside `v`/`f`.
            // Rebuilding the map from only those two keys silently turns an
            // authored empty `<f/>` marker into a plain value and drops the
            // other OOXML formula families as well.
            //
            // `MapRef::as_prelim` is the existing structured transfer
            // contract.  It deep-copies nested Yrs values, so removing the
            // source entry and inserting the prelim into the destination
            // cannot leave a shared child type attached to both sheets.
            if let (Some(s_cells), Some(t_cells)) = (&source_cells_map, &target_cells_map)
                && let Some(Out::YMap(cell_map)) = s_cells.get(&txn, &cell_hex)
            {
                sanitize_moved_formula_metadata(
                    &cell_map,
                    &mut txn,
                    (
                        source_range.start_row(),
                        source_range.start_col(),
                        source_range.end_row(),
                        source_range.end_col(),
                    ),
                    target_start_row,
                    target_start_col,
                    &complete_shared,
                );
                let prelim = cell_map.as_prelim(&txn);
                s_cells.remove(&mut txn, &cell_hex);
                t_cells.insert(&mut txn, &*cell_hex, prelim);
            }

            // Transfer properties entry
            if let (Some(sp), Some(tp)) = (&source_props, &target_props) {
                let prop_prelim = sp
                    .get(&txn, &cell_hex)
                    .map(|prop_val| prop_val.as_prelim(&txn));
                if let Some(prop_prelim) = prop_prelim {
                    // Cell properties can be either a compact JSON scalar or
                    // a structured Y.Map.  Preserve both representations;
                    // matching only `Out::Any` loses imported style/cache
                    // metadata when the source uses the structured form.
                    tp.insert(&mut txn, &*cell_hex, prop_prelim);
                }
                sp.remove(&mut txn, &cell_hex);
            }
        }
    }

    // Rebind positions in the grid index(es).
    match target_grid {
        Some(tg) => {
            // Cross-sheet: persist the identity handoff before updating the
            // in-memory indexes.  The cell maps are moved above, but the
            // yrs-side gridIndex is the durable position authority used by
            // rebuilds and undo/redo.  Leaving the old source binding there
            // makes the forward move look correct only until the next
            // rebuild, and undo cannot restore the source GridIndex entry.
            if !same_sheet {
                let source_hex = id_to_hex(source_sheet.as_u128());
                let target_hex = id_to_hex(target_sheet.as_u128());
                let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
                for (cell_id, old_row, old_col) in &source_cells {
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    remove_cell_position_from_yrs(&mut txn, sheets, &source_hex, &cell_hex);

                    let new_row = (*old_row as i64 + row_delta) as u32;
                    let new_col = (*old_col as i64 + col_delta) as u32;
                    if let (Some(row_hex), Some(col_hex)) =
                        (tg.row_id_hex(new_row), tg.col_id_hex(new_col))
                    {
                        write_cell_position_to_yrs(
                            &mut txn,
                            sheets,
                            &target_hex,
                            &cell_hex,
                            row_hex.as_str(),
                            col_hex.as_str(),
                        );
                    }
                }
            }

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
            let complete_shared = cells_map
                .as_ref()
                .map(|cells| {
                    complete_shared_indices(
                        cells,
                        &txn,
                        &source_cells,
                        (
                            source_range.start_row(),
                            source_range.start_col(),
                            source_range.end_row(),
                            source_range.end_col(),
                        ),
                    )
                })
                .unwrap_or_default();
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
                    sanitize_moved_formula_metadata(
                        &cell_map,
                        &mut txn,
                        (
                            source_range.start_row(),
                            source_range.start_col(),
                            source_range.end_row(),
                            source_range.end_col(),
                        ),
                        target_start_row,
                        target_start_col,
                        &complete_shared,
                    );
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
