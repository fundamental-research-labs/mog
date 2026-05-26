//! Structural operation helpers extracted as free functions.
//!
//! Read-only queries take `&EngineStores`. Mutations take `&mut EngineStores`
//! and optionally `&mut CellMirror`. Bridge methods on `YrsComputeEngine`
//! delegate to these with one-line calls.

use std::collections::HashSet;

use cell_types::{CellId, ColId, RowId, SheetId, SheetPos};
use compute_document::hex::{SmallHex, hex_to_id, id_to_hex};
use formula_types::StructureChange;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::{
    CellChange, ChangeKind, FloatingObjectChange, FloatingObjectChangeKind, MergeChange,
    MutationResult, RecalcResult, StructureChangeResult, StructureChangeType, VisibilityChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::engine::validation;
use crate::storage::infra::cell_iter;
use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;
use crate::storage::sheet::structural::StructuralOps;
use crate::storage::workbook::named_ranges;
use domain_types::domain::named_range::DefinedName;
use domain_types::units::{CharWidth, Pixels};

use crate::storage::sheet::{dimensions, floating_objects, merges};

use super::metadata_shift;

use super::mutation::{rebuild_merge_index, sync_mirror_merge_regions};

// -------------------------------------------------------------------
// Merge Queries (read-only)
// -------------------------------------------------------------------

/// Check whether merging a range would cause data loss.
pub(in crate::storage::engine) fn check_merge_data_loss(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> (bool, u32) {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return (false, 0);
    };
    merges::check_merge_data_loss(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        start_row,
        start_col,
        end_row,
        end_col,
    )
}

/// Check if the cell at (row, col) is the origin of a merge.
pub(in crate::storage::engine) fn is_merge_origin(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return false;
    };
    merges::is_merge_origin(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    )
}

// -------------------------------------------------------------------
// Merge Mutations (self-contained)
// -------------------------------------------------------------------

/// Clear all merged regions for a sheet.
pub(in crate::storage::engine) fn clear_all_merges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    merges::clear_all_merges(stores.storage.doc(), stores.storage.sheets(), *sheet_id);
    Ok(MutationResult::empty())
}

/// Validate merges and remove any whose CellIds can no longer be resolved.
/// Returns a `MutationResult` with the removed count in `data`.
pub(in crate::storage::engine) fn validate_and_clean_merges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let removed_count = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::validate_and_clean_merges(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
        ),
        None => 0,
    };
    Ok(MutationResult::empty().with_data(&removed_count)?)
}

/// Merge a range of cells.
pub(in crate::storage::engine) fn merge_range(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
        return Err(ComputeError::SheetNotFound {
            sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
        });
    };
    let region = merges::merge_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        start_row,
        start_col,
        end_row,
        end_col,
    )?;
    rebuild_merge_index(stores, sheet_id);
    let mut result = MutationResult::empty();
    if region.is_some() {
        result.merge_changes.push(MergeChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            kind: ChangeKind::Set,
            start_row,
            start_col,
            end_row,
            end_col,
        });
    }
    Ok(result)
}

/// Unmerge a range.
pub(in crate::storage::engine) fn unmerge_range(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        merges::unmerge_range(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        );
    }
    rebuild_merge_index(stores, sheet_id);
    let mut result = MutationResult::empty();
    result.merge_changes.push(MergeChange {
        sheet_id: id_to_hex(sheet_id.as_u128()).into(),
        kind: ChangeKind::Removed,
        start_row,
        start_col,
        end_row,
        end_col,
    });
    Ok(result)
}

/// Merge across: creates one merge per row in the range.
pub(in crate::storage::engine) fn merge_across(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let regions = match stores.grid_indexes.get_mut(sheet_id) {
        Some(grid) => merges::merge_across(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        ),
        None => Vec::new(),
    };
    rebuild_merge_index(stores, sheet_id);
    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let mut result = MutationResult::empty();
    for (i, _region) in regions.iter().enumerate() {
        let row = start_row + i as u32;
        result.merge_changes.push(MergeChange {
            sheet_id: sheet_id_str.clone(),
            kind: ChangeKind::Set,
            start_row: row,
            start_col,
            end_row: row,
            end_col,
        });
    }
    Ok(result.with_data(&regions)?)
}

/// Merge and center: unmerge overlapping, then create a single merge.
pub(in crate::storage::engine) fn merge_and_center(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let region = match stores.grid_indexes.get_mut(sheet_id) {
        Some(grid) => merges::merge_and_center(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        )?,
        None => None,
    };
    rebuild_merge_index(stores, sheet_id);
    let mut result = MutationResult::empty();
    if region.is_some() {
        result.merge_changes.push(MergeChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            kind: ChangeKind::Set,
            start_row,
            start_col,
            end_row,
            end_col,
        });
    }
    Ok(result.with_data(&region)?)
}

// -------------------------------------------------------------------
// Cell Identity and Position Mutations
// -------------------------------------------------------------------

