use cell_types::{RangePos, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::snapshot::{ChangeKind, PivotTableChange, TableChange};
use crate::storage::engine::services::{metadata_shift, mutation};
use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::data_tables;

use super::patches::{merge_recalc_results, synthetic_null_change};

// ---------------------------------------------------------------------------
// mutation_relocate_cells
// ---------------------------------------------------------------------------

/// Relocate cells from source range to target position while updating native identities and metadata.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_relocate_cells(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
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
    if cell_store
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

    crate::storage::engine::history::relocate::capture_relocation(
        stores,
        cell_store,
        *source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
        *target_sheet_id,
        target_row,
        target_col,
    );
    for sid in [source_sheet_id, target_sheet_id] {
        if cell_store.get_sheet(sid).is_none() {
            return Err(ComputeError::SheetNotFound {
                sheet_id: sid.to_uuid_string(),
            });
        }
    }
    let result = cell_iter::relocate_cells(
        &mut stores.storage,
        *source_sheet_id,
        &source_range,
        *target_sheet_id,
        target_row,
        target_col,
        cell_store,
    );

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
        cell_store,
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
    // (apply_relocate_cells) to re-materialize and rebuild the sheet
    // viewport so the old rendered region is cleared and the new one drawn.
    let source_sheet_hex = source_sheet_id.to_uuid_string();
    let pivot_changes: Vec<PivotTableChange> = metadata_shift::relocate_pivot_ranges(
        stores,
        cell_store,
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

    // Clear displaced cells while their old positions are still available to recalc.
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    let clear_recalc = if result.target_cells_cleared.is_empty() {
        RecalcResult::empty()
    } else {
        stores
            .compute
            .clear_cells(cell_store, &result.target_cells_cleared)?
    };
    for id in &result.target_cells_cleared {
        cell_store.remove_cell(id);
    }
    let moves: Vec<_> = result
        .moved_cell_ids
        .iter()
        .zip(&result.source_positions_vacated)
        .map(|(&id, &(row, col))| {
            (
                id,
                *target_sheet_id,
                SheetPos::new(
                    target_row + row - src_start_row,
                    target_col + col - src_start_col,
                ),
            )
        })
        .collect();
    cell_store.move_cells(&moves);
    super::super::super::cell_editing::sync_grid_axes(stores, cell_store);
    let moved_cell_ids = result.moved_cell_ids.clone();
    let moved_validation_edits: Vec<_> = moves
        .iter()
        .filter_map(|(id, sid, pos)| {
            cell_store
                .get_cell_value_raw(id)
                .cloned()
                .map(|value| (*sid, *id, pos.row(), pos.col(), value, None))
        })
        .collect();

    if !moved_validation_edits.is_empty() {
        stores
            .compute
            .validate_raw_user_edit_region_writes(cell_store, &moved_validation_edits)?;
    }

    let region_mutation = if result.moved_cell_ids.is_empty() {
        data_tables::DataTableRegionMutation::default()
    } else {
        data_tables::relocate_regions(
            cell_store,
            source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id,
            target_row,
            target_col,
        )
    };
    for (cell_id, sheet_id, _) in &moves {
        let array_ref = stores
            .storage
            .cell_metadata(cell_id)
            .and_then(|metadata| metadata.array_ref.as_deref());
        mutation::reconcile_persisted_array_ref(cell_store, sheet_id, cell_id, array_ref);
    }
    let stale_table_recalc = reconcile_data_table_cells(stores, cell_store, &region_mutation)?;

    let mut recalc = if moved_cell_ids.is_empty() {
        clear_recalc
    } else {
        // Recalculate moved cells from their CellIds. Replaying formula text
        // through set_cells_raw reparses stale A1 strings after structural
        // shifts and can drop identity references that were already correct.
        stores
            .compute
            .regenerate_formula_strings_and_cell_formula_text(cell_store);
        let mut moved_recalc = stores.compute.recalc(cell_store, &moved_cell_ids)?;
        super::super::super::cell_editing::append_position_changes(
            stores,
            cell_store,
            &mut moved_recalc,
            moves
                .iter()
                .map(|(_, sheet, pos)| (*sheet, pos.row(), pos.col())),
        );
        merge_recalc_results(&mut moved_recalc, clear_recalc);
        moved_recalc
    };

    merge_recalc_results(&mut recalc, stale_table_recalc);
    // Report source positions that became empty, including overlap handling.
    for &(row, col) in &result.source_positions_vacated {
        if cell_store
            .resolve_cell_id(source_sheet_id, SheetPos::new(row, col))
            .is_none()
        {
            recalc
                .changed_cells
                .push(synthetic_null_change(source_sheet_id, row, col));
        }
    }

    stores
        .compute
        .regenerate_formula_strings_and_cell_formula_text(cell_store);

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

    crate::storage::sheet::comments::relocate_anchors(
        &mut stores.storage,
        cell_store,
        source_sheet_id,
        target_sheet_id,
    );
    Ok((recalc, relocate_result, table_changes, pivot_changes))
}

#[allow(clippy::too_many_arguments)]
fn relocate_whole_tables(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
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
    let tables_to_move: Vec<_> = cell_store
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
        stores.compute.set_table(cell_store, table.clone());
        changes.push(TableChange {
            name: table.name,
            table_id: Some(table.id),
            sheet_id: target_sheet_hex.clone(),
            kind: ChangeKind::Set,
        });
    }

    changes
}

/// Remove orphan TABLE dependencies and preserve their current cached values.
pub(super) fn reconcile_data_table_cells(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    mutation: &data_tables::DataTableRegionMutation,
) -> Result<RecalcResult, ComputeError> {
    let mut edits = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (sheet, sr, sc, er, ec) in &mutation.formula_ranges {
        let ids: Vec<_> = cell_store
            .cells_in_range(sheet, *sr, *sc, *er, *ec)
            .map(|(id, _, _)| id)
            .collect();
        for id in &ids {
            if let Some(pos) = cell_store.resolve_position(id) {
                crate::storage::engine::history::cells::capture_cell(
                    stores,
                    cell_store,
                    *sheet,
                    *id,
                    pos.row(),
                    pos.col(),
                );
            }
        }
        for id in
            data_tables::clear_table_formula_cells(&mut stores.storage, cell_store, sheet, &ids)
        {
            if !seen.insert(id) {
                continue;
            }
            if let Some(pos) = cell_store.resolve_position(&id) {
                let value = cell_store
                    .get_cell_value_raw(&id)
                    .cloned()
                    .unwrap_or(CellValue::Null);
                edits.push((*sheet, id, pos.row(), pos.col(), value, None));
            }
        }
    }
    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    stores.compute.set_cells_raw_with_trust(
        cell_store,
        &edits,
        true,
        crate::scheduler::WriteTrust::TrustedReplay,
    )
}
