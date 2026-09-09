use std::collections::HashSet;

use cell_types::{CellId, RangePos, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::{CellChange, CellPosition, RecalcResult};
use crate::snapshot::{ChangeKind, PivotTableChange, TableChange};
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::services::{metadata_shift, mutation};
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::data_tables;
use yrs::{Origin, Transact};

use super::patches::{merge_recalc_results, synthetic_null_change};

// ---------------------------------------------------------------------------
// mutation_relocate_cells
// ---------------------------------------------------------------------------

/// Relocate cells from source range to target position with full 5-store sync.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_relocate_cells(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
) -> Result<
    (
        RecalcResult,
        crate::engine_types::RelocateResult,
        Vec<TableChange>,
        Vec<PivotTableChange>,
    ),
    ComputeError,
> {
    use crate::engine_types::RelocateResult;
    use crate::storage::infra::cell_iter;

    // Range guard: reject if the source sheet is Range-backed.
    if mirror
        .get_sheet(source_sheet_id)
        .is_some_and(|s| !s.range_views_is_empty())
    {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: source_sheet_id.to_uuid_string(),
            operation: "relocate_cells".to_string(),
        });
    }

    let source_range = RangePos::new(
        *source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
    );

    mutation.observer.set_suppressed(true);
    let result = if source_sheet_id == target_sheet_id {
        let Some(grid) = stores.grid_indexes.get_mut(source_sheet_id) else {
            mutation.observer.set_suppressed(false);
            return Err(ComputeError::SheetNotFound {
                sheet_id: id_to_hex(source_sheet_id.as_u128()).to_string(),
            });
        };
        cell_iter::relocate_cells(
            stores.storage.doc(),
            stores.storage.sheets(),
            *source_sheet_id,
            &source_range,
            *target_sheet_id,
            target_row,
            target_col,
            grid,
            None,
        )
    } else {
        // Cross-sheet: need mutable borrows of two different grids. `get_many_mut`
        // isn't available, so split the map with `iter_mut` + a match.
        let (src_grid, tgt_grid) = {
            let mut src: Option<&mut _> = None;
            let mut tgt: Option<&mut _> = None;
            for (sid, grid) in stores.grid_indexes.iter_mut() {
                if sid == source_sheet_id {
                    src = Some(grid);
                } else if sid == target_sheet_id {
                    tgt = Some(grid);
                }
            }
            match (src, tgt) {
                (Some(s), Some(t)) => (s, t),
                _ => {
                    mutation.observer.set_suppressed(false);
                    return Err(ComputeError::SheetNotFound {
                        sheet_id: format!(
                            "source={} target={}",
                            id_to_hex(source_sheet_id.as_u128()),
                            id_to_hex(target_sheet_id.as_u128())
                        ),
                    });
                }
            }
        };
        cell_iter::relocate_cells(
            stores.storage.doc(),
            stores.storage.sheets(),
            *source_sheet_id,
            &source_range,
            *target_sheet_id,
            target_row,
            target_col,
            src_grid,
            Some(tgt_grid),
        )
    };

    let (data_table_mutation, stale_table_cells) = if result.moved_cell_ids.is_empty() {
        (data_tables::DataTableRegionMutation::default(), Vec::new())
    } else {
        let workbook = stores.storage.workbook_map().clone();
        let sheets = stores.storage.sheets().clone();
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
        let region_mutation = data_tables::relocate_regions_in_txn(
            &workbook,
            &mut txn,
            source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id,
            target_row,
            target_col,
        );
        let mut stale_cells = Vec::new();
        for (sheet_id, start_row, start_col, end_row, end_col) in &region_mutation.formula_ranges {
            let ids: Vec<CellId> = stores
                .grid_indexes
                .get(sheet_id)
                .map(|grid| {
                    grid.cells_in_range(*start_row, *start_col, *end_row, *end_col)
                        .map(|(cell_id, _, _)| cell_id)
                        .collect()
                })
                .unwrap_or_default();
            stale_cells.extend(
                data_tables::clear_table_formula_cells_in_txn(&sheets, &mut txn, sheet_id, &ids)
                    .into_iter()
                    .map(|cell_id| (*sheet_id, cell_id)),
            );
        }
        stale_cells
            .sort_unstable_by_key(|(sheet_id, cell_id)| (sheet_id.as_u128(), cell_id.as_u128()));
        stale_cells.dedup();
        (region_mutation, stale_cells)
    };
    mutation.observer.set_suppressed(false);
    if data_table_mutation.changed {
        let regions = data_tables::get_all_data_table_regions(
            stores.storage.doc(),
            stores.storage.workbook_map(),
        );
        mirror.replace_data_table_regions(regions);
    }

    let stale_table_cells: HashSet<(SheetId, CellId)> = stale_table_cells.into_iter().collect();

    metadata_shift::relocate_validation_ranges(
        stores,
        source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
        target_sheet_id,
        target_row,
        target_col,
    );
    let table_changes = relocate_whole_tables(
        stores,
        mirror,
        source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
        target_sheet_id,
        target_row,
        target_col,
    );

    // Relocate any pivot whose entire output sits inside the moved range. This
    // shifts the authoritative anchor; the returned changes signal the caller
    // (apply_relocate_cells_yrs) to re-materialize and rebuild the sheet
    // viewport so the old rendered region is cleared and the new one drawn.
    let source_sheet_hex = source_sheet_id.to_uuid_string();
    let pivot_changes: Vec<PivotTableChange> = metadata_shift::relocate_pivot_ranges(
        stores,
        mirror,
        source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
        target_sheet_id,
        target_row,
        target_col,
    )
    .into_iter()
    .map(|pivot_id| PivotTableChange {
        sheet_id: source_sheet_hex.clone(),
        pivot_id,
        kind: ChangeKind::Set,
    })
    .collect();

    // 2. Sync mirror and compute for all affected cells. The GridIndex is
    //    already in its final state post-relocation, so we can look up
    //    target positions straight from it.
    let mut moved_validation_edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> =
        Vec::new();
    let mut moved_cell_ids = Vec::new();
    let mut clear_ids: Vec<CellId> = Vec::new();

    for &cell_id in &result.target_cells_cleared {
        clear_ids.push(cell_id);
    }

    for &cell_id in &result.moved_cell_ids {
        if let Some(grid) = stores.grid_indexes.get(target_sheet_id)
            && let Some((new_row, new_col)) = grid.cell_position(&cell_id)
            && let Some((value, _formula, identity_formula, array_ref)) = stores
                .storage
                .read_cell_from_yrs_full(target_sheet_id, &cell_id)
        {
            let identity_formula = if stale_table_cells.contains(&(*target_sheet_id, cell_id)) {
                None
            } else {
                identity_formula.or_else(|| mirror.get_formula(&cell_id).cloned())
            };
            mirror.apply_edit(
                target_sheet_id,
                cell_id,
                SheetPos::new(new_row, new_col),
                value.clone(),
                identity_formula,
            );
            mutation::reconcile_persisted_array_ref(
                mirror,
                target_sheet_id,
                &cell_id,
                array_ref.as_deref(),
            );
            moved_validation_edits.push((*target_sheet_id, cell_id, new_row, new_col, value, None));
            moved_cell_ids.push(cell_id);
        }
    }

    // filter viewport R5.3: emit clear-patches for the target-cleared range.
    // The clear pass populates `recalc.changed_cells` with `Null` entries
    // for each cell displaced by the move so the viewport buffer
    // atomically transitions away from the old values; previously this
    // was discarded via `let _ =` and the source cells stayed in the
    // buffer until a viewport refresh.
    let clear_recalc = if clear_ids.is_empty() {
        RecalcResult::empty()
    } else {
        stores.compute.clear_cells(mirror, &clear_ids)?
    };

    if !moved_validation_edits.is_empty() {
        stores
            .compute
            .validate_raw_user_edit_region_writes(mirror, &moved_validation_edits)?;
    }

    // Invalidating a region removes its workbook-level owner and its cell-level
    // executable TABLE marker together. Re-seed the scheduler with the cached
    // values as literals so the next recalc cannot route an orphan TABLE call to
    // the ordinary function evaluator (#NAME!).
    let mut stale_table_edits = Vec::new();
    for (sheet_id, cell_id) in &stale_table_cells {
        let Some(grid) = stores.grid_indexes.get(sheet_id) else {
            continue;
        };
        let Some((row, col)) = grid.cell_position(cell_id) else {
            continue;
        };
        let Some((value, _, _, _)) = stores.storage.read_cell_from_yrs_full(sheet_id, cell_id)
        else {
            continue;
        };
        if !moved_cell_ids.contains(cell_id) {
            mirror.apply_edit(
                sheet_id,
                *cell_id,
                SheetPos::new(row, col),
                value.clone(),
                None,
            );
        }
        stale_table_edits.push((*sheet_id, *cell_id, row, col, value, None));
    }
    let stale_table_recalc = if stale_table_edits.is_empty() {
        RecalcResult::empty()
    } else {
        let mut ids_by_sheet = std::collections::HashMap::<SheetId, Vec<CellId>>::new();
        for (sheet_id, cell_id, _, _, _, _) in &stale_table_edits {
            ids_by_sheet.entry(*sheet_id).or_default().push(*cell_id);
        }
        {
            let _suppress = mutation.suppress_guard();
            for (sheet_id, cell_ids) in ids_by_sheet {
                crate::storage::properties::clear_formula_cache_metadata_for_cell_ids(
                    stores.storage.doc(),
                    stores.storage.workbook_map(),
                    stores.storage.sheets(),
                    &sheet_id,
                    &cell_ids,
                );
            }
        }
        stores.compute.set_cells_raw_with_trust(
            mirror,
            &stale_table_edits,
            true,
            crate::scheduler::WriteTrust::TrustedReplay,
        )?
    };

    let mut recalc = if moved_cell_ids.is_empty() {
        let mut recalc = stale_table_recalc;
        merge_recalc_results(&mut recalc, clear_recalc);
        recalc
    } else {
        // Recalculate moved cells from their CellIds. Replaying formula text
        // through set_cells_raw reparses stale A1 strings after structural
        // shifts and can drop identity references that were already correct.
        stores
            .compute
            .regenerate_formula_strings_and_cell_formula_text(mirror);
        let mut moved_recalc = stores.compute.recalc(mirror, &moved_cell_ids)?;
        append_moved_cell_target_changes(stores, mirror, &mut moved_recalc, &moved_cell_ids);
        merge_recalc_results(&mut moved_recalc, stale_table_recalc);
        merge_recalc_results(&mut moved_recalc, clear_recalc);
        moved_recalc
    };

    // 3. Source-position clear pass.
    //
    // R5.3 covered `target_cells_cleared` (pre-existing destination cells
    // displaced by the move) but NOT the source positions the moved cells
    // vacated. Same-sheet cut-paste therefore left the source viewport
    // buffer showing stale values: `register_cell` cleaned up the grid
    // index but no patch was emitted for the old positions, so the
    // buffered value at A1 stayed visible until a full viewport refresh.
    //
    // R5.3 deleted the kernel-side `onCutPasteComplete` band-aid on the
    // premise that the Rust patch channel handled this. It didn't — fix
    // is here.
    //
    // We append synthetic Null `CellChange` entries (position-keyed,
    // empty `cell_id` since no live CellId remains at the vacated
    // position) for each source position that's now empty. These flow
    // through `flush_viewport_patches()` the same way target writes do;
    // the binary patch's value-type bits are `Null` (0), which tells the
    // viewport buffer the cell is empty.
    //
    // Filter out source positions that now host a moved CellId — overlap
    // case (e.g. moving A1:A3 to A2:A4 keeps A2 and A3 occupied by the
    // moved cells). Emitting Null at those positions would shadow the
    // valid destination write that already lives in `recalc.changed_cells`.
    if !result.source_positions_vacated.is_empty() {
        let post_grid_has = |row: u32, col: u32| {
            stores
                .grid_indexes
                .get(source_sheet_id)
                .and_then(|g| g.cell_id_at(row, col))
                .is_some()
        };
        let mut source_clears = Vec::with_capacity(result.source_positions_vacated.len());
        for &(row, col) in &result.source_positions_vacated {
            // If a CellId still occupies this position post-relocate, the
            // destination write (or an overlap-survivor) already produces
            // the correct patch. Skip.
            if post_grid_has(row, col) {
                continue;
            }

            // Same-sheet relocate corrupts the mirror at the source
            // position: `apply_edit` for the moved cell wrote the new
            // (row,col) into `pos_to_id`/`id_to_pos`/`col_data` but did
            // NOT erase the old (row,col). The old `pos_to_id[(r,c)]`
            // still points at the moved CellId, and `col_data[col][row]`
            // still holds the old value. `for_each_cell_in_range` (the
            // production read path the kernel's `getCellsViaBridge`
            // fallback uses) sees `cell_id_at(r,c)=None` (grid is
            // right) but falls through to
            // `mirror.get_cell_value_at((r,c))` which returns the
            // stale value, so `query_range` reports the source cell
            // as still occupied. Cross-sheet doesn't hit this because
            // the source sheet's mirror entry never had the moved
            // CellId at the new position to begin with — only
            // same-sheet has the dual-mapping problem.
            //
            // Restore mirror coherence by vacating the position. The
            // CellId itself stays alive (it's at the new position
            // now); we only clear the position→id and col_data
            // entries left behind.
            mirror.vacate_position(source_sheet_id, SheetPos::new(row, col));

            source_clears.push(synthetic_null_change(source_sheet_id, row, col));
        }
        if !source_clears.is_empty() {
            let mut source_recalc = RecalcResult::empty();
            source_recalc.changed_cells = source_clears;
            merge_recalc_results(&mut recalc, source_recalc);
        }
    }

    stores
        .compute
        .regenerate_formula_strings_and_cell_formula_text(mirror);

    let moved_ids: Vec<String> = result
        .moved_cell_ids
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()).into())
        .collect();
    let cleared_ids: Vec<String> = result
        .target_cells_cleared
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()).into())
        .collect();

    let relocate_result = RelocateResult {
        moved_cell_ids: moved_ids,
        target_cells_cleared: cleared_ids,
        success: result.success,
        error: result.error,
    };

    Ok((recalc, relocate_result, table_changes, pivot_changes))
}