/// Get or create a CellId at a position in the Yrs document.
pub(in crate::storage::engine) fn get_or_create_cell_id(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    let grid = stores
        .grid_indexes
        .get_mut(sheet_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("No GridIndex for sheet {:?}", sheet_id),
        })?;

    let cell_id = cell_iter::get_or_create_cell_id(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    );

    let cell_id_hex = id_to_hex(cell_id.as_u128());
    Ok(MutationResult::empty().with_data(&cell_id_hex)?)
}

/// Update a cell's position via the in-memory GridIndex (sole authority for
/// `(sheet, row, col) ↔ CellId`).
pub(in crate::storage::engine) fn update_cell_position(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_id_hex: &str,
    new_row: u32,
    new_col: u32,
) -> Result<MutationResult, ComputeError> {
    let id_u128 = hex_to_id(cell_id_hex).ok_or_else(|| ComputeError::Eval {
        message: format!("Invalid cell ID hex: {}", cell_id_hex),
    })?;
    let cell_id = CellId::from_raw(id_u128);

    let grid = stores
        .grid_indexes
        .get_mut(sheet_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("No GridIndex for sheet {:?}", sheet_id),
        })?;
    // Ensure the cell is known at some position before moving.
    grid.cell_position(&cell_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Cell {:?} not found in GridIndex", cell_id),
        })?;

    cell_iter::update_cell_position(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        cell_id,
        new_row,
        new_col,
    );

    let (value, _formula, identity_formula) = stores
        .storage
        .read_cell_from_yrs(sheet_id, &cell_id)
        .unwrap_or((CellValue::Null, None, None));

    mirror.apply_edit(
        sheet_id,
        cell_id,
        SheetPos::new(new_row, new_col),
        value,
        identity_formula,
    );

    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Dimension Operations (self-contained core logic)
// -------------------------------------------------------------------

/// Set row height.
///
/// `height_px` is in pixels (from the UI). Converted to points for Yrs storage;
/// LayoutIndex is updated directly in pixels.
pub(in crate::storage::engine) fn set_row_height(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    height_px: Pixels,
) -> Result<MutationResult, ComputeError> {
    // Store canonical units (points) in Yrs
    let height_pt = domain_types::units::pixels_to_points(height_px);
    dimensions::set_row_height(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        height_pt,
        stores.grid_indexes.get(sheet_id),
    )?;
    // LayoutIndex stays in pixels
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        li.set_row_height(row as usize, height_px);
    }
    let mut result = MutationResult::empty();
    result
        .dimension_changes
        .push(crate::snapshot::DimensionChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            axis: crate::snapshot::Axis::Row,
            index: row,
            kind: ChangeKind::Set,
            size: Some(value_types::FiniteF64::must(height_px.0)),
        });
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Set column width.
///
/// `width_px` is in pixels (from the UI). Converted to char-width for Yrs storage;
/// LayoutIndex is updated directly in pixels.
pub(in crate::storage::engine) fn set_col_width(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
    width_px: Pixels,
) -> Result<MutationResult, ComputeError> {
    // Store canonical units (char-width) in Yrs
    let mdw = domain_types::units::platform_mdw();
    let width_cw = domain_types::units::pixels_to_char_width(width_px, mdw);
    dimensions::set_col_width(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
        width_cw,
        stores.grid_indexes.get(sheet_id),
    )?;
    // LayoutIndex stays in pixels
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        li.set_col_width(col as usize, width_px);
    }
    let mut result = MutationResult::empty();
    result
        .dimension_changes
        .push(crate::snapshot::DimensionChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            axis: crate::snapshot::Axis::Col,
            index: col,
            kind: ChangeKind::Set,
            size: Some(value_types::FiniteF64::must(width_px.0)),
        });
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Set multiple column widths from pixel units in a single mutation result.
///
/// Widths are stored canonically as char-width in Yrs while LayoutIndex is kept
/// in pixels. Floating-object bounds are recomputed once after all dimensions
/// are applied.
pub(in crate::storage::engine) fn set_col_widths(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    widths: &[(u32, Pixels)],
) -> Result<MutationResult, ComputeError> {
    let mdw = domain_types::units::platform_mdw();
    let mut result = MutationResult::empty();

    for (col, width_px) in widths {
        let width_cw = domain_types::units::pixels_to_char_width(*width_px, mdw);
        dimensions::set_col_width(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            *col,
            width_cw,
            stores.grid_indexes.get(sheet_id),
        )?;
        if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
            li.set_col_width(*col as usize, *width_px);
        }
        result
            .dimension_changes
            .push(crate::snapshot::DimensionChange {
                sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                axis: crate::snapshot::Axis::Col,
                index: *col,
                kind: ChangeKind::Set,
                size: Some(value_types::FiniteF64::must(width_px.0)),
            });
    }

    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Set column width from character-width units (OOXML-native).
