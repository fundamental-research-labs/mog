use crate::cells::CellStore;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::engine::viewport;
use cell_types::{SheetId, SheetPos};
use domain_types::CellFormat;

pub(in crate::storage::engine) fn get_resolved_cell_format(
    stores: &EngineStores,
    cell_store: &CellStore,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellFormat {
    let grid_index = stores.grid_indexes.get(sheet_id);
    let cell_id = cell_store.resolve_cell_id(sheet_id, SheetPos::new(row, col));

    let mut format = if let Some(cell_id) = cell_id {
        let table_format = super::resolve_structured_format_at_cell(cell_store, sheet_id, row, col);
        crate::storage::properties::get_effective_format_by_id(
            &stores.storage,
            sheet_id,
            Some(&cell_id),
            row,
            col,
            table_format.as_ref(),
            grid_index,
            cell_store.get_sheet(sheet_id),
        )
    } else {
        crate::storage::properties::get_positional_format(
            &stores.storage,
            sheet_id,
            row,
            col,
            grid_index,
            cell_store.get_sheet(sheet_id),
        )
    };

    domain_types::theme_color::resolve_theme_refs(&mut format, &settings.theme_palette);

    if let Some(cache_entry) = stores.cf_cache.get(sheet_id)
        && let Some(cf_result) = cache_entry.results.get(&(row, col))
    {
        viewport::merge_cf_into_format(&mut format, cf_result);
    }

    format
}
