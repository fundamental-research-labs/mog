use value_types::Color;

use super::borders::{add_edge_borders, medium_border, thin_border};
use super::{DEFAULT_STYLE_ID, builtins};
use crate::types::{BorderDef, Table, TableCellFormat};

pub fn resolve_table_cell_format(table: &Table, row: u32, col: u32) -> Option<TableCellFormat> {
    let range = &table.range;

    // 1. Outside table -> None
    if row < range.start_row()
        || row > range.end_row()
        || col < range.start_col()
        || col > range.end_col()
    {
        return None;
    }

    // 2. Look up style definition
    let style_def = builtins::get(&table.style)
        .or_else(|| builtins::get(DEFAULT_STYLE_ID))
        .expect("DEFAULT_STYLE_ID must exist in BUILT_IN_STYLES");

    // Position calculations
    let col_index = col - range.start_col();
    let is_first_col = col_index == 0;
    let is_last_col = col_index == (table.columns.len() as u32).saturating_sub(1);

    let is_on_left_edge = col == range.start_col();
    let is_on_right_edge = col == range.end_col();
    let is_on_top_edge = row == range.start_row();

    // Region detection
    let is_header = table.has_header_row && row == range.start_row();
    let is_totals = table.has_totals_row && row == range.end_row();

    // Data area boundaries
    let data_start_row = range.start_row() + if table.has_header_row { 1 } else { 0 };
    let data_end_row = if table.has_totals_row {
        range.end_row().saturating_sub(1)
    } else {
        range.end_row()
    };
    let data_row_index = row.wrapping_sub(data_start_row);
    let is_in_data = !is_header && !is_totals && row >= data_start_row && row <= data_end_row;

    let border_color = style_def.border_color.unwrap_or(Color::BLACK);

    // ── Header row ──
    if is_header {
        let mut fmt = TableCellFormat {
            fill: style_def.header_fill,
            font_color: style_def.header_font_color,
            font_bold: Some(true),
            border_bottom: Some(medium_border(border_color)),
            border_top: Some(thin_border(border_color)),
            border_left: None,
            border_right: None,
        };
        add_edge_borders(
            &mut fmt,
            is_on_left_edge,
            is_on_right_edge,
            false,
            false,
            border_color,
        );
        return Some(fmt);
    }

    // ── Totals row ──
    if is_totals {
        let mut fmt = TableCellFormat {
            fill: style_def.totals_fill,
            font_color: style_def.totals_font_color,
            font_bold: Some(true),
            border_top: Some(medium_border(border_color)),
            border_bottom: Some(thin_border(border_color)),
            border_left: None,
            border_right: None,
        };
        add_edge_borders(
            &mut fmt,
            is_on_left_edge,
            is_on_right_edge,
            false,
            false,
            border_color,
        );
        return Some(fmt);
    }

    // ── Data area ──
    if !is_in_data {
        // Should not reach here, but defensive
        return Some(TableCellFormat {
            fill: None,
            font_color: None,
            font_bold: None,
            border_top: None,
            border_bottom: None,
            border_left: None,
            border_right: None,
        });
    }

    let mut fill: Option<Color>;
    let mut font_color: Option<Color> = style_def.data_font_color;
    let mut font_bold: Option<bool> = None;
    let mut column_band_border: Option<BorderDef> = None;

    // 6. Row banding (lowest priority for data area fill)
    // BUG FIX: When banding is OFF, data cells get NO fill (None).
    if table.banded_rows {
        let is_odd_row = data_row_index.is_multiple_of(2); // 0-based: row 0 = "odd" (first band)
        fill = if is_odd_row {
            style_def.odd_row_fill
        } else {
            style_def.even_row_fill
        };
    } else {
        // BUG FIX: No fill when banding is disabled
        fill = None;
    }

    // 5. Column banding
    if table.banded_columns {
        let is_odd_col = col_index.is_multiple_of(2);
        if !table.banded_rows {
            // Column banding only: set fill from column band
            fill = if is_odd_col {
                style_def.odd_col_fill
            } else {
                style_def.even_col_fill
            };
        } else {
            // Both enabled: row banding keeps fill, column banding adds border at transitions
            if !is_odd_col && col_index > 0 {
                column_band_border = Some(thin_border(border_color));
            }
        }
    }

    // 4. Last column emphasis
    if table.emphasize_last_column && is_last_col {
        fill = style_def.last_column_fill;
        font_color = style_def.last_column_font_color;
        font_bold = Some(true);
    }

    // 3. First column emphasis (higher priority than last column for single-column table)
    if table.emphasize_first_column && is_first_col {
        fill = style_def.first_column_fill;
        font_color = style_def.first_column_font_color;
        font_bold = Some(true);
    }

    let is_last_data_row = row == data_end_row;

    let mut fmt = TableCellFormat {
        fill,
        font_color,
        font_bold,
        border_top: None,
        border_bottom: None,
        border_left: column_band_border,
        border_right: None,
    };

    // Bottom border for last data row (table bottom when no totals)
    if is_last_data_row && !table.has_totals_row {
        fmt.border_bottom = Some(thin_border(border_color));
    }

    // Edge borders
    let top_edge = is_on_top_edge && !table.has_header_row;
    add_edge_borders(
        &mut fmt,
        is_on_left_edge,
        is_on_right_edge,
        top_edge,
        false,
        border_color,
    );

    Some(fmt)
}
