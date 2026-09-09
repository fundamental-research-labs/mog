use cell_types::SheetId;
use domain_types::{CellFormat, DocumentFormat};

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;

use super::super::super::super::export::cell_format_to_document_format;
use super::super::PaletteOps;

pub(super) fn style_id_for_cell_format(
    format: &CellFormat,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let doc_fmt = cell_format_to_document_format(format);
    if doc_fmt == DocumentFormat::default() {
        return None;
    }
    Some(palette.get_or_insert(doc_fmt))
}

pub(super) fn positional_style_id_at(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let sheet = cell_store.get_sheet(sheet_id)?;
    let matching = sheet.format_ranges_at(row, col);
    if matching.is_empty() {
        let grid = stores.grid_indexes.get(sheet_id);
        let metadata = stores.storage.sheet_metadata.get(sheet_id);
        let native_axis_format = metadata.is_some_and(|metadata| {
            grid.and_then(|grid| grid.row_id(row))
                .and_then(|id| metadata.dimensions.rows.get(&id))
                .is_some_and(|record| record.format.is_some())
                || grid
                    .and_then(|grid| grid.col_id(col))
                    .and_then(|id| metadata.dimensions.columns.get(&id))
                    .is_some_and(|record| record.format.is_some())
        });
        let native_column_range = sheet
            .col_format_ranges_at(col)
            .iter()
            .any(|(id, _)| !sheet.col_range_xlsx_style_id_cache().contains_key(id));
        if !native_axis_format && !native_column_range {
            return None;
        }
        return resolved_range_style_id(stores, cell_store, sheet_id, row, col, false, palette);
    }

    if matching
        .iter()
        .any(|(id, _)| !sheet.range_xlsx_style_id_cache().contains_key(id))
    {
        return resolved_range_style_id(stores, cell_store, sheet_id, row, col, false, palette);
    }
    let (range_id, format) = matching.last()?;
    sheet
        .range_xlsx_style_id_cache()
        .get(range_id)
        .copied()
        .or_else(|| style_id_for_cell_format(format, palette))
}
pub(super) fn resolved_range_style_id(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    include_imported_column_ranges: bool,
    palette: &impl PaletteOps,
) -> Option<u32> {
    use crate::storage::properties;
    let grid = stores.grid_indexes.get(sheet_id);
    let base = properties::get_workbook_base_format(&stores.storage);
    let column = properties::get_col_format(&stores.storage, sheet_id, col, grid);
    let row_format = properties::get_row_format(&stores.storage, sheet_id, row, grid);
    let table =
        super::super::super::resolve_structured_format_at_cell(cell_store, sheet_id, row, col);
    let format = properties::get_effective_format_from_preloaded_layers(
        &base,
        column.as_ref(),
        row_format.as_ref(),
        row,
        col,
        table.as_ref(),
        None,
        cell_store.get_sheet(sheet_id),
        include_imported_column_ranges,
    );
    style_id_for_cell_format(&format, palette)
}
