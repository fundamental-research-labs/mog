use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use domain_types::units::Points;
use formula_types::StructureChange;
use value_types::ComputeError;

use crate::cells::CellStore;
use crate::snapshot::{RecalcResult, StructureChangeResult, StructureChangeType};
use crate::storage::engine::stores::EngineStores;
use crate::storage::engine::validation;
use crate::storage::sheet::dimensions;
use crate::storage::sheet::structural::StructuralOps;

use super::super::metadata_shift;
use super::super::mutation::{rebuild_merge_index, sync_store_merge_regions};
use super::pre_delete_reanchor::pre_delete_re_anchor_range_refs;

struct StructureChangePreflight {
    inherited_insert_row_height: Option<Points>,
}

// -------------------------------------------------------------------
// Structure Change (insert/delete rows/cols)
// -------------------------------------------------------------------

/// Apply a structural change to native axes, cells, and metadata.
///
/// Performs:
/// 1. Validation (for deletes)
/// 2. Shared GridIndex and CellStore axis mutation
/// 3. Resolved merge rectangle refresh
/// 4. ComputeCore formula reparsing and full recalc
///
/// The caller enriches the returned changes with display and validation data.
pub(in crate::storage::engine) fn apply_structure_change(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    change: &StructureChange,
) -> Result<RecalcResult, ComputeError> {
    let preflight = preflight_structure_change(stores, cell_store, sheet_id, change)?;
    crate::storage::engine::history::structure::capture_structure(
        stores, cell_store, *sheet_id, change,
    );
    ensure_insert_axis_capacity(stores, sheet_id, change)?;
    if stores.grid_indexes.contains_key(sheet_id) {
        let deletion = match change {
            StructureChange::DeleteRows { at, count, .. } => Some((*at, *count, true)),
            StructureChange::DeleteCols { at, count, .. } => Some((*at, *count, false)),
            _ => None,
        };
        if let Some((at, count, rows)) = deletion {
            crate::storage::sheet::merges::reanchor_before_delete(
                &mut stores.storage,
                *sheet_id,
                cell_store,
                at,
                count,
                rows,
            );
            crate::storage::sheet::hyperlinks::reanchor_before_delete(
                &mut stores.storage,
                *sheet_id,
                cell_store,
                at,
                count,
                rows,
            );
        }
    }
    let deleted_metadata_ids: Vec<_> = stores
        .storage
        .cell_metadata
        .keys()
        .copied()
        .filter(|id| {
            let pos = cell_store
                .get_sheet(sheet_id)
                .and_then(|sheet| sheet.position_of(id));
            pos.is_some_and(|pos| match change {
                StructureChange::DeleteRows { at, count, .. } => {
                    pos.row() >= *at && pos.row() < at.saturating_add(*count)
                }
                StructureChange::DeleteCols { at, count, .. } => {
                    pos.col() >= *at && pos.col() < at.saturating_add(*count)
                }
                _ => false,
            })
        })
        .collect();
    // Pre-delete re-anchor pass: shrink any IdentityRangeRef whose endpoint
    // sits inside the doomed row/col band to the nearest surviving cell so
    // `SUM(A1:A5)` with row 0 deleted becomes `SUM(A1:A4)` instead of
    // `SUM(#REF!)`. Must run BEFORE the structural op tears down the affected
    // CellIds so their pre-delete positions can still be resolved.
    let reanchored_formula_cells = match change {
        StructureChange::DeleteRows { at, count, .. } => {
            pre_delete_re_anchor_range_refs(stores, cell_store, sheet_id, *at, *count, true)
        }
        StructureChange::DeleteCols { at, count, .. } => {
            pre_delete_re_anchor_range_refs(stores, cell_store, sheet_id, *at, *count, false)
        }
        _ => Vec::new(),
    };

    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;

    match change {
        StructureChange::InsertRows { at, count, .. } => {
            StructuralOps::insert_rows(grid, cell_store, sheet_id, *at, *count)?;
            if let Some(height) = preflight.inherited_insert_row_height {
                for row in *at..(*at + *count) {
                    dimensions::set_row_height(
                        &mut stores.storage,
                        sheet_id,
                        row,
                        height,
                        Some(grid),
                    )?;
                }
            }
        }
        StructureChange::DeleteRows { at, count, .. } => {
            StructuralOps::delete_rows(grid, cell_store, sheet_id, *at, *count)?;
        }
        StructureChange::InsertCols { at, count, .. } => {
            StructuralOps::insert_cols(grid, cell_store, sheet_id, *at, *count)?;
        }
        StructureChange::DeleteCols { at, count, .. } => {
            StructuralOps::delete_cols(grid, cell_store, sheet_id, *at, *count)?;
        }
        StructureChange::RemapPositions { updates } => {
            for &(_, new_row, new_col) in updates {
                grid.ensure_capacity(new_row, new_col);
            }
            let _ = cell_store.apply_structure_change_with_axes(
                sheet_id,
                change,
                Some((grid.row_axis(), grid.col_axis())),
            );
        }
    }

    // Keep the durable imported-array sidecar aligned with the cell store's
    // identity-rebased positions before recalculation begins. Otherwise an
    // eager rebuild after this operation can reinstall the pre-edit cache
    // coordinates (and stale values) over the moved projection.
    if let Some(sheet) = cell_store.get_sheet(sheet_id) {
        let caches = sheet.imported_array_caches().to_vec();
        if caches.is_empty() {
            stores.storage.imported_array_caches.remove(sheet_id);
        } else {
            stores
                .storage
                .imported_array_caches
                .insert(*sheet_id, caches);
        }
    }

    crate::storage::sheet::floating_objects::sync_after_structure(
        &mut stores.storage,
        grid,
        cell_store,
        *sheet_id,
        change,
    );

    for id in deleted_metadata_ids {
        stores.storage.clear_cell_metadata(id);
    }
    crate::storage::engine::history::metadata::capture_pruned_axis_metadata(
        &stores.storage,
        *sheet_id,
        grid,
    );
    if let Some(cells) = cell_store.get_sheet(sheet_id) {
        crate::storage::engine::history::metadata::capture_pruned_cell_metadata(
            &stores.storage,
            *sheet_id,
            |id| cells.position_of(&id).is_none(),
        );
    }
    if let Some(metadata) = stores.storage.sheet_metadata.get_mut(sheet_id) {
        metadata.dimensions.retain_axes(grid);
        metadata
            .column_schemas
            .retain(|id, _| grid.col_index(id).is_some());
        if matches!(
            change,
            StructureChange::DeleteRows { .. } | StructureChange::DeleteCols { .. }
        ) {
            metadata.comments.retain(|comment| {
                comment.cell_ref.cell().is_none_or(|id| {
                    cell_store
                        .get_sheet(sheet_id)
                        .is_some_and(|sheet| sheet.position_of(&id).is_some())
                })
            });
            for (id, record) in &mut metadata.cell_annotations {
                if cell_store
                    .get_sheet(sheet_id)
                    .is_none_or(|sheet| sheet.position_of(id).is_none())
                {
                    record.status = crate::engine_types::AnnotationStatus::Stale;
                    record.stale_reason = Some("anchorMissing".into());
                    record.checked_at = None;
                }
            }
        }
    }

    // Shift all position-based metadata ranges (CF, tables, validations, etc.)
    metadata_shift::shift_all_metadata_ranges(stores, cell_store, sheet_id, change);

    // Rebuild merge list (structural changes shift merge positions)
    // and sync into CellStore so spill detection sees current merges.
    rebuild_merge_index(stores, cell_store, sheet_id);
    sync_store_merge_regions(stores, cell_store, sheet_id);

    // Refresh shared axes and explicit/run ownership after the structural edit.
    cell_store.install_native_axes(
        stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );

    stores.invalidate_pixel_layout(sheet_id);

    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );

    // Refresh canonical A1 formula text from stable identities and recalculate.
    let result = stores.compute.structure_change_with_formula_refresh(
        cell_store,
        Some((change, *sheet_id)),
        &reanchored_formula_cells,
    )?;

    Ok(result)
}