pub(in crate::storage::engine) fn set_col_width_chars(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
    width_cw: CharWidth,
) -> Result<MutationResult, ComputeError> {
    dimensions::set_col_width(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
        width_cw,
        stores.grid_indexes.get(sheet_id),
    )?;
    // LayoutIndex stays in pixels
    let mdw = domain_types::units::platform_mdw();
    let width_px = domain_types::units::char_width_to_pixels(width_cw, mdw);
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        li.set_col_width(col as usize, width_px);
    }
    let mut result = MutationResult::empty();
    result
        .dimension_changes
        .push(crate::snapshot::DimensionChange {
            sheet_id: id_to_hex(sheet_id.as_u128()).into(),
            axis: crate::snapshot::Axis::Col,
            index: col,
            kind: ChangeKind::Set,
            size: Some(value_types::FiniteF64::must(width_px.0)),
        });
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Set multiple column widths from OOXML character-width units.
pub(in crate::storage::engine) fn set_col_widths_chars(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    widths: &[(u32, CharWidth)],
) -> Result<MutationResult, ComputeError> {
    let mdw = domain_types::units::platform_mdw();
    let mut result = MutationResult::empty();

    for (col, width_cw) in widths {
        dimensions::set_col_width(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            *col,
            *width_cw,
            stores.grid_indexes.get(sheet_id),
        )?;
        let width_px = domain_types::units::char_width_to_pixels(*width_cw, mdw);
        if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
            li.set_col_width(*col as usize, width_px);
        }
        result
            .dimension_changes
            .push(crate::snapshot::DimensionChange {
                sheet_id: id_to_hex(sheet_id.as_u128()).into(),
                axis: crate::snapshot::Axis::Col,
                index: *col,
                kind: ChangeKind::Set,
                size: Some(value_types::FiniteF64::must(width_px.0)),
            });
    }

    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Hide rows.
pub(in crate::storage::engine) fn hide_rows(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rows: &[u32],
) -> Result<MutationResult, ComputeError> {
    dimensions::hide_manual_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        rows,
        stores.grid_indexes.get(sheet_id),
    );
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        for &r in rows {
            li.hide_row(r as usize);
        }
    }
    let mut result = MutationResult::empty();
    let sid: String = id_to_hex(sheet_id.as_u128()).into();
    for &r in rows {
        result.visibility_changes.push(VisibilityChange {
            sheet_id: sid.clone(),
            axis: crate::snapshot::Axis::Row,
            index: r,
            hidden: true,
        });
    }
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Unhide rows.
pub(in crate::storage::engine) fn unhide_rows(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rows: &[u32],
) -> Result<MutationResult, ComputeError> {
    let transitions = dimensions::unhide_manual_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        rows,
        stores.grid_indexes.get(sheet_id),
    );
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        for &(row, hidden) in &transitions {
            if hidden {
                li.hide_row(row as usize);
            } else {
                li.unhide_row(row as usize);
            }
        }
    }
    let mut result = MutationResult::empty();
    let sid: String = id_to_hex(sheet_id.as_u128()).into();
    for &(row, hidden) in &transitions {
        result.visibility_changes.push(VisibilityChange {
            sheet_id: sid.clone(),
            axis: crate::snapshot::Axis::Row,
            index: row,
            hidden,
        });
    }
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Hide columns.
pub(in crate::storage::engine) fn hide_columns(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cols: &[u32],
) -> Result<MutationResult, ComputeError> {
    dimensions::hide_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cols,
    );
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        for &c in cols {
            li.hide_col(c as usize);
        }
    }
    let mut result = MutationResult::empty();
    let sid: String = id_to_hex(sheet_id.as_u128()).into();
    for &c in cols {
        result.visibility_changes.push(VisibilityChange {
            sheet_id: sid.clone(),
            axis: crate::snapshot::Axis::Col,
            index: c,
            hidden: true,
        });
    }
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

/// Unhide columns.
pub(in crate::storage::engine) fn unhide_columns(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cols: &[u32],
) -> Result<MutationResult, ComputeError> {
    dimensions::unhide_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        cols,
    );
    if let Some(li) = stores.layout_indexes.get_mut(sheet_id) {
        for &c in cols {
            li.unhide_col(c as usize);
        }
    }
    let mut result = MutationResult::empty();
    let sid: String = id_to_hex(sheet_id.as_u128()).into();
    for &c in cols {
        result.visibility_changes.push(VisibilityChange {
            sheet_id: sid.clone(),
            axis: crate::snapshot::Axis::Col,
            index: c,
            hidden: false,
        });
    }
    result.floating_object_changes = recompute_floating_object_bounds(stores, sheet_id);
    Ok(result)
}

// -------------------------------------------------------------------
// Floating Object Bounds Invalidation
// -------------------------------------------------------------------

