use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::row_visibility::is_row_hidden;
use super::yrs_access::get_sheet_submap;
use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_ROW_HEIGHTS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::units::Points;
use value_types::ComputeError;

/// Default row height in **points** (OOXML standard for Calibri 11pt).
/// The layout engine converts to pixels via `points_to_pixels()`.
pub const DEFAULT_ROW_HEIGHT: Points = Points(15.0);

/// Set row height.
///
/// If `height` equals [`DEFAULT_ROW_HEIGHT`], removes the custom height entry
/// only if the row is already materialized. Otherwise stores a custom height
/// for an existing stable row identity.
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
        if let Some(row_id) = row_hex {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            if let Some(row_heights_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_ROW_HEIGHTS)
            {
                row_heights_map.remove(&mut txn, &row_id);
            }
        }
        Ok(())
    } else {
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

/// Get row height for visual layout.
///
/// Hidden rows and rows hidden by collapsed outline groups return zero.
pub fn get_row_height(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Points {
    if is_row_hidden(doc, sheets, sheet_id, row)
        || !super::super::grouping::is_row_visible_by_groups(doc, sheets, sheet_id, row)
    {
        return Points(0.0);
    }

    get_row_height_stored(doc, sheets, sheet_id, row, grid_index)
}

/// Get the stored row height, ignoring hidden state.
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
