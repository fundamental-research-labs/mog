use super::*;

/// Create the filter that belongs to a newly installed native table.
pub(in crate::storage::engine) fn create_table_filter(
    stores: &mut EngineStores,
    table: &CanonicalTable,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
) -> Result<filters::FilterState, ComputeError> {
    filters::create_filter(
        &mut stores.storage,
        sheet_id,
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        filters::FilterKind::TableFilter,
        Some(table.id.clone()),
        &stores.id_alloc,
    )
}

pub(in crate::storage::engine) fn remove_table_filter(
    stores: &mut EngineStores,
    table_filter: Option<&(SheetId, String)>,
) -> Vec<(u32, bool)> {
    let Some((sheet_id, filter_id)) = table_filter else {
        return Vec::new();
    };
    let grid_index = stores.grid_indexes.get(sheet_id);
    filters::delete_filter(&mut stores.storage, sheet_id, filter_id);
    filters::delete_filter_metadata_binding(&mut stores.storage, sheet_id, filter_id);
    crate::storage::sheet::dimensions::clear_filter_hidden_rows(
        &mut stores.storage,
        sheet_id,
        filter_id,
        grid_index,
    )
}