/// Recompute pixel bounds for all cell-anchored floating objects on a sheet.
///
/// When rows/columns are resized, inserted, deleted, hidden, or unhidden,
/// the LayoutIndex changes but cell-anchored objects' anchor configs stay
/// the same. Their absolute pixel bounds shift silently. This function emits
/// `FloatingObjectChange` entries with the recomputed bounds so that the TS
/// layer can update the render cache without a full re-read.
pub(in crate::storage::engine) fn recompute_floating_object_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<FloatingObjectChange> {
    let mut changes = Vec::new();
    let objects = floating_objects::get_all_floating_objects(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
    );
    let layout = stores.layout_indexes.get(sheet_id);

    for (object_id, obj_json) in &objects {
        let anchor_mode = obj_json
            .get("anchorMode")
            .and_then(|v| v.as_str())
            .unwrap_or("oneCell");
        if anchor_mode == "absolute" {
            continue;
        }
        if let Some(bounds) =
            compute_object_pixel_bounds(stores.grid_indexes.get(sheet_id), layout, obj_json)
        {
            changes.push(FloatingObjectChange {
                sheet_id: sheet_id.to_uuid_string(),
                object_id: object_id.clone(),
                kind: FloatingObjectChangeKind::Updated {
                    changed_fields: vec!["bounds".into()],
                },
                object_type: None,
                data: None,
                bounds: Some(bounds),
            });
        }
    }

    changes
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
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;

    let doc = stores.storage.doc();
    let sheets_map = doc.get_or_insert_map("sheets");

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
        }
        StructureChange::DeleteRows { at, count, .. } => {
            validation::structure::validate_delete_bounds(*at, *count, grid.row_count())?;
            StructuralOps::delete_rows(doc, &sheets_map, grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::InsertCols { at, count, .. } => {
            StructuralOps::insert_cols(doc, &sheets_map, grid, mirror, sheet_id, *at, *count)?;
        }
        StructureChange::DeleteCols { at, count, .. } => {
            validation::structure::validate_delete_bounds(*at, *count, grid.col_count())?;
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

    // Delegate to ComputeCore for formula reparsing and full recalc.
    // Note: ComputeCore.structure_change() regenerates A1 formula strings
    // from IdentityFormulas in memory (formula_strings cache), but does NOT
    // persist them to Yrs KEY_FORMULA. The get_cell_data() read path overlays
    // the authoritative formula_strings on top of Yrs data, so callers always
    // see the updated formulas without needing to write back to Yrs.
    let result = stores
        .compute
        .structure_change(mirror, Some((change, *sheet_id)))?;

    // Refresh stale KEY_FORMULA entries in Yrs for formula cells on the
    // affected sheet. `structure_change()` refreshed
    // `compute.formula_strings[cell_id]` with the shifted A1 form, but Yrs
    // still has the pre-shift string. We write the shifted form back to Yrs
    // so that Yrs remains the authoritative source — on undo, yrs's
    // rollback restores the pre-shift formula naturally, and the standard
    // observer rebuild re-parses it into a fresh IdentityFormula.
    invalidate_stale_yrs_formulas(stores, mirror, sheet_id);

    // Regenerate named range A1 strings in Yrs.
    // CellIds in IdentityFormulas don't change on structural ops, but positions
    // shift — so the A1 display representation must be regenerated.
    regenerate_named_range_yrs_refs(stores, mirror);

    Ok(result)
}

/// Refresh `KEY_FORMULA` sub-keys in Yrs cell maps for any formula-bearing
/// cell whose A1 form differs between Yrs (pre-shift) and the ComputeCore
/// cache (post-shift). Writes the authoritative shifted A1 string back to
/// Yrs so that yrs — not the compute cache — remains the source of truth.
///
/// The rest of each cell map (value, format, properties, KEY_FORMULA_TEMPLATE,
/// …) is left untouched.
///
/// **Why write instead of remove**: removing KEY_FORMULA created a parallel
/// journal where the compute cache held the post-shift formula but Yrs held
/// nothing. On undo, Yrs would roll back to the pre-shift formula correctly,
/// but any rebuild path that tries to re-anchor from `KEY_FORMULA` before the
/// rollback observed no formula at all. Writing the shifted formula keeps Yrs
/// as the single authoritative source and lets the standard
/// `rebuild_after_structural_observer_change` re-parse the correct string on
/// undo — no parallel journal, no out-of-band state.
///
/// Iteration is bounded by the formula-cell count of the affected sheet
/// (not total cells): we walk `mirror.get_sheet(sheet_id).cells_iter()`
/// filtered on `entry.formula.is_some()`.
///
/// `result.changed_cells` is intentionally **not** used to scope this —
/// it tracks cell *value* changes, and a formula whose refs shifted but
/// whose evaluated value didn't (e.g. `=A1+B1` → `=A2+B2` where the
/// operands are constants) would be missed.
///
/// Writes go through a single Yrs transaction tagged `ORIGIN_STRUCTURAL`
/// so undo groups the invalidation with the structural op itself. The
/// caller's observer-suppression window still applies (these writes are
/// initiated from within `apply_structure_change`).
fn invalidate_stale_yrs_formulas(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) {
    use compute_document::schema::{KEY_CELLS, KEY_FORMULA};
    use compute_document::undo::ORIGIN_STRUCTURAL;
    use std::sync::Arc;
    use yrs::{Any, Map, Origin, Out, Transact};

    let Some(sheet_mirror) = mirror.get_sheet(sheet_id) else {
        return;
    };

    // Pass 1 — read: collect (cell_hex, shifted_formula) pairs for cells
    // where Yrs KEY_FORMULA disagrees with the compute cache. Skip cells that
    // have no formula in the mirror (shouldn't have KEY_FORMULA anyway) and
    // cells that match (no-op optimization — avoids churn on cells untouched
    // by the shift).
    //
    // KEY_FORMULA stores the formula body *without* the leading '=' (see
    // `services/cell_editing.rs` write path, which strips the '=' before
    // calling `write_cell_to_yrs`). The compute cache's `get_formula()`
    // returns the A1 string *with* the leading '=' (see `display.rs`
    // `render_identity_formula` which always pushes '=' first). Strip it on
    // both the read-comparison and the write side.
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let sheets_map = stores.storage.sheets();

    let updates: Vec<(SmallHex, String)> = {
        let txn = doc.transact();
        let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) else {
            return;
        };
        let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS) else {
            return;
        };

        let mut pending = Vec::new();
        for (cell_id, entry) in sheet_mirror.cells_iter() {
            if entry.formula.is_none() {
                continue;
            }
            let cell_hex = id_to_hex(cell_id.as_u128());

            let yrs_formula = match cells_map.get(&txn, &cell_hex) {
                Some(Out::YMap(cell_map)) => match cell_map.get(&txn, KEY_FORMULA) {
                    Some(Out::Any(Any::String(s))) => Some(s.to_string()),
                    _ => None,
                },
                _ => None,
            };

            // Authoritative post-shift A1 string from the compute cache.
            // Includes the leading '=' (render_identity_formula convention).
            let Some(compute_formula) = stores.compute.get_formula(cell_id) else {
                continue;
            };
            // KEY_FORMULA convention: no leading '='.
            let shifted_body = compute_formula.strip_prefix('=').unwrap_or(compute_formula);

            // If Yrs already matches the shifted form, nothing to do.
            if let Some(ref existing) = yrs_formula
                && existing.as_str() == shifted_body
            {
                continue;
            }

            pending.push((cell_hex, shifted_body.to_string()));
        }
        pending
    };

    if updates.is_empty() {
        return;
    }

    // Pass 2 — write: update KEY_FORMULA on each affected cell map with the
    // shifted formula body. Writing (rather than removing) keeps Yrs
    // authoritative so undo's rollback restores the pre-shift string
    // naturally, without leaving a window where no formula exists in Yrs.
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex)
        && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
    {
        for (cell_hex, shifted_body) in &updates {
            if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex) {
                cell_map.insert(
                    &mut txn,
                    KEY_FORMULA,
                    Any::String(Arc::from(shifted_body.as_str())),
                );
            }
        }
    }
}

