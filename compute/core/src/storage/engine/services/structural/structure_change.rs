use std::collections::HashSet;

use cell_types::{CellId, SheetId};
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
use super::formula_writeback::{invalidate_stale_yrs_formulas, regenerate_named_range_yrs_refs};
use super::pre_delete_reanchor::pre_delete_re_anchor_range_refs;
use super::range_virtual_cells::{
    collect_virtual_cell_ids_for_deleted_cols, collect_virtual_cell_ids_for_deleted_rows,
    purge_virtual_cell_ids_from_yrs,
};

struct StructureChangePreflight {
    inherited_insert_row_height: Option<Points>,
}

// -------------------------------------------------------------------
// Structure Change (insert/delete rows/cols)
// -------------------------------------------------------------------

/// Apply a structural change (insert/delete rows/cols) to the Yrs document and indexes.
///
/// Performs:
/// 1. Validation (for deletes)
/// 2. StructuralOps dispatch (Yrs CRDT mutations + GridIndex + CellMirror updates)
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
    let doc = stores.storage.doc();
    let sheets_map = doc.get_or_insert_map("sheets");
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;

    // Pre-delete re-anchor pass: shrink any IdentityRangeRef whose endpoint
    // sits inside the doomed row/col band to the nearest surviving cell so
    // `SUM(A1:A5)` with row 0 deleted becomes `SUM(A1:A4)` instead of
    // `SUM(#REF!)`. Must run BEFORE the structural op tears down the affected
    // CellIds so their pre-delete positions can still be resolved.
    match change {
        StructureChange::DeleteRows { at, count, .. } => {
            pre_delete_re_anchor_range_refs(mirror, sheet_id, *at, *count, true);
        }
        StructureChange::DeleteCols { at, count, .. } => {
            pre_delete_re_anchor_range_refs(mirror, sheet_id, *at, *count, false);
        }
        _ => {}
    }

    // Collect virtual CellIds from Range views in the doomed band BEFORE
    // StructuralOps runs. StructuralOps::delete_rows/cols only removes
    // CellIds that GridIndex knows about, but virtual CellIds may exist
    // in the Yrs `cells` map without a GridIndex entry (e.g. eagerly
    // registered overrides for sub-256 Ranges). We remove these from Yrs
    // after StructuralOps completes.
    let virtual_cell_ids_to_purge: Vec<CellId> = match change {
        StructureChange::DeleteRows { at, count, .. } => {
            collect_virtual_cell_ids_for_deleted_rows(mirror, sheet_id, *at, *count)
        }
        StructureChange::DeleteCols { at, count, .. } => {
            collect_virtual_cell_ids_for_deleted_cols(mirror, sheet_id, *at, *count)
        }
        _ => Vec::new(),
    };

    match change {
        StructureChange::InsertRows { at, count, .. } => {
            StructuralOps::insert_rows(doc, &sheets_map, grid, mirror, sheet_id, *at, *count)?;
            if let Some(height) = preflight.inherited_insert_row_height {
                for row in *at..(*at + *count) {
                    dimensions::set_row_height(
                        doc,
                        &sheets_map,
                        sheet_id,
                        row,
                        height,
                        Some(grid),
                    )?;
                }
            }
        }
        StructureChange::DeleteRows { at, count, .. } => {
            StructuralOps::delete_rows(doc, &sheets_map, grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::InsertCols { at, count, .. } => {
            StructuralOps::insert_cols(doc, &sheets_map, grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::DeleteCols { at, count, .. } => {
            StructuralOps::delete_cols(doc, &sheets_map, grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::RemapPositions { updates } => {
            for &(cell_id, new_row, new_col) in updates {
                grid.remove_cell(&cell_id);
                grid.register_cell(cell_id, new_row, new_col);
            }
            let _ = mirror.apply_structure_change(sheet_id, change);
        }
    }

    // Purge virtual CellId overrides from the Yrs `cells` map.
    // StructuralOps already removed CellIds it found in GridIndex; this
    // catches any virtual CellIds that GridIndex did not track (defensive).
    // Removing a non-existent key from a Yrs map is a no-op, so duplicates
    // with the StructuralOps pass are harmless.
    if !virtual_cell_ids_to_purge.is_empty() {
        purge_virtual_cell_ids_from_yrs(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            &virtual_cell_ids_to_purge,
        );
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
    mirror.install_row_col_indexes(
        stores
            .grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );

    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        let layout = construction::build_layout_index_for_sheet(
            &stores.storage,
            sheet_id,
            grid.row_count(),
            grid.col_count(),
            Some(grid),
        );
        stores.layout_indexes.insert(*sheet_id, layout);
    }

    // Delegate to ComputeCore for formula reparsing and full recalc.
    // Note: ComputeCore.structure_change() regenerates A1 formula strings
    // from IdentityFormulas in memory (formula_strings cache), but does NOT
    // persist them to Yrs KEY_FORMULA. The get_cell_data() read path overlays
    // the authoritative formula_strings on top of Yrs data, so callers always
    // see the updated formulas without needing to write back to Yrs.
    let result = stores
        .compute
        .structure_change(mirror, Some((change, *sheet_id)))?;

    // Refresh stale KEY_FORMULA entries in Yrs for every formula cell whose
    // A1 text changed. Cross-sheet formulas can shift when a different sheet's
    // rows/columns change, so this scans the workbook's formula cells rather
    // than only the affected sheet.
    invalidate_stale_yrs_formulas(stores, mirror);

    // Regenerate named range A1 strings in Yrs.
    // CellIds in IdentityFormulas don't change on structural ops, but positions
    // shift — so the A1 display representation must be regenerated.
    regenerate_named_range_yrs_refs(stores, mirror);

    Ok(result)
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
            StructureChange::InsertRows { at, .. } => dimensions::get_row_height_explicit(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                *at,
                Some(grid),
            ),
            _ => None,
        }
    };

    // Deferred import/minimal init keeps formula text but postpones AST and
    // identity formula construction until the first mutation. Structural
    // changes must force that construction before positions are shifted or
    // deleted, otherwise references into the deleted band are reparsed against
    // the post-delete sheet and can silently bind to the shifted survivor.
    stores.compute.ensure_graph_built(mirror)?;

    Ok(StructureChangePreflight {
        inherited_insert_row_height,
    })
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

/// Merge structural viewport patches into a recalc result, deduplicating
/// positions that are already present in `changed_cells`.
pub(in crate::storage::engine) fn merge_viewport_patches_into_recalc(
    recalc: &mut RecalcResult,
    structural_patches: Vec<CellChange>,
) {
    if structural_patches.is_empty() {
        return;
    }
    // Dedupe by resolved position. Entries without a resolved position cannot
    // collide on coordinates, so they are always appended.
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
