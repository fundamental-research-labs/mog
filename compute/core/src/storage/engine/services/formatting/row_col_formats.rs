use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use cell_types::SheetId;
use domain_types::CellFormat;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_row_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    properties::set_row_format(
        &mut stores.storage,
        sheet_id,
        row,
        format,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn set_col_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    properties::set_col_format(
        &mut stores.storage,
        sheet_id,
        col,
        format,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}