/// Refresh Yrs `DefinedName.refers_to` entries after a structural change.
///
/// The in-memory `VariableStore` holds `NamedRangeDef` with `IdentityFormula`
/// containing stable `CellId`s. Those CellIds still resolve correctly after
/// structural ops (only the mirror position mappings shift), so the JSON
/// serialization of the `IdentityFormula` does not actually change under
/// pure row/column shifts. We still re-serialize and upsert here to keep
/// this the single authoritative writeback point for named ranges after
/// a structural op — it also ensures any pre-W5 A1 strings still lingering
/// in Yrs (from documents authored before typed-boundary) are overwritten with
/// the canonical JSON form.
///
/// Typed formula boundary: picks JSON-serialized `IdentityFormula` as the single
/// on-disk format for `DefinedName.refers_to` in Yrs, eliminating the
/// prior A1-vs-JSON dual-decoder.
///
/// The caller must have the observer suppressed (structural ops already do
/// this) to prevent Yrs writes from triggering feedback loops.
fn regenerate_named_range_yrs_refs(stores: &mut EngineStores, mirror: &CellMirror) {
    // Collect data we need from the mirror to avoid holding a borrow across
    // the mutable Yrs writes below.
    let entries: Vec<(formula_types::Scope, String, formula_types::IdentityFormula)> = mirror
        .variables
        .all_variables()
        .filter(|(_, _, def)| !def.refers_to.refs.is_empty())
        .map(|(scope, name, def)| (scope.clone(), name.clone(), def.refers_to.clone()))
        .collect();

    if entries.is_empty() {
        return;
    }

    // Read existing Yrs entries to match by name+scope for id preservation.
    let yrs_entries =
        named_ranges::get_all_named_ranges(stores.storage.doc(), stores.storage.workbook_map());

    for (scope, name, refers_to) in &entries {
        // Convert scope to the Yrs string representation.
        let scope_str = match scope {
            formula_types::Scope::Sheet(sid) => Some(sid.to_uuid_string()),
            formula_types::Scope::Workbook => None,
        };

        // Serialize the already-typed IdentityFormula to JSON. CellIds are
        // stable under structural ops — the same JSON bytes are typically
        // produced before and after — but we re-upsert unconditionally so
        // this function remains the sole writeback path after structural
        // changes.
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map
        // keys and no non-finite floats in IdentityFormula.
        let refers_to_json = serde_json::to_string(refers_to)
            .expect("IdentityFormula serialization should not fail");

        // Find the existing Yrs entry by name+scope to preserve its id.
        let existing = yrs_entries
            .iter()
            .find(|dn| dn.name.eq_ignore_ascii_case(name) && dn.scope == scope_str);

        let id = existing
            .map(|dn| dn.id.clone())
            .unwrap_or_else(|| stores.next_id_simple());

        let defined_name = DefinedName {
            id,
            name: name.clone(),
            refers_to: refers_to_json,
            raw_refers_to: existing.and_then(|dn| dn.raw_refers_to.clone()),
            scope: scope_str,
            comment: existing.and_then(|dn| dn.comment.clone()),
            custom_menu: existing.and_then(|dn| dn.custom_menu.clone()),
            description: existing.and_then(|dn| dn.description.clone()),
            help: existing.and_then(|dn| dn.help.clone()),
            status_bar: existing.and_then(|dn| dn.status_bar.clone()),
            visible: existing.map(|dn| dn.visible).unwrap_or(true),
            xlm: existing.map(|dn| dn.xlm).unwrap_or(false),
            function: existing.map(|dn| dn.function).unwrap_or(false),
            vb_procedure: existing.map(|dn| dn.vb_procedure).unwrap_or(false),
            publish_to_server: existing.map(|dn| dn.publish_to_server).unwrap_or(false),
            workbook_parameter: existing.map(|dn| dn.workbook_parameter).unwrap_or(false),
            xml_space_preserve: existing.map(|dn| dn.xml_space_preserve).unwrap_or(false),
            order: existing.and_then(|dn| dn.order),
            linked_range_id: existing.and_then(|dn| dn.linked_range_id),
        };

        named_ranges::upsert_named_range(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            &defined_name,
        );
    }
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

/// Collect source cell values for a relocate operation.
///
/// Returns a Vec of `(delta_row, delta_col, CellValue)` tuples representing
/// the typed values to be written at target offsets. `CellValue::Null`
/// represents empty source cells that should be skipped during the write
/// phase. Errors and arrays survive verbatim — see the `import_values`-based
/// target write in `relocate_cells` for the lossless handoff.
pub(in crate::storage::engine) fn collect_relocate_values(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
) -> Vec<(u32, u32, CellValue)> {
    let mut cells_to_move: Vec<(u32, u32, CellValue)> = Vec::new();

    for row in src_start_row..=src_end_row {
        for col in src_start_col..=src_end_col {
            let pos = SheetPos::new(row, col);
            let value = mirror
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);
            let dr = row - src_start_row;
            let dc = col - src_start_col;
            cells_to_move.push((dr, dc, value));
        }
    }

    cells_to_move
}

