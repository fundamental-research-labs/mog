use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use cell_types::SheetId;
use domain_types::CellFormat;

pub(in crate::storage::engine) fn set_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_hex: &str,
    format: &CellFormat,
) {
    properties::set_cell_format(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
        cell_hex,
        format,
    );
}

pub(in crate::storage::engine) fn clear_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_hex: &str,
) {
    properties::clear_cell_format(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
        cell_hex,
    );
}