fn append_moved_cell_target_changes(
    stores: &EngineStores,
    mirror: &CellMirror,
    recalc: &mut RecalcResult,
    moved_cell_ids: &[CellId],
) {
    for cell_id in moved_cell_ids {
        let Some(sheet_id) = mirror.sheet_for_cell(cell_id) else {
            continue;
        };
        let Some(pos) = mirror.resolve_position(cell_id) else {
            continue;
        };
        let sheet_id_str = sheet_id.to_uuid_string();
        let value = stores
            .compute
            .get_cell_value(mirror, cell_id)
            .cloned()
            .or_else(|| mirror.get_cell_value(cell_id).cloned())
            .unwrap_or(CellValue::Null);
        let mut change = CellChange {
            cell_id: cell_id.to_uuid_string(),
            sheet_id: sheet_id_str,
            position: Some(CellPosition {
                row: pos.row(),
                col: pos.col(),
            }),
            value,
            display_text: None,
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        };
        if let Some(existing) = recalc.changed_cells.iter_mut().find(|existing| {
            existing.sheet_id == change.sheet_id
                && existing.position.as_ref().is_some_and(|existing_pos| {
                    existing_pos.row == pos.row() && existing_pos.col == pos.col()
                })
        }) {
            change.old_value = existing.old_value.take();
            *existing = change;
        } else {
            recalc.changed_cells.push(change);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn relocate_whole_tables(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
) -> Vec<TableChange> {
    let source_sheet_hex = source_sheet_id.to_uuid_string();
    let target_sheet_hex = target_sheet_id.to_uuid_string();
    let tables_to_move: Vec<_> = mirror
        .all_tables()
        .iter()
        .filter(|table| {
            table.sheet_id == source_sheet_hex
                && table.range.start_row() >= src_start_row
                && table.range.start_col() >= src_start_col
                && table.range.end_row() <= src_end_row
                && table.range.end_col() <= src_end_col
        })
        .cloned()
        .collect();

    let mut changes = Vec::with_capacity(tables_to_move.len());
    let mut moved_tables = Vec::with_capacity(tables_to_move.len());
    for mut table in tables_to_move {
        let row_offset = table.range.start_row().saturating_sub(src_start_row);
        let col_offset = table.range.start_col().saturating_sub(src_start_col);
        let table_row_span = table
            .range
            .end_row()
            .saturating_sub(table.range.start_row());
        let table_col_span = table
            .range
            .end_col()
            .saturating_sub(table.range.start_col());
        let target_start_row = target_row + row_offset;
        let target_start_col = target_col + col_offset;

        table.sheet_id = target_sheet_hex.clone();
        table.range = cell_types::SheetRange::new(
            target_start_row,
            target_start_col,
            target_start_row + table_row_span,
            target_start_col + table_col_span,
        );
        stores.compute.set_table(mirror, table.clone());
        moved_tables.push(table.clone());
        changes.push(TableChange {
            name: table.name,
            table_id: Some(table.id),
            sheet_id: target_sheet_hex.clone(),
            kind: ChangeKind::Set,
        });
    }

    if !moved_tables.is_empty() {
        let workbook = stores.storage.workbook_map().clone();
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
        for table in &moved_tables {
            super::super::super::tables::persist_table_to_yrs_in_txn(&workbook, &mut txn, table);
        }
    }

    changes
}
