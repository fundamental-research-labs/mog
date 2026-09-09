use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::units::Points;
use value_types::ComputeError;

pub const DEFAULT_ROW_HEIGHT: Points = Points(15.0);

pub fn set_row_height(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    height: Points,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let default = get_sheet_default_row_height(storage, sheet_id);
    let Some(id) = grid_index.and_then(|grid| grid.row_id(row)) else {
        return if height == default {
            Ok(())
        } else {
            Err(ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })
        };
    };
    crate::storage::engine::history::metadata::capture_row(storage, *sheet_id, id);
    let meta =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    let record = meta.dimensions.rows.entry(id).or_default();
    record.height = (height != default).then_some(height);
    record.height_str = None;
    record.custom_height = height != default;
    Ok(())
}

pub fn get_row_height(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Points {
    if super::is_row_hidden(storage, sheet_id, row, grid_index)
        || !super::super::grouping::is_row_visible_by_groups(storage, sheet_id, row)
    {
        return Points(0.0);
    }
    get_row_height_stored(storage, sheet_id, row, grid_index)
}

pub fn get_row_height_stored(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Points {
    get_row_height_explicit(storage, sheet_id, row, grid_index)
        .unwrap_or_else(|| get_sheet_default_row_height(storage, sheet_id))
}

pub fn get_row_height_explicit(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Option<Points> {
    let id = grid_index?.row_id(row)?;
    storage
        .sheet_metadata
        .get(sheet_id)?
        .dimensions
        .rows
        .get(&id)?
        .height
}

pub fn get_sheet_default_row_height(storage: &WorkbookStorage, sheet_id: &SheetId) -> Points {
    storage
        .sheet_metadata
        .get(sheet_id)
        .and_then(|meta| meta.format.default_row_height)
        .map(Points)
        .unwrap_or(DEFAULT_ROW_HEIGHT)
}
