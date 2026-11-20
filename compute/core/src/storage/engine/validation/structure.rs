use cell_types::{SheetId, SheetRange};
use domain_types::units::{CharWidth, Points};
use value_types::ComputeError;

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;

const MAX_ROW_HEIGHT_PT: f64 = 409.0;
const MAX_COL_WIDTH_CHARS: f64 = 255.0;

/// Validate the inserted span without overflowing the coordinate arithmetic.
pub fn validate_insert_bounds(at: u32, count: u32, limit: u32) -> Result<(), ComputeError> {
    if at.checked_add(count).is_none_or(|end| end > limit) {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Insertion at {at} with count {count} exceeds worksheet limit {limit}"
            ),
        });
    }
    Ok(())
}

/// Reject occupied cells in the band that would be pushed off the worksheet.
/// Check native payloads, deferred formulas, and sparse styles before hydration
/// or history capture. Allocated empty identities alone do not occupy a cell.
pub(in crate::storage::engine) fn validate_insert_tail(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    tail: SheetRange,
    shift_right: bool,
    whole_axis: bool,
) -> Result<(), ComputeError> {
    let sheet = cell_store
        .get_sheet(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    let scope = (
        tail.start_row(),
        tail.start_col(),
        tail.end_row(),
        tail.end_col(),
    );
    let metadata = stores.storage.sheet_metadata.get(sheet_id);
    let occupied = sheet
        .dense_content_bounds_in_range(&cell_store.cells, &cell_store.formulas, scope)
        .is_some()
        || sheet
            .cells_in_range(scope.0, scope.1, scope.2, scope.3)
            .any(|(id, _, _)| {
                !cell_store.is_ghost(&id)
                    || stores.compute.get_formula(&id).is_some()
                    || metadata.is_some_and(|meta| meta.cell_properties.contains_key(&id))
                    || stores.storage.cell_metadata.contains_key(&id)
            })
        || sheet.format_ranges().iter().any(|range| {
            tail.intersection(&SheetRange::new(
                range.start_row,
                range.start_col,
                range.end_row,
                range.end_col,
            ))
            .is_some()
        });
    // Whole-axis defaults move only along their own axis. A column default
    // does not occupy the final row for a whole-row insertion, and vice versa.
    let grid = stores.grid_indexes.get(sheet_id);
    let axis_format = whole_axis
        && if shift_right {
            properties::get_all_col_formats(&stores.storage, sheet_id, grid)
                .iter()
                .any(|entry| entry.col >= tail.start_col())
                || sheet
                    .col_format_ranges()
                    .iter()
                    .any(|range| range.end_col >= tail.start_col())
        } else {
            properties::get_all_row_formats(&stores.storage, sheet_id, grid)
                .iter()
                .any(|entry| entry.row >= tail.start_row())
        };
    if occupied || axis_format {
        return Err(ComputeError::InvalidInput {
            message: "Cannot insert cells: existing cells or formatting would move beyond worksheet bounds".into(),
        });
    }
    Ok(())
}

pub fn validate_delete_bounds(at: u32, count: u32, current_count: u32) -> Result<(), ComputeError> {
    if at + count > current_count {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Cannot delete {} rows/cols from index {}: only {} exist",
                count, at, current_count
            ),
        });
    }
    Ok(())
}

pub fn validate_row_height(height: Points) -> Result<(), ComputeError> {
    if height.0 <= 0.0 || height.0 > MAX_ROW_HEIGHT_PT {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Row height must be 0-{} points, got {}",
                MAX_ROW_HEIGHT_PT, height.0
            ),
        });
    }
    Ok(())
}

pub fn validate_col_width(width: CharWidth) -> Result<(), ComputeError> {
    if width.0 <= 0.0 || width.0 > MAX_COL_WIDTH_CHARS {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Column width must be 0-{} characters, got {}",
                MAX_COL_WIDTH_CHARS, width.0
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_delete_overflow() {
        assert!(validate_delete_bounds(5, 10, 8).is_err());
    }

    #[test]
    fn accepts_valid_delete() {
        assert!(validate_delete_bounds(5, 3, 8).is_ok());
        assert!(validate_delete_bounds(0, 8, 8).is_ok());
    }

    #[test]
    fn rejects_zero_row_height() {
        assert!(validate_row_height(Points(0.0)).is_err());
        assert!(validate_row_height(Points(-1.0)).is_err());
    }

    #[test]
    fn rejects_excessive_row_height() {
        assert!(validate_row_height(Points(410.0)).is_err());
    }

    #[test]
    fn accepts_valid_row_height() {
        assert!(validate_row_height(Points(0.5)).is_ok());
        assert!(validate_row_height(Points(20.0)).is_ok());
        assert!(validate_row_height(Points(409.0)).is_ok());
    }

    #[test]
    fn rejects_zero_col_width() {
        assert!(validate_col_width(CharWidth(0.0)).is_err());
        assert!(validate_col_width(CharWidth(-5.0)).is_err());
    }

    #[test]
    fn rejects_excessive_col_width() {
        assert!(validate_col_width(CharWidth(256.0)).is_err());
    }

    #[test]
    fn accepts_valid_col_width() {
        assert!(validate_col_width(CharWidth(0.5)).is_ok());
        assert!(validate_col_width(CharWidth(8.43)).is_ok());
        assert!(validate_col_width(CharWidth(255.0)).is_ok());
    }
}
