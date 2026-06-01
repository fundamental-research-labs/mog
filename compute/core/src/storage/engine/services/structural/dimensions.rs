use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::units::{CharWidth, Pixels};
use value_types::ComputeError;
use yrs::{Map, Origin, Out, Transact};

use crate::snapshot::{ChangeKind, MutationResult, VisibilityChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::dimensions;
use crate::storage::sheet_dimensions::SheetDimensionsMut;

use super::floating_bounds::recompute_floating_object_bounds;

// -------------------------------------------------------------------
// Dimension Operations (self-contained core logic)
// -------------------------------------------------------------------

/// True when the sheet stores its axis identities in compact (`Runs`) form
/// under `gridIndex`. Compact axes are authoritative on reload, so an
/// auto-grow that only appends to `rowOrder`/`colOrder` would be discarded —
/// the caller must materialize dense axes when this returns `true`.
fn sheet_has_compact_axes(txn: &yrs::TransactionMut<'_>, sheet_map: &yrs::MapRef) -> bool {
    use compute_document::schema::{KEY_GRID_COL_AXIS, KEY_GRID_INDEX, KEY_GRID_ROW_AXIS};
    match sheet_map.get(txn, KEY_GRID_INDEX) {
        Some(Out::YMap(grid_index)) => {
            grid_index.get(txn, KEY_GRID_ROW_AXIS).is_some()
                || grid_index.get(txn, KEY_GRID_COL_AXIS).is_some()
        }
        _ => false,
    }
}

/// Ensure the sheet's axis identities cover `(row, col)` before a dimension
/// write.
///
/// Resizing addresses a row/column by *physical index*, but the storage layer
/// keys widths/heights by the stable RowId/ColId resolved from that index via
/// the `GridIndex` axis store. When the index lies beyond the materialized
/// extent (e.g. a sparse or compact-persisted document), that lookup returns
/// `None` and the write historically failed with a misleading
/// [`ComputeError::SheetNotFound`].
///
/// This mirrors the cell-write auto-grow path: it expands both the in-memory
/// `GridIndex` and the Yrs `rowOrder`/`colOrder` arrays (and materializes
/// compact axes to dense so the grow survives reload), using the same freshly
/// allocated identities on both sides. No-op when the index is already covered.
fn ensure_axis_capacity(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<(), ComputeError> {
    if !stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        });
    }

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = stores.storage.doc();
    let sheets = stores.storage.sheets();
    // User-edit origin so the implicit grow groups with the resize for undo.
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let compact_axes = match sheets.get(&txn, sheet_hex.as_str()) {
        Some(Out::YMap(sheet_map)) => sheet_has_compact_axes(&txn, &sheet_map),
        _ => {
            return Err(ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            });
        }
    };

    // `contains_key` checked above, so the sheet is present in the index map.
    let grid = stores
        .grid_indexes
        .get_mut(sheet_id)
        .expect("grid index present");
    let mut dims = SheetDimensionsMut::from_grid_index(doc, sheets, grid);
    dims.ensure_capacity(&mut txn, *sheet_id, row, col)?;
    if compact_axes {
        dims.materialize_dense_axes_and_remove_compact_keys(&mut txn, *sheet_id)?;
    }
    Ok(())
}

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
    // Auto-grow the axis so resizing a row beyond the materialized extent
    // works instead of failing with a misleading SheetNotFound.
    ensure_axis_capacity(stores, sheet_id, row, 0)?;
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
    // Auto-grow the axis so resizing a column beyond the materialized extent
    // works instead of failing with a misleading SheetNotFound.
    ensure_axis_capacity(stores, sheet_id, 0, col)?;
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
    // Auto-grow once to cover the widest target so out-of-extent columns in the
    // batch resolve to a stable identity instead of failing SheetNotFound.
    if let Some(max_col) = widths.iter().map(|(col, _)| *col).max() {
        ensure_axis_capacity(stores, sheet_id, 0, max_col)?;
    }
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
    ensure_axis_capacity(stores, sheet_id, 0, col)?;
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
    if let Some(max_col) = widths.iter().map(|(col, _)| *col).max() {
        ensure_axis_capacity(stores, sheet_id, 0, max_col)?;
    }
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
