use cell_types::SheetId;
use compute_wire::{
    CellCFExtras, FormatPalette, RenderColDimension, RenderRowDimension, RenderViewportMerge,
    ViewportRenderCell, ViewportRenderData,
};

use super::cf_extras::{data_bar_to_render, icon_to_render};
use super::render_cells::build_render_cell_materials;
use crate::mirror::CellMirror;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::{CFCacheEntry, EngineStores};
use crate::storage::sheet::{dimensions, merges};

pub(in crate::storage::engine::viewport) fn build_viewport_render_data_inner(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    palette: &mut FormatPalette,
    cf_cache_entry: Option<&CFCacheEntry>,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    palette_start_index: u16,
    show_formulas: bool,
    resolve_table_format: &dyn Fn(&SheetId, u32, u32) -> Option<domain_types::CellFormat>,
) -> ViewportRenderData {
    let rows = end_row - start_row;
    let cols = end_col - start_col;

    let cells = build_render_cell_materials(
        stores,
        mirror,
        settings,
        cf_cache_entry,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        rows,
        cols,
        show_formulas,
        resolve_table_format,
    );

    // Now intern formats into the palette (mirror borrow released above).
    let mut render_cells: Vec<ViewportRenderCell> = cells
        .into_iter()
        .map(|cell| {
            let format_idx = palette.intern(&cell.format).unwrap_or(0);
            ViewportRenderCell {
                row: cell.row,
                col: cell.col,
                format_idx,
                flags: cell.flags,
                number_value: cell.number_value,
                formatted: cell.formatted,
                error: cell.error,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }
        })
        .collect();
    let format_palette = palette.formats_since(palette_start_index).to_vec();

    // --- CF extras only (data bars, icons) — style is already merged into CellFormat palette ---
    if let Some(cache_entry) = cf_cache_entry {
        for cell in &mut render_cells {
            if let Some(cf_result) = cache_entry.results.get(&(cell.row, cell.col)) {
                let has_data_bar = cf_result.data_bar.is_some();
                let has_icon = cf_result.icon.is_some();
                if has_data_bar || has_icon {
                    cell.cf_extras = Some(CellCFExtras {
                        data_bar: cf_result.data_bar.as_ref().map(data_bar_to_render),
                        icon: cf_result.icon.as_ref().map(icon_to_render),
                    });
                }
            }
        }
    }

    // --- Merges ---
    let render_merges: Vec<RenderViewportMerge> = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_merges_in_viewport(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        )
        .into_iter()
        .map(|r| RenderViewportMerge {
            start_row: r.start_row,
            start_col: r.start_col,
            end_row: r.end_row,
            end_col: r.end_col,
        })
        .collect(),
        None => Vec::new(),
    };

    // --- Row dimensions (pixels from LayoutIndex) ---
    let layout_index = stores.layout_indexes.get(sheet_id);
    let row_dimensions: Vec<RenderRowDimension> = (start_row..end_row)
        .map(|row| {
            let hidden = dimensions::is_row_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                row,
            );
            let height = layout_index
                .map(|li| li.get_row_height(row as usize))
                .unwrap_or(compute_layout_index::DEFAULT_ROW_HEIGHT);
            RenderRowDimension {
                row,
                height: if hidden { 0.0 } else { height.0 as f32 },
                hidden,
            }
        })
        .collect();

    // --- Column dimensions (pixels from LayoutIndex) ---
    let col_dimensions: Vec<RenderColDimension> = (start_col..end_col)
        .map(|col| {
            let hidden = dimensions::is_column_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                col,
            );
            let width = layout_index
                .map(|li| li.get_col_width(col as usize))
                .unwrap_or_else(compute_layout_index::platform_default_col_width);
            RenderColDimension {
                col,
                width: if hidden { 0.0 } else { width.0 as f32 },
                hidden,
            }
        })
        .collect();

    // --- Position arrays ---
    let row_positions = stores
        .layout_indexes
        .get(sheet_id)
        .map(|li| li.build_row_positions(start_row as usize, end_row as usize))
        .unwrap_or_default();
    let col_positions = stores
        .layout_indexes
        .get(sheet_id)
        .map(|li| li.build_col_positions(start_col as usize, end_col as usize))
        .unwrap_or_default();

    ViewportRenderData {
        cells: render_cells,
        format_palette,
        merges: render_merges,
        row_dimensions,
        col_dimensions,
        viewport_rows: rows,
        viewport_cols: cols,
        start_row,
        start_col,
        row_positions,
        col_positions,
    }
}