// -------------------------------------------------------------------
// Virtual CellId cleanup for structural deletes
// -------------------------------------------------------------------

/// Collect virtual CellIds from Range views whose rows fall in the doomed band
/// `[at, at+count)`. Must be called BEFORE `StructuralOps::delete_rows`
/// modifies identity maps.
///
/// Mirrors the logic in `CellMirror::apply_structure_change` (structure.rs
/// lines 101-147) but runs earlier so we can purge these from the Yrs CRDT.
fn collect_virtual_cell_ids_for_deleted_rows(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    at: u32,
    count: u32,
) -> Vec<CellId> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };
    if sheet.range_views_is_empty() {
        return Vec::new();
    }

    // Collect RowIds in the doomed band.
    let deleted_row_ids: Vec<RowId> = (at..at + count)
        .filter_map(|i| sheet.row_id_at(i))
        .collect();
    if deleted_row_ids.is_empty() {
        return Vec::new();
    }

    // Collect all ColIds that any Range view covers.
    let range_col_ids: rustc_hash::FxHashSet<ColId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.col_offset_by_id.keys().copied())
        .collect();

    // Collect all RowIds that any Range view covers, to filter deleted_row_ids.
    let range_row_ids: rustc_hash::FxHashSet<RowId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.row_offset_by_id.keys().copied())
        .collect();

    let mut result = Vec::new();
    for &rid in &deleted_row_ids {
        if !range_row_ids.contains(&rid) {
            continue;
        }
        for &cid in &range_col_ids {
            result.push(CellId::virtual_at(*sheet_id, rid, cid));
        }
    }
    result
}

