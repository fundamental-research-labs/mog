use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use cell_types::{CellId, SheetId};
use domain_types::CellFormat;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
) {
    properties::set_cell_format_by_id(&mut stores.storage, sheet_id, cell_id, format);
}

pub(in crate::storage::engine) fn patch_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &CellId,
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), ComputeError> {
    properties::patch_cell_format_by_id(
        &mut stores.storage,
        sheet_id,
        cell_id,
        format,
        clear_fields,
    )
}

pub(in crate::storage::engine) fn clear_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_id: &CellId,
) {
    properties::clear_cell_format_by_id(&mut stores.storage, sheet_id, cell_id);
}
