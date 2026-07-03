use crate::mirror::CellMirror;
use crate::storage::engine::services::resolved_formats;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;
use cell_types::{SheetId, SheetPos};
use value_types::CellValue;

pub(super) fn get_unique_column_values(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) -> Vec<CellValue> {
    let header_cell_id =
        match super::resolve_header_col(stores, mirror, sheet_id, filter_id, header_col) {
            Some(id) => id,
            None => return vec![],
        };
    let sid = *sheet_id;
    filters::get_unique_values(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        &header_cell_id,
        |row, col| {
            let pos = SheetPos::new(row, col);
            mirror
                .get_cell_value_at(&sid, pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        },
        |hex| super::resolve_filter_cell_pos(stores, mirror, sheet_id, hex),
    )
}

pub(super) fn get_filtered_record_count(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<filters::FilterRecordCount> {
    let sid = *sheet_id;
    filters::get_filtered_record_count(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
        |row, col| {
            let pos = SheetPos::new(row, col);
            mirror
                .get_cell_value_at(&sid, pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        },
        |row, col| {
            resolved_formats::get_resolved_cell_format(stores, mirror, settings, sheet_id, row, col)
        },
        |hex| super::resolve_filter_cell_pos(stores, mirror, sheet_id, hex),
    )
}