/// Collect virtual CellIds from Range views whose columns fall in the doomed
/// band `[at, at+count)`. Symmetric to `collect_virtual_cell_ids_for_deleted_rows`.
fn collect_virtual_cell_ids_for_deleted_cols(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    at: u32,
    count: u32,
) -> Vec<CellId> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };
    if sheet.range_views_is_empty() {
        return Vec::new();
    }

    // Collect ColIds in the doomed band.
    let deleted_col_ids: Vec<ColId> = (at..at + count)
        .filter_map(|i| sheet.col_id_at(i))
        .collect();
    if deleted_col_ids.is_empty() {
        return Vec::new();
    }

    // Collect all RowIds that any Range view covers.
    let range_row_ids: rustc_hash::FxHashSet<RowId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.row_offset_by_id.keys().copied())
        .collect();

    // Collect all ColIds that any Range view covers, to filter deleted_col_ids.
    let range_col_ids: rustc_hash::FxHashSet<ColId> = sheet
        .iter_ranges()
        .flat_map(|(_, rv)| rv.col_offset_by_id.keys().copied())
        .collect();

    let mut result = Vec::new();
    for &cid in &deleted_col_ids {
        if !range_col_ids.contains(&cid) {
            continue;
        }
        for &rid in &range_row_ids {
            result.push(CellId::virtual_at(*sheet_id, rid, cid));
        }
    }
    result
}

/// Remove virtual CellId entries from the Yrs `cells` map. Uses a single
/// `ORIGIN_STRUCTURAL` transaction so undo groups this with the structural op.
///
/// Removing a key that does not exist in the Yrs map is a no-op, so this is
/// safe to call even if `StructuralOps::delete_rows/cols` already removed
/// some of these CellIds.
fn purge_virtual_cell_ids_from_yrs(
    doc: &yrs::Doc,
    sheets_map: &yrs::MapRef,
    sheet_id: &SheetId,
    virtual_cell_ids: &[CellId],
) {
    use compute_document::schema::KEY_CELLS;
    use compute_document::undo::ORIGIN_STRUCTURAL;
    use yrs::{Map, Origin, Out, Transact};

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
    if let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex)
        && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
    {
        for cell_id in virtual_cell_ids {
            let cell_hex = id_to_hex(cell_id.as_u128());
            cells_map.remove(&mut txn, &cell_hex);
        }
    }
}

// -------------------------------------------------------------------
// Pre-delete re-anchor pass
// -------------------------------------------------------------------

