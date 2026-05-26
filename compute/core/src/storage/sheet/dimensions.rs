//! Row height, column width, and hidden rows/columns operations on Yrs storage.
//!
//! Port of `spreadsheet-model/src/dimensions.ts`.
//!
//! ## Yrs Storage Layout
//!
//! Per-sheet maps:
//! ```text
//! sheets/{sheetId}/rowHeights: Y.Map<RowId, f64>       — custom row heights
//! sheets/{sheetId}/colWidths: Y.Map<ColId, f64>        — custom column widths
//! sheets/{sheetId}/manualHiddenRows: Y.Map<RowId, true> — user/manual row hides
//! sheets/{sheetId}/filterHiddenRows: Y.Map<FilterId, Y.Map<RowId, true>>
//! sheets/{sheetId}/hiddenRows: Y.Map<string, true>     — effective hidden cache for compatibility
//! sheets/{sheetId}/hiddenCols: Y.Map<string, true>     — hidden col indices (string keys)
//! ```
//!
//! ## Design Decisions
//!
//! - Row heights / column widths are keyed by stable RowId/ColId (identity model).
//! - Hidden rows/cols use a Map with row/col index as key and `Any::Bool(true)` as value.
//!   This gives O(1) lookup versus the O(n) array used in the TypeScript version.
//! - Virtual (unmaterialized) rows/cols return default height/width without materialization.
//! - Hidden rows return 0.0 height; hidden columns return 0.0 width.

use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::{
    KEY_COL_WIDTHS, KEY_FILTER_HIDDEN_ROWS, KEY_HIDDEN_COLS, KEY_HIDDEN_ROWS,
    KEY_MANUAL_HIDDEN_ROWS, KEY_ROW_HEIGHTS,
};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::units::{CharWidth, Points};
use value_types::ComputeError;

// =============================================================================
// Constants
// =============================================================================

/// Default row height in **points** (OOXML standard for Calibri 11pt).
/// The layout engine converts to pixels via `points_to_pixels()`.
pub const DEFAULT_ROW_HEIGHT: Points = Points(15.0);

/// Default column width in **character-width units** (OOXML standard for Calibri 11pt).
/// The layout engine converts to pixels via `char_width_to_pixels()`.
/// Prefer [`get_sheet_default_col_width`] which reads the sheet metadata and
/// falls back to this value.
pub const DEFAULT_COL_WIDTH: CharWidth = CharWidth(8.43);

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get a sub-map from a sheet by key (read-only).
fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

fn row_id_key(grid_index: Option<&GridIndex>, row: u32) -> Option<String> {
    grid_index
        .and_then(|gi| gi.row_id(row))
        .map(|rid| id_to_hex(rid.as_u128()).to_string())
}

fn map_has_true<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> bool {
    matches!(map.get(txn, key), Some(Out::Any(Any::Bool(true))))
}

fn any_filter_hides_row<T: yrs::ReadTxn>(
    filter_hidden_rows_map: &MapRef,
    txn: &T,
    row_id: &str,
) -> bool {
    filter_hidden_rows_map.iter(txn).any(|(_, owner)| {
        if let Out::YMap(owner_map) = owner {
            map_has_true(&owner_map, txn, row_id)
        } else {
            false
        }
    })
}

fn effective_hidden_by_row_id<T: yrs::ReadTxn>(
    manual_hidden_rows_map: Option<&MapRef>,
    filter_hidden_rows_map: Option<&MapRef>,
    txn: &T,
    row_id: &str,
) -> bool {
    manual_hidden_rows_map.is_some_and(|m| map_has_true(m, txn, row_id))
        || filter_hidden_rows_map.is_some_and(|m| any_filter_hides_row(m, txn, row_id))
}

fn write_effective_hidden_cache(
    hidden_rows_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    row: u32,
    hidden: bool,
) {
    let key = row.to_string();
    if hidden {
        hidden_rows_map.insert(txn, &*key, Any::Bool(true));
    } else {
        hidden_rows_map.remove(txn, &key);
    }
}

// =============================================================================
// Dimensions Operations (free functions)
// =============================================================================
// -------------------------------------------------------------------------
// Row Heights
// -------------------------------------------------------------------------

