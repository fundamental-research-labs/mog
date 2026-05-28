use cell_types::SheetId;
use domain_types::{ColStyleEntry, RowStyleEntry};

use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;

use super::super::PaletteOps;
use super::style_ids::style_id_for_cell_format;

pub(in crate::storage::engine) fn export_row_col_styles_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
    _max_row: u32,
    _max_col: u32,
    palette: &impl PaletteOps,
) -> (Vec<RowStyleEntry>, Vec<ColStyleEntry>) {
    let Some(grid_index) = stores.grid_indexes.get(sheet_id) else {
        return (Vec::new(), Vec::new());
    };

    // Batch-read all row formats in one transaction
    let all_row_fmts = properties::get_all_row_formats(&stores.storage, sheet_id, Some(grid_index));
    let mut row_styles = Vec::with_capacity(all_row_fmts.len());
    for entry in all_row_fmts {
        if let Some(fmt) = entry.format
            && let Some(style_id) = style_id_for_cell_format(&fmt, palette)
        {
            row_styles.push(RowStyleEntry {
                row: entry.row,
                style_id,
            });
        }
    }

    // Batch-read all column formats in one transaction
    let all_col_fmts = properties::get_all_col_formats(&stores.storage, sheet_id, Some(grid_index));
    let mut col_styles = Vec::with_capacity(all_col_fmts.len());
    for entry in all_col_fmts {
        if let Some(fmt) = entry.format
            && let Some(style_id) = style_id_for_cell_format(&fmt, palette)
        {
            col_styles.push(ColStyleEntry {
                col: entry.col,
                style_id,
            });
        }
    }

    (row_styles, col_styles)
}