/// Before a `DeleteRows` / `DeleteCols` op tears down the affected CellIds,
/// shrink any `IdentityRangeRef` whose endpoint sits inside the doomed band
/// to the nearest surviving cell so e.g. `SUM(A1:A5)` with row 0 deleted
/// becomes `SUM(A1:A4)` instead of `SUM(#REF!)`.
///
/// Semantics ("shrink to surviving sub-region"):
/// - If the Range's START is doomed and the END survives, clamp START to
///   the first surviving position on the deleted axis (`at + count`),
///   keeping START's other axis.
/// - Symmetric for the END endpoint (clamped to `at - 1`).
/// - If both endpoints are doomed, leave the refs alone — the formula
///   will render as `#REF!`, the truthful fallback.
///
/// Only mutates `CellEntry.formula` in the mirror. Downstream
/// (`structure_change()` → `regenerate_formula_strings` →
/// `invalidate_stale_yrs_formulas`) does the rest.
///
/// Must run BEFORE the structural op removes the doomed cells' identities,
/// so their pre-delete positions can still be resolved via the mirror.
fn pre_delete_re_anchor_range_refs(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    at: u32,
    count: u32,
    is_row: bool,
) {
    use formula_types::{IdentityFormulaRef, IdentityRangeRef};

    if count == 0 || mirror.get_sheet(sheet_id).is_none() {
        return;
    }

    let doomed_end = at.saturating_add(count); // exclusive: [at, doomed_end)

    // Decide whether a resolved (sheet, row, col) position lies in the
    // doomed band on the target sheet / axis.
    let in_doomed_band = |pos: Option<(SheetId, u32, u32)>| -> bool {
        match pos {
            Some((sid, row, col)) if sid == *sheet_id => {
                let axis_val = if is_row { row } else { col };
                axis_val >= at && axis_val < doomed_end
            }
            _ => false,
        }
    };

    // Resolve (sheet, row, col) for a CellId by combining `sheet_for_cell`
    // with `resolve_position` (returns `SheetPos`).
    let resolve_pos = |m: &CellMirror, id: &CellId| -> Option<(SheetId, u32, u32)> {
        let sid = m.sheet_for_cell(id)?;
        let p = m.resolve_position(id)?;
        Some((sid, p.row(), p.col()))
    };

    // Pass 1 — read: collect (owning_cell_id, new_refs) updates. We can't
    // mutate the mirror while iterating its sheets.
    struct Update {
        owning_cell: CellId,
        new_refs: Vec<IdentityFormulaRef>,
    }
    let mut updates: Vec<Update> = Vec::new();

    // Iterate every sheet's cells so cross-sheet formulas pointing at
    // `sheet_id` get re-anchored too.
    let all_sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();

    for owning_sheet in &all_sheet_ids {
        let Some(sheet_mirror) = mirror.get_sheet(owning_sheet) else {
            continue;
        };

        for (cell_id, entry) in sheet_mirror.cells_iter() {
            let Some(formula) = &entry.formula else {
                continue;
            };

            let mut new_refs: Vec<IdentityFormulaRef> = Vec::with_capacity(formula.refs.len());
            let mut any_change = false;

            for r in &formula.refs {
                match r {
                    IdentityFormulaRef::Range(rng) => {
                        let start_pos = resolve_pos(mirror, &rng.start_id);
                        let end_pos = resolve_pos(mirror, &rng.end_id);

                        let start_doomed = in_doomed_band(start_pos);
                        let end_doomed = in_doomed_band(end_pos);

                        if !start_doomed && !end_doomed {
                            new_refs.push(r.clone());
                            continue;
                        }

                        let mut new_rng: IdentityRangeRef = *rng;
                        let mut changed = false;

                        // Clamp START if doomed and END survives, so the new
                        // START sits just past the doomed band.
                        if start_doomed {
                            let end_survives = !end_doomed && end_pos.is_some();
                            let start_other_axis = match start_pos {
                                Some((_, row, col)) => {
                                    if is_row {
                                        col
                                    } else {
                                        row
                                    }
                                }
                                None => {
                                    new_refs.push(r.clone());
                                    continue;
                                }
                            };
                            if is_row {
                                let new_row = doomed_end;
                                let end_row = end_pos.map(|(_, r, _)| r);
                                if end_survives
                                    && end_row.is_some_and(|er| new_row <= er)
                                    && let Some(new_id) = mirror.resolve_cell_id(
                                        sheet_id,
                                        SheetPos::new(new_row, start_other_axis),
                                    )
                                {
                                    new_rng.start_id = new_id;
                                    changed = true;
                                }
                            } else {
                                let new_col = doomed_end;
                                let end_col = end_pos.map(|(_, _, c)| c);
                                if end_survives
                                    && end_col.is_some_and(|ec| new_col <= ec)
                                    && let Some(new_id) = mirror.resolve_cell_id(
                                        sheet_id,
                                        SheetPos::new(start_other_axis, new_col),
                                    )
                                {
                                    new_rng.start_id = new_id;
                                    changed = true;
                                }
                            }
                        }

                        // Clamp END if doomed and START survives, so the new
                        // END sits just before the doomed band (`at - 1`).
                        if end_doomed {
                            let start_survives = !start_doomed && start_pos.is_some();
                            let end_other_axis = match end_pos {
                                Some((_, row, col)) => {
                                    if is_row {
                                        col
                                    } else {
                                        row
                                    }
                                }
                                None => {
                                    if changed {
                                        new_refs.push(IdentityFormulaRef::Range(new_rng));
                                        any_change = true;
                                    } else {
                                        new_refs.push(r.clone());
                                    }
                                    continue;
                                }
                            };
                            if is_row {
                                if at > 0 {
                                    let new_row = at - 1;
                                    let start_row = start_pos.map(|(_, r, _)| r);
                                    if start_survives
                                        && start_row.is_some_and(|sr| sr <= new_row)
                                        && let Some(new_id) = mirror.resolve_cell_id(
                                            sheet_id,
                                            SheetPos::new(new_row, end_other_axis),
                                        )
                                    {
                                        new_rng.end_id = new_id;
                                        changed = true;
                                    }
                                }
                                // at == 0 → nothing survives above the deleted band.
                            } else if at > 0 {
                                let new_col = at - 1;
                                let start_col = start_pos.map(|(_, _, c)| c);
                                if start_survives
                                    && start_col.is_some_and(|sc| sc <= new_col)
                                    && let Some(new_id) = mirror.resolve_cell_id(
                                        sheet_id,
                                        SheetPos::new(end_other_axis, new_col),
                                    )
                                {
                                    new_rng.end_id = new_id;
                                    changed = true;
                                }
                            }
                            // at == 0 → nothing survives to the left of the deleted band.
                        }

                        if changed {
                            new_refs.push(IdentityFormulaRef::Range(new_rng));
                            any_change = true;
                        } else {
                            new_refs.push(r.clone());
                        }
                    }
                    other => new_refs.push(other.clone()),
                }
            }

            if any_change {
                updates.push(Update {
                    owning_cell: *cell_id,
                    new_refs,
                });
            }
        }
    }

    // Pass 2 — write: install the re-anchored IdentityFormulas. Only the
    // refs vector changes; template and flags are preserved.
    for Update {
        owning_cell,
        new_refs,
    } in updates
    {
        if let Some(old_formula) = mirror.get_formula(&owning_cell).cloned() {
            let new_formula = formula_types::IdentityFormula {
                template: old_formula.template,
                refs: new_refs,
                is_dynamic_array: old_formula.is_dynamic_array,
                is_volatile: old_formula.is_volatile,
                // Re-anchor only changes refs; formula shape is preserved.
                is_aggregate: old_formula.is_aggregate,
            };
            mirror.set_formula(&owning_cell, Some(new_formula));
        }
    }
}