/// Set row height.
///
/// If `height` equals [`DEFAULT_ROW_HEIGHT`], removes the custom height entry
/// (only if the row is already materialized). Otherwise materializes the row
/// (creates a RowId) and stores the custom height.
pub fn set_row_height(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    height: Points,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let row_hex = grid_index
        .and_then(|gi| gi.row_id(row))
        .map(|rid| id_to_hex(rid.as_u128()));
    if height == DEFAULT_ROW_HEIGHT {
        // Clear custom height — only if row has an identity
        if let Some(row_id) = row_hex {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            if let Some(row_heights_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS)
            {
                row_heights_map.remove(&mut txn, &row_id);
            }
        }
        Ok(())
    } else {
        // Set custom height — row must exist in GridIndex (all rows have IDs)
        let row_id = row_hex.ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        if let Some(row_heights_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS) {
            row_heights_map.insert(&mut txn, &*row_id, Any::Number(height.0));
        }
        Ok(())
    }
}

/// Get row height.
///
/// Returns `0.0` for hidden rows. Returns the custom height if set, otherwise
/// [`DEFAULT_ROW_HEIGHT`]. Virtual rows (no RowId) return default without
/// materialization.
///
/// "Hidden" here means either:
///   - The row is in the `KEY_HIDDEN_ROWS` map (explicit hide via filter
///     dropdown / Format > Hide Row).
///   - The row is inside a collapsed outline group (Data > Group / Outline).
///
/// The renderer uses `get_row_height` to skip painting; collapsed rows must
/// have height 0 or they'll paint at full height while their data is gone.
pub fn get_row_height(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Points {
    // Hidden rows have zero visual height — explicit hide OR collapsed outline group.
    if is_row_hidden(doc, sheets, sheet_id, row)
        || !super::grouping::is_row_visible_by_groups(doc, sheets, sheet_id, row)
    {
        return Points(0.0);
    }

    let row_id = match grid_index.and_then(|gi| gi.row_id(row)) {
        Some(rid) => id_to_hex(rid.as_u128()),
        None => return DEFAULT_ROW_HEIGHT,
    };

    let txn = doc.transact();

    let row_heights_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS) {
        Some(m) => m,
        None => return DEFAULT_ROW_HEIGHT,
    };

    match row_heights_map.get(&txn, &row_id) {
        Some(Out::Any(Any::Number(h))) => Points(h),
        _ => DEFAULT_ROW_HEIGHT,
    }
}

/// Get the stored row height, ignoring hidden state.
///
/// Unlike `get_row_height()` which returns 0.0 for hidden rows (for UI rendering),
/// this returns the actual stored height. Used by the XLSX export path to preserve
/// the original height of hidden rows in the output file.
#[allow(dead_code)]
pub fn get_row_height_stored(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Points {
    let row_id = match grid_index.and_then(|gi| gi.row_id(row)) {
        Some(rid) => id_to_hex(rid.as_u128()),
        None => return DEFAULT_ROW_HEIGHT,
    };

    let txn = doc.transact();

    let row_heights_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS) {
        Some(m) => m,
        None => return DEFAULT_ROW_HEIGHT,
    };

    match row_heights_map.get(&txn, &row_id) {
        Some(Out::Any(Any::Number(h))) => Points(h),
        _ => DEFAULT_ROW_HEIGHT,
    }
}

/// Returns the explicitly stored row height, or `None` if no custom height is stored.
///
/// Unlike [`get_row_height_stored`] which falls back to [`DEFAULT_ROW_HEIGHT`], this
/// distinguishes "no stored height" from "stored height that happens to equal the default".
/// The export path needs this to avoid emitting spurious `<row>` entries for rows
/// whose height was never explicitly set.
pub fn get_row_height_explicit(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Option<Points> {
    let row_id = id_to_hex(grid_index?.row_id(row)?.as_u128());

    let txn = doc.transact();
    let row_heights_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS)?;

    match row_heights_map.get(&txn, &row_id) {
        Some(Out::Any(Any::Number(h))) => Some(Points(h)),
        _ => None,
    }
}

// -------------------------------------------------------------------------
// Column Widths
// -------------------------------------------------------------------------

/// Set column width.
///
/// If `width` equals [`DEFAULT_COL_WIDTH`], removes the custom width entry
/// (only if the column is already materialized). Otherwise materializes the
/// column (creates a ColId) and stores the custom width.
pub fn set_col_width(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
    width: CharWidth,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col_hex = grid_index
        .and_then(|gi| gi.col_id(col))
        .map(|cid| id_to_hex(cid.as_u128()));
    let sheet_default = get_sheet_default_col_width(doc, sheets, sheet_id);
    if width == sheet_default {
        // Clear custom width — only if column has an identity
        if let Some(col_id) = col_hex {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            if let Some(col_widths_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
                col_widths_map.remove(&mut txn, &col_id);
            }
        }
        Ok(())
    } else {
        // Set custom width — col must exist in GridIndex (all cols have IDs)
        let col_id = col_hex.ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        if let Some(col_widths_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
            col_widths_map.insert(&mut txn, &*col_id, Any::Number(width.0));
        }
        Ok(())
    }
}

