use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::col_visibility::is_column_hidden;
use super::yrs_access::get_sheet_submap;
use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_COL_WIDTHS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::units::CharWidth;
use value_types::ComputeError;

/// Default column width in **character-width units** (OOXML standard for Calibri 11pt).
/// Prefer [`get_sheet_default_col_width`] which reads sheet metadata and falls
/// back to this value.
pub const DEFAULT_COL_WIDTH: CharWidth = CharWidth(8.43);

/// Set column width.
///
/// Resetting compares against sheet metadata default width and removes only an
/// existing custom width entry when a column identity already exists.
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
        if let Some(col_id) = col_hex {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            if let Some(col_widths_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_COL_WIDTHS) {
                col_widths_map.remove(&mut txn, &col_id);
            }
        }
        Ok(())
    } else {
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

/// Get column width for visual layout.
///
/// Hidden columns and columns hidden by collapsed outline groups return zero.
pub fn get_col_width(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> CharWidth {
    if is_column_hidden(doc, sheets, sheet_id, col)
        || !super::super::grouping::is_column_visible_by_groups(doc, sheets, sheet_id, col)
    {
        return CharWidth(0.0);
    }

    get_col_width_with_default(doc, sheets, sheet_id, col, DEFAULT_COL_WIDTH, grid_index)
}

/// Get the stored column width, ignoring hidden state.
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

/// Like [`get_col_width`] but uses a caller-supplied default instead of
/// reading sheet metadata per column.
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
        || !super::super::grouping::is_column_visible_by_groups(doc, sheets, sheet_id, col)
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
pub fn get_sheet_default_col_width(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> CharWidth {
    super::super::properties::get_sheet_meta(doc, sheets, sheet_id)
        .map(|m| CharWidth(m.default_col_width))
        .unwrap_or(DEFAULT_COL_WIDTH)
}
