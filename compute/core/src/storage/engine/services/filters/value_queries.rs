use crate::mirror::CellMirror;
use crate::storage::engine::services::resolved_formats;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;
use cell_types::{SheetId, SheetPos};
use value_types::{CellValue, DateSystem};

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
        &stores.storage,
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
    let filter = crate::storage::engine::services::imported_filter_runtime::project_imported_date_group_filters_for_evaluation(
        stores, mirror, sheet_id, filter_id,
    );
    let sid = *sheet_id;
    let icons = crate::storage::engine::services::cf_cache::evaluate_filter_icons(
        stores, mirror, sheet_id, filter_id,
    );
    let results = filters::evaluate_filter_state_with_date_system(
        filter.as_ref(),
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
        |row, col| icons.get(&(row, col)).cloned(),
        |hex| super::resolve_filter_cell_pos(stores, mirror, sheet_id, hex),
        DateSystem::from_date1904(mirror.date1904),
    );
    if results.is_empty() {
        return None;
    }
    Some(filters::FilterRecordCount {
        visible: results.iter().filter(|row| row.matches).count(),
        total: results.len(),
    })
}