/// Get column width.
///
/// Returns `0.0` for hidden columns. Returns the custom width if set, otherwise
/// [`DEFAULT_COL_WIDTH`]. Virtual columns (no ColId) return default without
/// materialization.
///
/// "Hidden" here means either:
///   - The column is in the `KEY_HIDDEN_COLS` map (explicit hide).
///   - The column is inside a collapsed outline group.
pub fn get_col_width(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> CharWidth {
    // Hidden columns have zero visual width — explicit hide OR collapsed outline group.
    if is_column_hidden(doc, sheets, sheet_id, col)
        || !super::grouping::is_column_visible_by_groups(doc, sheets, sheet_id, col)
    {
        return CharWidth(0.0);
    }

    let col_id = match grid_index.and_then(|gi| gi.col_id(col)) {
        Some(cid) => id_to_hex(cid.as_u128()),
        None => return DEFAULT_COL_WIDTH,
    };

    let txn = doc.transact();

    let col_widths_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
        Some(m) => m,
        None => return DEFAULT_COL_WIDTH,
    };

    match col_widths_map.get(&txn, &col_id) {
        Some(Out::Any(Any::Number(w))) => CharWidth(w),
        _ => DEFAULT_COL_WIDTH,
    }
}

/// Get the stored column width, ignoring hidden state.
///
/// Unlike `get_col_width()` which returns 0.0 for hidden columns (for UI rendering),
/// this returns the actual stored width. Used by the XLSX export path to preserve
/// the original width of hidden columns in the output file.
#[allow(dead_code)]
pub fn get_col_width_stored(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> CharWidth {
    get_col_width_explicit(doc, sheets, sheet_id, col, grid_index).unwrap_or(DEFAULT_COL_WIDTH)
}

/// Returns the explicitly stored column width, or `None` if no custom width is stored.
///
/// Unlike [`get_col_width_stored`] which falls back to [`DEFAULT_COL_WIDTH`], this
/// distinguishes "no stored width" from "stored width that happens to equal the default".
/// The export path needs this to avoid emitting spurious `<col>` entries for columns
/// whose width was never explicitly set.
pub fn get_col_width_explicit(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> Option<CharWidth> {
    let col_id = id_to_hex(grid_index?.col_id(col)?.as_u128());

    let txn = doc.transact();
    let col_widths_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS)?;

    match col_widths_map.get(&txn, &col_id) {
        Some(Out::Any(Any::Number(w))) => Some(CharWidth(w)),
        _ => None,
    }
}

/// Like [`get_col_width`] but uses a caller-supplied default instead of the
/// module-level constant.  This avoids a per-column metadata lookup in hot
/// paths like viewport rendering — the caller reads the sheet default once
/// and passes it in.
#[allow(dead_code)]
pub fn get_col_width_with_default(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
    default_col_width: CharWidth,
    grid_index: Option<&GridIndex>,
) -> CharWidth {
    if is_column_hidden(doc, sheets, sheet_id, col)
        || !super::grouping::is_column_visible_by_groups(doc, sheets, sheet_id, col)
    {
        return CharWidth(0.0);
    }

    let col_id = match grid_index.and_then(|gi| gi.col_id(col)) {
        Some(cid) => id_to_hex(cid.as_u128()),
        None => return default_col_width,
    };

    let txn = doc.transact();

    let col_widths_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
        Some(m) => m,
        None => return default_col_width,
    };

    match col_widths_map.get(&txn, &col_id) {
        Some(Out::Any(Any::Number(w))) => CharWidth(w),
        _ => default_col_width,
    }
}

/// Read the sheet-level default column width from metadata.
///
/// Returns the value in **character-width units** (canonical OOXML units).
/// Falls back to [`DEFAULT_COL_WIDTH`] (8.43) when the metadata key is absent.
pub fn get_sheet_default_col_width(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> CharWidth {
    super::properties::get_sheet_meta(doc, sheets, sheet_id)
        .map(|m| CharWidth(m.default_col_width))
        .unwrap_or(DEFAULT_COL_WIDTH)
}

// -------------------------------------------------------------------------
// Hidden Rows
// -------------------------------------------------------------------------

/// Hide rows for manual/user ownership.
///
/// Adds the given row identities to `manualHiddenRows` and updates the
/// effective `hiddenRows` compatibility cache. Rows without identity fall back
/// to the legacy effective cache so older construction paths keep visibility.
pub fn hide_manual_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rows: &[u32],
    grid_index: Option<&GridIndex>,
) {
    if rows.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);

    for &row in rows {
        if let (Some(owner_map), Some(row_id)) =
            (&manual_hidden_rows_map, row_id_key(grid_index, row))
        {
            owner_map.insert(&mut txn, &*row_id, Any::Bool(true));
        }
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, true);
    }
}