fn ensure_insert_axis_capacity(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    change: &StructureChange,
) -> Result<(), ComputeError> {
    match change {
        StructureChange::InsertRows { at, .. } => {
            ensure_row_capacity_before_insert(stores, sheet_id, at.checked_sub(1))
        }
        StructureChange::InsertCols { at, .. } => {
            ensure_col_capacity_before_insert(stores, sheet_id, at.checked_sub(1))
        }
        _ => Ok(()),
    }
}

fn ensure_row_capacity_before_insert(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    preceding_row: Option<u32>,
) -> Result<(), ComputeError> {
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    if let Some(row) = preceding_row {
        grid.ensure_row_capacity(row.min(cell_types::MAX_ROWS - 1));
    }
    Ok(())
}

fn ensure_col_capacity_before_insert(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    preceding_col: Option<u32>,
) -> Result<(), ComputeError> {
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    if let Some(col) = preceding_col {
        grid.ensure_col_capacity(col.min(cell_types::MAX_COLS - 1));
    }
    Ok(())
}

fn preflight_structure_change(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    change: &StructureChange,
) -> Result<StructureChangePreflight, ComputeError> {
    let inherited_insert_row_height = {
        let grid = grid_index(stores, sheet_id)?;

        match change {
            StructureChange::DeleteRows { at, count, .. } => {
                validation::structure::validate_delete_bounds(*at, *count, grid.row_count())?;
            }
            StructureChange::DeleteCols { at, count, .. } => {
                validation::structure::validate_delete_bounds(*at, *count, grid.col_count())?;
            }
            _ => {}
        }

        match change {
            StructureChange::InsertRows { at, .. } => {
                dimensions::get_row_height_explicit(&stores.storage, sheet_id, *at, Some(grid))
            }
            _ => None,
        }
    };

    // Deferred import/minimal init keeps formula text but postpones AST and
    // identity formula construction until the first mutation. Structural
    // changes must force that construction before positions are shifted or
    // deleted, otherwise references into the deleted band are reparsed against
    // the post-delete sheet and can silently bind to the shifted survivor.
    stores.compute.ensure_graph_built(cell_store)?;
    hydrate_stored_formula_identities_for_structure_change(stores, cell_store)?;

    Ok(StructureChangePreflight {
        inherited_insert_row_height,
    })
}

