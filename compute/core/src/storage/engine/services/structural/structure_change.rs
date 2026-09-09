use std::collections::HashSet;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use domain_types::units::Points;
use formula_types::StructureChange;
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::snapshot::{CellChange, RecalcResult, StructureChangeResult, StructureChangeType};
use crate::storage::engine::construction;
use crate::storage::engine::stores::EngineStores;
use crate::storage::engine::validation;
use crate::storage::sheet::dimensions;
use crate::storage::sheet::structural::StructuralOps;

use super::super::metadata_shift;
use super::super::mutation::{rebuild_merge_index, sync_mirror_merge_regions};
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
/// 2. Shared GridIndex and CellMirror axis mutation
/// 3. Merge spatial index rebuild
/// 4. ComputeCore formula reparsing and full recalc
///
/// The caller is responsible for observer suppression (RAII guard) and viewport
/// patch production after this returns.
pub(in crate::storage::engine) fn apply_structure_change(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    change: &StructureChange,
) -> Result<RecalcResult, ComputeError> {
    let preflight = preflight_structure_change(stores, mirror, sheet_id, change)?;
    crate::storage::engine::history::structure::capture_structure(
        stores, mirror, *sheet_id, change,
    );
    ensure_insert_axis_capacity(stores, sheet_id, change)?;
    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        let deletion = match change {
            StructureChange::DeleteRows { at, count, .. } => Some((*at, *count, true)),
            StructureChange::DeleteCols { at, count, .. } => Some((*at, *count, false)),
            _ => None,
        };
        if let Some((at, count, rows)) = deletion {
            crate::storage::sheet::merges::reanchor_before_delete(
                &mut stores.storage,
                *sheet_id,
                grid,
                mirror,
                at,
                count,
                rows,
            );
            crate::storage::sheet::hyperlinks::reanchor_before_delete(
                &mut stores.storage,
                *sheet_id,
                grid,
                mirror,
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
            let pos = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|grid| grid.cell_position(id))
                .map(|(row, col)| cell_types::SheetPos::new(row, col))
                .or_else(|| {
                    mirror
                        .get_sheet(sheet_id)
                        .and_then(|sheet| sheet.position_of(id))
                });
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
            pre_delete_re_anchor_range_refs(stores, mirror, sheet_id, *at, *count, true)
        }
        StructureChange::DeleteCols { at, count, .. } => {
            pre_delete_re_anchor_range_refs(stores, mirror, sheet_id, *at, *count, false)
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
            StructuralOps::insert_rows(grid, mirror, sheet_id, *at, *count)?;
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
            StructuralOps::delete_rows(grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::InsertCols { at, count, .. } => {
            StructuralOps::insert_cols(grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::DeleteCols { at, count, .. } => {
            StructuralOps::delete_cols(grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::RemapPositions { updates } => {
            for &(cell_id, new_row, new_col) in updates {
                grid.remove_cell(&cell_id);
                grid.register_cell(cell_id, new_row, new_col);
            }
            let _ = mirror.apply_structure_change(sheet_id, change);
        }
    }

    crate::storage::sheet::floating_objects::sync_after_structure(
        &mut stores.storage,
        grid,
        mirror,
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
                comment
                    .cell_ref
                    .cell()
                    .is_none_or(|id| grid.cell_position(&id).is_some())
            });
            for (id, record) in &mut metadata.cell_annotations {
                if grid.cell_position(id).is_none() {
                    record.status = crate::engine_types::AnnotationStatus::Stale;
                    record.stale_reason = Some("anchorMissing".into());
                    record.checked_at = None;
                }
            }
        }
    }

    // Shift all position-based metadata ranges (CF, tables, validations, etc.)
    metadata_shift::shift_all_metadata_ranges(stores, mirror, sheet_id, change);

    // Rebuild merge spatial index (structural changes shift merge positions)
    // and sync into CellMirror so spill detection sees current merges.
    rebuild_merge_index(stores, sheet_id);
    sync_mirror_merge_regions(stores, mirror, sheet_id);

    // unified reference model — the mirror's `RowId/ColId → (SheetId, index)` maps were
    // seeded at engine assembly. A row/col insert, delete, or remap shifts
    // those indices, so re-sync from the authoritative `GridIndex` set.
    mirror.install_native_axes(
        stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_axis(), grid.col_axis())),
    );

    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        let layout = construction::build_layout_index_for_sheet(
            &stores.storage,
            sheet_id,
            grid.row_count(),
            grid.col_count(),
            Some(grid),
            stores.layout_metrics,
        );
        stores.layout_indexes.insert(*sheet_id, layout);
    }

    // Refresh canonical A1 formula text from stable identities and recalculate.
    let result = stores.compute.structure_change_with_formula_refresh(
        mirror,
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
    mirror: &mut CellMirror,
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
    stores.compute.ensure_graph_built(mirror)?;
    hydrate_stored_formula_identities_for_structure_change(stores, mirror)?;

    Ok(StructureChangePreflight {
        inherited_insert_row_height,
    })
}

fn hydrate_stored_formula_identities_for_structure_change(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
) -> Result<(), ComputeError> {
    // Deferred formula text belongs to the scheduler. Once resolved, the native
    // identity formula is authoritative and retains references across moves.
    let mut pending = Vec::new();
    for sheet_id in mirror.sheet_ids() {
        let Some(sheet) = mirror.get_sheet(sheet_id) else {
            continue;
        };
        for (cell_id, entry) in sheet.cells_iter() {
            if entry.formula.is_none()
                && let Some(formula) = stores.compute.get_formula(cell_id)
            {
                pending.push((*sheet_id, *cell_id, formula.to_owned()));
            }
        }
    }
    for (sheet_id, cell_id, formula) in pending {
        if let Ok(identity) = stores
            .compute
            .to_identity_formula(mirror, &sheet_id, &formula)
        {
            mirror.set_formula(&cell_id, Some(identity));
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

/// Merge shifted-cell viewport patches into a recalc result, deduplicating
/// positions that are already present in `changed_cells`.
pub(in crate::storage::engine) fn merge_viewport_patches_into_recalc(
    recalc: &mut RecalcResult,
    structural_patches: Vec<CellChange>,
) {
    if structural_patches.is_empty() {
        return;
    }
    let existing: HashSet<(u32, u32)> = recalc
        .changed_cells
        .iter()
        .filter_map(|c| c.position.as_ref().map(|p| (p.row, p.col)))
        .collect();
    for patch in structural_patches {
        match patch.position.as_ref() {
            Some(pos) if existing.contains(&(pos.row, pos.col)) => {}
            _ => recalc.changed_cells.push(patch),
        }
    }
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