/// Test wrapper for callers without a GridIndex.
#[cfg(test)]
pub fn hide_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, rows: &[u32]) {
    hide_manual_rows(doc, sheets, sheet_id, rows, None);
}

/// Unhide rows for manual/user ownership.
///
/// Removes only manual ownership, then recomputes effective visibility from
/// remaining manual/filter owners.
pub fn unhide_manual_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rows: &[u32],
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    if rows.is_empty() {
        return transitions;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS);

    for &row in rows {
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let Some(row_id) = row_id_key(grid_index, row) else {
            write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, false);
            if before {
                transitions.push((row, false));
            }
            continue;
        };
        if let Some(owner_map) = &manual_hidden_rows_map {
            owner_map.remove(&mut txn, &row_id);
        }
        let effective = effective_hidden_by_row_id(
            manual_hidden_rows_map.as_ref(),
            filter_hidden_rows_map.as_ref(),
            &txn,
            &row_id,
        );
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, effective);
        if before != effective {
            transitions.push((row, effective));
        }
    }

    transitions
}

/// Test wrapper for callers without a GridIndex.
#[cfg(test)]
pub fn unhide_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, rows: &[u32]) {
    let _ = unhide_manual_rows(doc, sheets, sheet_id, rows, None);
}

/// Replace one filter's row-hidden ownership over a known affected set.
///
/// This does not mutate manual hidden rows. The returned pairs are effective
/// visibility transitions (`row`, `hidden`) after owner recomposition.
pub fn set_filter_hidden_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    rows_to_hide: &[u32],
    rows_to_release: &[u32],
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map =
        match get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) {
            Some(m) => m,
            None => return transitions,
        };
    if filter_hidden_rows_map.get(&txn, filter_id).is_none() {
        filter_hidden_rows_map.insert(
            &mut txn,
            filter_id,
            yrs::MapPrelim::from([] as [(&str, Any); 0]),
        );
    }
    let owner_map = match filter_hidden_rows_map.get(&txn, filter_id) {
        Some(Out::YMap(m)) => m,
        _ => return transitions,
    };

    let mut affected: Vec<u32> = rows_to_hide
        .iter()
        .chain(rows_to_release.iter())
        .copied()
        .collect();
    affected.sort_unstable();
    affected.dedup();

    for &row in rows_to_hide {
        if let Some(row_id) = row_id_key(grid_index, row) {
            owner_map.insert(&mut txn, &*row_id, Any::Bool(true));
        }
    }
    for &row in rows_to_release {
        if let Some(row_id) = row_id_key(grid_index, row) {
            owner_map.remove(&mut txn, &row_id);
        }
    }

    for row in affected {
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let effective = row_id_key(grid_index, row).is_some_and(|row_id| {
            effective_hidden_by_row_id(
                manual_hidden_rows_map.as_ref(),
                Some(&filter_hidden_rows_map),
                &txn,
                &row_id,
            )
        });
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, effective);
        if before != effective {
            transitions.push((row, effective));
        }
    }

    transitions
}

/// Clear a filter's row-hidden ownership and recompute affected effective rows.
pub fn clear_filter_hidden_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map =
        match get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) {
            Some(m) => m,
            None => return transitions,
        };
    let owner_map = match filter_hidden_rows_map.get(&txn, filter_id) {
        Some(Out::YMap(m)) => m,
        _ => return transitions,
    };
    let row_ids: Vec<String> = owner_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                Some(key.to_string())
            } else {
                None
            }
        })
        .collect();
    filter_hidden_rows_map.remove(&mut txn, filter_id);

    for row_id in row_ids {
        let Some(row) = grid_index.and_then(|gi| gi.row_index_from_hex(&row_id)) else {
            continue;
        };
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let effective = effective_hidden_by_row_id(
            manual_hidden_rows_map.as_ref(),
            Some(&filter_hidden_rows_map),
            &txn,
            &row_id,
        );
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, effective);
        if before != effective {
            transitions.push((row, effective));
        }
    }

    transitions
}

/// Check if a row is hidden.
pub fn is_row_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32) -> bool {
    let txn = doc.transact();

    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return false,
    };

    let key = row.to_string();
    matches!(
        hidden_rows_map.get(&txn, &key),
        Some(Out::Any(Any::Bool(true)))
    )
}