fn hydrate_stored_formula_identities_for_structure_change(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
) -> Result<(), ComputeError> {
    // Deferred formula text belongs to the scheduler. Once resolved, the native
    // identity formula is authoritative and retains references across moves.
    let mut pending = Vec::new();
    for sheet_id in cell_store.sheet_ids() {
        if cell_store.get_sheet(sheet_id).is_none() {
            continue;
        }
        for cell_id in cell_store.sheet_cell_ids(sheet_id) {
            if cell_store.get_formula(&cell_id).is_none()
                && let Some(formula) = stores.compute.get_formula(&cell_id)
            {
                pending.push((*sheet_id, cell_id, formula.to_owned()));
            }
        }
    }
    for (sheet_id, cell_id, formula) in pending {
        if let Ok(identity) = stores
            .compute
            .to_identity_formula(cell_store, &sheet_id, &formula)
        {
            cell_store.set_formula(&cell_id, Some(identity));
        }
    }
    Ok(())
}

fn grid_index<'a>(
    stores: &'a EngineStores,
    sheet_id: &SheetId,
) -> Result<&'a GridIndex, ComputeError> {
    stores
        .grid_indexes
        .get(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })
}

/// Build a `StructureChangeResult` from a `StructureChange`.
/// Returns `None` for `RemapPositions` (no result emitted).
pub(in crate::storage::engine) fn build_structure_change_result(
    sheet_id: &SheetId,
    change: &StructureChange,
) -> Option<StructureChangeResult> {
    let sheet_id_hex: String = id_to_hex(sheet_id.as_u128()).into();
    match change {
        StructureChange::InsertRows { at, count, .. } => Some(StructureChangeResult {
            sheet_id: sheet_id_hex,
            change_type: StructureChangeType::InsertRows,
            at: *at,
            count: *count,
        }),
        StructureChange::DeleteRows { at, count, .. } => Some(StructureChangeResult {
            sheet_id: sheet_id_hex,
            change_type: StructureChangeType::DeleteRows,
            at: *at,
            count: *count,
        }),
        StructureChange::InsertCols { at, count, .. } => Some(StructureChangeResult {
            sheet_id: sheet_id_hex,
            change_type: StructureChangeType::InsertCols,
            at: *at,
            count: *count,
        }),
        StructureChange::DeleteCols { at, count, .. } => Some(StructureChangeResult {
            sheet_id: sheet_id_hex,
            change_type: StructureChangeType::DeleteCols,
            at: *at,
            count: *count,
        }),
        StructureChange::RemapPositions { .. } => None,
    }
}
