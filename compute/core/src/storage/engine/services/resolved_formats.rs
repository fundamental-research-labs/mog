use crate::mirror::CellMirror;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::engine::viewport;
use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use domain_types::CellFormat;

pub(in crate::storage::engine) fn get_resolved_cell_format(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellFormat {
    let grid_index = stores.grid_indexes.get(sheet_id);
    let cell_id = grid_index
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col)));

    let mut format = if let Some(cell_id) = cell_id {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let table_format = super::resolve_structured_format_at_cell(mirror, sheet_id, row, col);
        crate::storage::properties::get_effective_format(
            &stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            table_format.as_ref(),
            grid_index,
            mirror.get_sheet(sheet_id),
        )
    } else {
        crate::storage::properties::get_positional_format(
            &stores.storage,
            sheet_id,
            row,
            col,
            grid_index,
            mirror.get_sheet(sheet_id),
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