/// Get all hidden rows for a sheet, sorted.
pub fn get_hidden_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<u32> {
    let txn = doc.transact();

    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result: Vec<u32> = hidden_rows_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                key.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect();

    result.sort_unstable();
    result
}

// -------------------------------------------------------------------------
// Hidden Columns
// -------------------------------------------------------------------------

/// Hide columns.
///
/// Adds the given column indices to the `hiddenCols` map. Columns that are
/// already hidden are silently skipped.
pub fn hide_columns(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, cols: &[u32]) {
    if cols.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return,
    };

    for &col in cols {
        let key = col.to_string();
        // Skip if already hidden
        if matches!(
            hidden_cols_map.get(&txn, &key),
            Some(Out::Any(Any::Bool(true)))
        ) {
            continue;
        }
        hidden_cols_map.insert(&mut txn, &*key, Any::Bool(true));
    }
}

/// Unhide columns.
///
/// Removes the given column indices from the `hiddenCols` map. Columns that
/// are not hidden are silently skipped.
pub fn unhide_columns(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, cols: &[u32]) {
    if cols.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return,
    };

    for &col in cols {
        let key = col.to_string();
        hidden_cols_map.remove(&mut txn, &key);
    }
}

/// Check if a column is hidden.
pub fn is_column_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, col: u32) -> bool {
    let txn = doc.transact();

    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return false,
    };

    let key = col.to_string();
    matches!(
        hidden_cols_map.get(&txn, &key),
        Some(Out::Any(Any::Bool(true)))
    )
}

