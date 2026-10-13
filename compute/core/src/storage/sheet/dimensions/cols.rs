use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::units::CharWidth;
use value_types::ComputeError;

pub const DEFAULT_COL_WIDTH: CharWidth = domain_types::units::DEFAULT_COL_WIDTH;

pub fn set_col_width(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    width: CharWidth,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    set_col_width_with_origin(storage, sheet_id, col, width, grid_index, false)
}

pub fn set_col_width_from_pixels(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    width: CharWidth,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    set_col_width_with_origin(storage, sheet_id, col, width, grid_index, true)
}

fn set_col_width_with_origin(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    width: CharWidth,
    grid_index: Option<&GridIndex>,
    width_from_pixels: bool,
) -> Result<(), ComputeError> {
    let default = get_sheet_default_col_width(storage, sheet_id);
    let Some(id) = grid_index.and_then(|grid| grid.col_id(col)) else {
        return if width == default {
            Ok(())
        } else {
            Err(ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })
        };
    };
    crate::storage::engine::history::metadata::capture_column(storage, *sheet_id, id);
    let meta =
        storage
            .sheet_metadata
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    let record = meta.dimensions.columns.entry(id).or_default();
    // A pixel write is explicit even when its host width equals the sheet default.
    // XLSX may use a different Normal-font metric, so do not erase its provenance.
    record.width = (width_from_pixels || width != default).then_some(width);
    record.width_from_pixels = width_from_pixels;
    record.width_str = None;
    record.custom_width = record.width.is_some();
    record.width_present = record.width.map(|_| true);
    record.custom_width_attr = record.custom_width.then_some(true);
    Ok(())
}

pub fn get_col_width(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> CharWidth {
    if super::is_column_hidden(storage, sheet_id, col, grid_index)
        || !super::super::grouping::is_column_visible_by_groups(storage, sheet_id, col)
    {
        return CharWidth(0.0);
    }
    get_col_width_stored(storage, sheet_id, col, grid_index)
}

pub fn get_col_width_stored(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> CharWidth {
    get_col_width_explicit(storage, sheet_id, col, grid_index)
        .unwrap_or_else(|| get_sheet_default_col_width(storage, sheet_id))
}

pub fn get_col_width_explicit(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> Option<CharWidth> {
    get_col_width_by_id(storage, sheet_id, grid_index?.col_id(col)?)
}

pub(crate) fn get_col_width_by_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    id: cell_types::ColId,
) -> Option<CharWidth> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .dimensions
        .columns
        .get(&id)?
        .width
}

pub fn get_sheet_default_col_width(storage: &WorkbookStorage, sheet_id: &SheetId) -> CharWidth {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| meta.format.effective_default_col_width())
        .unwrap_or(DEFAULT_COL_WIDTH)
}