/// Get all hidden columns for a sheet, sorted.
pub fn get_hidden_columns(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<u32> {
    let txn = doc.transact();

    let hidden_cols_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_COLS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result: Vec<u32> = hidden_cols_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                key.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect();

    result.sort_unstable();
    result
}

// =============================================================================
// Bulk scan functions (for LayoutIndex construction)
// =============================================================================

/// Scan all custom row heights for a sheet from Yrs storage.
///
/// Iterates the `rowHeights` map (keyed by RowId hex strings) and resolves
/// each RowId to its row index via the GridIndex. Returns
/// `(row_index, height)` pairs for all entries with non-default heights.
pub fn get_all_custom_row_heights(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(usize, Points)> {
    let gi = match grid_index {
        Some(g) => g,
        None => return vec![],
    };

    let txn = doc.transact();

    let row_heights_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (row_id_key, height_val) in row_heights_map.iter(&txn) {
        let height = match height_val {
            Out::Any(Any::Number(h)) => h,
            _ => continue,
        };

        // Resolve RowId hex to row index via GridIndex reverse lookup
        let position = match compute_document::hex::hex_to_id(row_id_key) {
            Some(raw) => {
                let rid = cell_types::RowId::from_raw(raw);
                match gi.row_index(&rid) {
                    Some(idx) => idx as usize,
                    None => continue,
                }
            }
            None => continue,
        };

        result.push((position, Points(height)));
    }

    result
}

/// Scan all custom column widths for a sheet from Yrs storage.
///
/// Iterates the `colWidths` map (keyed by ColId hex strings) and resolves
/// each ColId to its column index via the GridIndex. Returns
/// `(col_index, width)` pairs for all entries with non-default widths.
pub fn get_all_custom_col_widths(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(usize, CharWidth)> {
    let gi = match grid_index {
        Some(g) => g,
        None => return vec![],
    };

    let txn = doc.transact();

    let col_widths_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (col_id_key, width_val) in col_widths_map.iter(&txn) {
        let width = match width_val {
            Out::Any(Any::Number(w)) => w,
            _ => continue,
        };

        // Resolve ColId hex to column index via GridIndex reverse lookup
        let position = match compute_document::hex::hex_to_id(col_id_key) {
            Some(raw) => {
                let cid = cell_types::ColId::from_raw(raw);
                match gi.col_index(&cid) {
                    Some(idx) => idx as usize,
                    None => continue,
                }
            }
            None => continue,
        };

        result.push((position, CharWidth(width)));
    }

    result
}

/// Return the highest column index that has identities in the GridIndex.
///
/// In the new model all columns have IDs from creation, so this returns
/// `col_count - 1` (or `None` if no columns exist).
pub fn get_max_materialized_col(
    _doc: &Doc,
    _sheets: &MapRef,
    _sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Option<u32> {
    let gi = grid_index?;
    let count = gi.col_count();
    if count == 0 { None } else { Some(count - 1) }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::GridIndex;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use std::sync::Arc;

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a storage with one sheet ready for testing.
    fn setup() -> (YrsStorage, SheetId, GridIndex) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sid = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
            .unwrap();
        let id_alloc = Arc::new(cell_types::IdAllocator::new());
        let gi = GridIndex::new(sid, 100, 26, id_alloc);
        (storage, sid, gi)
    }

    // -------------------------------------------------------------------
    // Test 1: Set custom row height + get
    // -------------------------------------------------------------------

    #[test]
    fn test_set_custom_row_height_and_get() {
        let (mut storage, sid, gi) = setup();
        set_row_height(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            Points(30.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            Points(30.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 2: Get default row height (no custom set)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_default_row_height() {
        let (storage, sid, gi) = setup();
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            DEFAULT_ROW_HEIGHT
        );
    }

    // -------------------------------------------------------------------
    // Test 3: Reset to default removes entry
    // -------------------------------------------------------------------

    #[test]
    fn test_reset_row_height_to_default_removes_entry() {
        let (mut storage, sid, gi) = setup();

        // Set custom height
        set_row_height(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            Points(50.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            Points(50.0)
        );

        // Reset to default
        set_row_height(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            DEFAULT_ROW_HEIGHT,
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            DEFAULT_ROW_HEIGHT
        );
    }

    // -------------------------------------------------------------------
    // Test 4: Set custom col width + get
    // -------------------------------------------------------------------

    #[test]
    fn test_set_custom_col_width_and_get() {
        let (mut storage, sid, gi) = setup();
        set_col_width(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            CharWidth(120.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            CharWidth(120.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 5: Get default col width (no custom set)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_default_col_width() {
        let (storage, sid, gi) = setup();
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            DEFAULT_COL_WIDTH
        );
    }

    // -------------------------------------------------------------------
    // Test 6: Reset col width to default removes entry
    // -------------------------------------------------------------------

    #[test]
    fn test_reset_col_width_to_default_removes_entry() {
        let (mut storage, sid, gi) = setup();

        // Set custom width
        set_col_width(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            CharWidth(200.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            CharWidth(200.0)
        );

        // Reset to default
        set_col_width(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            DEFAULT_COL_WIDTH,
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
            DEFAULT_COL_WIDTH
        );
    }

    // -------------------------------------------------------------------
    // Test 7: Hide row + is_row_hidden
    // -------------------------------------------------------------------

    #[test]
    fn test_hide_row_and_is_row_hidden() {
        let (mut storage, sid, gi) = setup();

        assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
        hide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
        assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
    }

    // -------------------------------------------------------------------
    // Test 8: Hide already hidden row (no duplicate)
    // -------------------------------------------------------------------

    #[test]
    fn test_hide_already_hidden_row_no_duplicate() {
        let (mut storage, sid, gi) = setup();

        hide_rows(storage.doc(), storage.sheets(), &sid, &[5]);
        hide_rows(storage.doc(), storage.sheets(), &sid, &[5]); // Should be no-op

        let hidden = get_hidden_rows(storage.doc(), storage.sheets(), &sid);
        // Only one entry for row 5
        assert_eq!(hidden, vec![5]);
    }

    // -------------------------------------------------------------------
    // Test 9: Unhide row
    // -------------------------------------------------------------------

    #[test]
    fn test_unhide_row() {
        let (mut storage, sid, gi) = setup();

        hide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
        assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));

        unhide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
        assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
    }

    // -------------------------------------------------------------------
    // Test 10: Unhide non-hidden row (no-op)
    // -------------------------------------------------------------------

    #[test]
    fn test_unhide_non_hidden_row_is_noop() {
        let (mut storage, sid, gi) = setup();

        // Should not panic or error
        unhide_rows(storage.doc(), storage.sheets(), &sid, &[99]);
        assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 99));
    }

    // -------------------------------------------------------------------
    // Test 11: Get hidden rows (sorted)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_hidden_rows_sorted() {
        let (mut storage, sid, gi) = setup();

        hide_rows(storage.doc(), storage.sheets(), &sid, &[10, 3, 7, 1]);

        let hidden = get_hidden_rows(storage.doc(), storage.sheets(), &sid);
        assert_eq!(hidden, vec![1, 3, 7, 10]);
    }

    // -------------------------------------------------------------------
    // Test 12: Hide column + is_column_hidden
    // -------------------------------------------------------------------

    #[test]
    fn test_hide_column_and_is_column_hidden() {
        let (mut storage, sid, gi) = setup();

        assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 2));
        hide_columns(storage.doc(), storage.sheets(), &sid, &[2]);
        assert!(is_column_hidden(storage.doc(), storage.sheets(), &sid, 2));
    }

    // -------------------------------------------------------------------
    // Test 13: Unhide column
    // -------------------------------------------------------------------

    #[test]
    fn test_unhide_column() {
        let (mut storage, sid, gi) = setup();

        hide_columns(storage.doc(), storage.sheets(), &sid, &[4]);
        assert!(is_column_hidden(storage.doc(), storage.sheets(), &sid, 4));

        unhide_columns(storage.doc(), storage.sheets(), &sid, &[4]);
        assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 4));
    }

    // -------------------------------------------------------------------
    // Test 14: Get hidden columns (sorted)
    // -------------------------------------------------------------------

    #[test]
    fn test_get_hidden_columns_sorted() {
        let (mut storage, sid, gi) = setup();

        hide_columns(storage.doc(), storage.sheets(), &sid, &[8, 2, 5, 0]);

        let hidden = get_hidden_columns(storage.doc(), storage.sheets(), &sid);
        assert_eq!(hidden, vec![0, 2, 5, 8]);
    }

    // -------------------------------------------------------------------
    // Test 15: Hidden row returns 0.0 height
    // -------------------------------------------------------------------

    #[test]
    fn test_hidden_row_returns_zero_height() {
        let (mut storage, sid, gi) = setup();

        hide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
            Points(0.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 16: Hidden column returns 0.0 width
    // -------------------------------------------------------------------

    #[test]
    fn test_hidden_column_returns_zero_width() {
        let (mut storage, sid, gi) = setup();

        hide_columns(storage.doc(), storage.sheets(), &sid, &[2]);
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
            CharWidth(0.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 17: Multiple rows hidden/unhidden
    // -------------------------------------------------------------------

    #[test]
    fn test_multiple_rows_hidden_and_unhidden() {
        let (mut storage, sid, gi) = setup();

        hide_rows(storage.doc(), storage.sheets(), &sid, &[1, 3, 5, 7]);
        assert_eq!(
            get_hidden_rows(storage.doc(), storage.sheets(), &sid),
            vec![1, 3, 5, 7]
        );

        // Unhide some
        unhide_rows(storage.doc(), storage.sheets(), &sid, &[3, 7]);
        assert_eq!(
            get_hidden_rows(storage.doc(), storage.sheets(), &sid),
            vec![1, 5]
        );

        // Verify individual checks
        assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 1));
        assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
        assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 5));
        assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 7));
    }

    // -------------------------------------------------------------------
    // Test 18: Custom height on hidden row -- still 0 when hidden, restored when unhidden
    // -------------------------------------------------------------------

    #[test]
    fn test_custom_height_hidden_then_unhidden() {
        let (mut storage, sid, gi) = setup();

        // Set custom height
        set_row_height(
            storage.doc(),
            storage.sheets(),
            &sid,
            2,
            Points(45.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
            Points(45.0)
        );

        // Hide row -> height should be 0
        hide_rows(storage.doc(), storage.sheets(), &sid, &[2]);
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
            Points(0.0)
        );

        // Unhide row -> custom height should be restored
        unhide_rows(storage.doc(), storage.sheets(), &sid, &[2]);
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
            Points(45.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 19: Nonexistent sheet returns defaults
    // -------------------------------------------------------------------

    #[test]
    fn test_nonexistent_sheet_returns_defaults() {
        let storage = YrsStorage::new();
        let sid = make_sheet_id(999);

        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 0, None),
            DEFAULT_ROW_HEIGHT
        );
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 0, None),
            DEFAULT_COL_WIDTH
        );
        assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 0));
        assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 0));
        assert!(get_hidden_rows(storage.doc(), storage.sheets(), &sid).is_empty());
        assert!(get_hidden_columns(storage.doc(), storage.sheets(), &sid).is_empty());
    }

    // -------------------------------------------------------------------
    // Test 20: Set height for virtual row materializes it
    // -------------------------------------------------------------------

    #[test]
    fn test_set_height_for_row_in_range() {
        let (mut storage, sid, gi) = setup();

        // Row 50 is within GridIndex range (100 rows)
        assert!(gi.row_id(50).is_some());

        // Setting a custom height works
        set_row_height(
            storage.doc(),
            storage.sheets(),
            &sid,
            50,
            Points(25.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 50, Some(&gi)),
            Points(25.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 21: Set width for column in range
    // -------------------------------------------------------------------

    #[test]
    fn test_set_width_for_col_in_range() {
        let (mut storage, sid, gi) = setup();

        // Column 20 is within GridIndex range (26 cols)
        assert!(gi.col_id(20).is_some());

        // Setting a custom width works
        set_col_width(
            storage.doc(),
            storage.sheets(),
            &sid,
            20,
            CharWidth(100.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 20, Some(&gi)),
            CharWidth(100.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 22: Hide/unhide with empty array is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_hide_unhide_empty_array_noop() {
        let (mut storage, sid, gi) = setup();

        hide_rows(storage.doc(), storage.sheets(), &sid, &[]);
        unhide_rows(storage.doc(), storage.sheets(), &sid, &[]);
        hide_columns(storage.doc(), storage.sheets(), &sid, &[]);
        unhide_columns(storage.doc(), storage.sheets(), &sid, &[]);

        assert!(get_hidden_rows(storage.doc(), storage.sheets(), &sid).is_empty());
        assert!(get_hidden_columns(storage.doc(), storage.sheets(), &sid).is_empty());
    }

    // -------------------------------------------------------------------
    // Test 23: Custom width on hidden column -- still 0 when hidden, restored when unhidden
    // -------------------------------------------------------------------

    #[test]
    fn test_custom_width_hidden_then_unhidden() {
        let (mut storage, sid, gi) = setup();

        // Set custom width
        set_col_width(
            storage.doc(),
            storage.sheets(),
            &sid,
            3,
            CharWidth(150.0),
            Some(&gi),
        )
        .unwrap();
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
            CharWidth(150.0)
        );

        // Hide column -> width should be 0
        hide_columns(storage.doc(), storage.sheets(), &sid, &[3]);
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
            CharWidth(0.0)
        );

        // Unhide column -> custom width should be restored
        unhide_columns(storage.doc(), storage.sheets(), &sid, &[3]);
        assert_eq!(
            get_col_width(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
            CharWidth(150.0)
        );
    }

    // -------------------------------------------------------------------
    // Test 24: Multiple columns hidden/unhidden
    // -------------------------------------------------------------------

    #[test]
    fn test_multiple_columns_hidden_and_unhidden() {
        let (mut storage, sid, gi) = setup();

        hide_columns(storage.doc(), storage.sheets(), &sid, &[0, 2, 4, 6]);
        assert_eq!(
            get_hidden_columns(storage.doc(), storage.sheets(), &sid),
            vec![0, 2, 4, 6]
        );

        unhide_columns(storage.doc(), storage.sheets(), &sid, &[2, 6]);
        assert_eq!(
            get_hidden_columns(storage.doc(), storage.sheets(), &sid),
            vec![0, 4]
        );

        assert!(is_column_hidden(storage.doc(), storage.sheets(), &sid, 0));
        assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 2));
        assert!(is_column_hidden(storage.doc(), storage.sheets(), &sid, 4));
        assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 6));
    }

    // -------------------------------------------------------------------
    // Test 25: Set row height on nonexistent sheet returns error
    // -------------------------------------------------------------------

    #[test]
    fn test_set_row_height_nonexistent_sheet() {
        let mut storage = YrsStorage::new();
        let sid = make_sheet_id(999);

        let result = set_row_height(storage.doc(), storage.sheets(), &sid, 0, Points(30.0), None);
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Test 26: Set col width on nonexistent sheet returns error
    // -------------------------------------------------------------------

    #[test]
    fn test_set_col_width_nonexistent_sheet() {
        let mut storage = YrsStorage::new();
        let sid = make_sheet_id(999);

        let result = set_col_width(
            storage.doc(),
            storage.sheets(),
            &sid,
            0,
            CharWidth(100.0),
            None,
        );
        assert!(result.is_err());
    }

    // -------------------------------------------------------------------
    // Test 27: Hide rows on nonexistent sheet is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_hide_rows_nonexistent_sheet_noop() {
        let mut storage = YrsStorage::new();
        let sid = make_sheet_id(999);

        // Should not panic
        hide_rows(storage.doc(), storage.sheets(), &sid, &[0, 1, 2]);
        assert!(get_hidden_rows(storage.doc(), storage.sheets(), &sid).is_empty());
    }

    // -------------------------------------------------------------------
    // Test 28: Reset to default on unmaterialized row is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_reset_default_on_unmaterialized_row_noop() {
        let (mut storage, sid, gi) = setup();

        // Row 99 has an identity but no custom height — resetting to default should be harmless
        set_row_height(
            storage.doc(),
            storage.sheets(),
            &sid,
            99,
            DEFAULT_ROW_HEIGHT,
            Some(&gi),
        )
        .unwrap();

        // Row 99 has an identity in the GridIndex but no custom height stored
        assert_eq!(
            get_row_height(storage.doc(), storage.sheets(), &sid, 99, Some(&gi)),
            DEFAULT_ROW_HEIGHT
        );
    }
}
