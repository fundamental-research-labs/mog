//! Table Styles — Pure computation for table cell format resolution.
//!
//! Every function is PURE and STATELESS. No DOM, no Yjs, no React.
//!
//! Contains all 67 built-in Excel table style definitions (28 Light, 28 Medium, 11 Dark).
//! Resolves per-cell formatting based on table configuration and style definitions.

use std::collections::HashMap;
use std::sync::LazyLock;

use value_types::Color;

use super::types::{BorderDef, BorderStyle, Table, TableCellFormat, TableStyleDef};

// =============================================================================
// Default style
// =============================================================================

/// Default style used when the table's style ID is not found.
pub const DEFAULT_STYLE_ID: &str = "TableStyleMedium2";

// =============================================================================
// Built-in Style Definitions (67 styles: 28 Light + 28 Medium + 11 Dark)
// =============================================================================

/// Helper to create a TableStyleDef from the raw color data.
///
/// Maps:
///   headerBackground  -> header_fill
///   headerText        -> header_font_color
///   totalBackground   -> totals_fill
///   totalText         -> totals_font_color
///   columnHighlight   -> first_column_fill / last_column_fill (with headerBackground fallback)
///   headerText        -> first_column_font_color / last_column_font_color
///   rowBackground1    -> odd_row_fill  (also odd_col_fill)
///   rowBackground2    -> even_row_fill (also even_col_fill)
///   dataText          -> data_font_color
///   borderColor       -> border_color
fn hex(s: &str) -> Color {
    Color::from_hex(s).unwrap()
}

#[allow(clippy::too_many_arguments)]
fn def(
    id: &str,
    name: &str,
    header_background: &str,
    header_text: &str,
    row_background1: &str,
    row_background2: &str,
    data_text: &str,
    total_background: &str,
    total_text: &str,
    border_color: &str,
    column_highlight: Option<&str>,
) -> (String, TableStyleDef) {
    let col_fill = column_highlight.unwrap_or(header_background);
    (
        id.to_string(),
        TableStyleDef {
            id: id.to_string(),
            name: name.to_string(),
            header_fill: Some(hex(header_background)),
            header_font_color: Some(hex(header_text)),
            totals_fill: Some(hex(total_background)),
            totals_font_color: Some(hex(total_text)),
            first_column_fill: Some(hex(col_fill)),
            first_column_font_color: Some(hex(header_text)),
            last_column_fill: Some(hex(col_fill)),
            last_column_font_color: Some(hex(header_text)),
            odd_row_fill: Some(hex(row_background1)),
            even_row_fill: Some(hex(row_background2)),
            odd_col_fill: Some(hex(row_background1)),
            even_col_fill: Some(hex(row_background2)),
            data_font_color: Some(hex(data_text)),
            border_color: Some(hex(border_color)),
        },
    )
}

/// All 67 built-in Excel table style definitions.
static BUILT_IN_STYLES: LazyLock<HashMap<String, TableStyleDef>> = LazyLock::new(|| {
    let entries = vec![
        // ─── Light 1–21 (from TS) ───
        def(
            "TableStyleLight1",
            "Light 1",
            "#000000",
            "#FFFFFF",
            "#FFFFFF",
            "#F2F2F2",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#000000",
            None,
        ),
        def(
            "TableStyleLight2",
            "Light 2",
            "#4472C4",
            "#FFFFFF",
            "#FFFFFF",
            "#D6DCE5",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#4472C4",
            None,
        ),
        def(
            "TableStyleLight3",
            "Light 3",
            "#ED7D31",
            "#FFFFFF",
            "#FFFFFF",
            "#FCE4D6",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#ED7D31",
            None,
        ),
        def(
            "TableStyleLight4",
            "Light 4",
            "#A5A5A5",
            "#FFFFFF",
            "#FFFFFF",
            "#EDEDED",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#A5A5A5",
            None,
        ),
        def(
            "TableStyleLight5",
            "Light 5",
            "#FFC000",
            "#000000",
            "#FFFFFF",
            "#FFF2CC",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#FFC000",
            None,
        ),
        def(
            "TableStyleLight6",
            "Light 6",
            "#5B9BD5",
            "#FFFFFF",
            "#FFFFFF",
            "#DDEBF7",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#5B9BD5",
            None,
        ),
        def(
            "TableStyleLight7",
            "Light 7",
            "#70AD47",
            "#FFFFFF",
            "#FFFFFF",
            "#E2EFDA",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#70AD47",
            None,
        ),
        def(
            "TableStyleLight8",
            "Light 8",
            "#FFFFFF",
            "#4472C4",
            "#FFFFFF",
            "#D6DCE5",
            "#000000",
            "#FFFFFF",
            "#4472C4",
            "#4472C4",
            None,
        ),
        def(
            "TableStyleLight9",
            "Light 9",
            "#FFFFFF",
            "#ED7D31",
            "#FFFFFF",
            "#FCE4D6",
            "#000000",
            "#FFFFFF",
            "#ED7D31",
            "#ED7D31",
            None,
        ),
        def(
            "TableStyleLight10",
            "Light 10",
            "#FFFFFF",
            "#A5A5A5",
            "#FFFFFF",
            "#EDEDED",
            "#000000",
            "#FFFFFF",
            "#A5A5A5",
            "#A5A5A5",
            None,
        ),
        def(
            "TableStyleLight11",
            "Light 11",
            "#FFFFFF",
            "#FFC000",
            "#FFFFFF",
            "#FFF2CC",
            "#000000",
            "#FFFFFF",
            "#FFC000",
            "#FFC000",
            None,
        ),
        def(
            "TableStyleLight12",
            "Light 12",
            "#FFFFFF",
            "#5B9BD5",
            "#FFFFFF",
            "#DDEBF7",
            "#000000",
            "#FFFFFF",
            "#5B9BD5",
            "#5B9BD5",
            None,
        ),
        def(
            "TableStyleLight13",
            "Light 13",
            "#FFFFFF",
            "#70AD47",
            "#FFFFFF",
            "#E2EFDA",
            "#000000",
            "#FFFFFF",
            "#70AD47",
            "#70AD47",
            None,
        ),
        def(
            "TableStyleLight14",
            "Light 14",
            "#4472C4",
            "#FFFFFF",
            "#D6DCE5",
            "#B4C6E7",
            "#000000",
            "#4472C4",
            "#FFFFFF",
            "#2F5496",
            None,
        ),
        def(
            "TableStyleLight15",
            "Light 15",
            "#ED7D31",
            "#FFFFFF",
            "#FCE4D6",
            "#F8CBAD",
            "#000000",
            "#ED7D31",
            "#FFFFFF",
            "#C65911",
            None,
        ),
        def(
            "TableStyleLight16",
            "Light 16",
            "#A5A5A5",
            "#FFFFFF",
            "#EDEDED",
            "#DBDBDB",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#7F7F7F",
            None,
        ),
        def(
            "TableStyleLight17",
            "Light 17",
            "#FFC000",
            "#000000",
            "#FFF2CC",
            "#FFE699",
            "#000000",
            "#FFC000",
            "#000000",
            "#BF8F00",
            None,
        ),
        def(
            "TableStyleLight18",
            "Light 18",
            "#5B9BD5",
            "#FFFFFF",
            "#DDEBF7",
            "#BDD7EE",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#2E75B6",
            None,
        ),
        def(
            "TableStyleLight19",
            "Light 19",
            "#70AD47",
            "#FFFFFF",
            "#E2EFDA",
            "#C6E0B4",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#538135",
            None,
        ),
        def(
            "TableStyleLight20",
            "Light 20",
            "#9E480E",
            "#FFFFFF",
            "#FFFFFF",
            "#F4B183",
            "#000000",
            "#9E480E",
            "#FFFFFF",
            "#9E480E",
            None,
        ),
        def(
            "TableStyleLight21",
            "Light 21",
            "#7030A0",
            "#FFFFFF",
            "#FFFFFF",
            "#E2D1F2",
            "#000000",
            "#7030A0",
            "#FFFFFF",
            "#7030A0",
            None,
        ),
        // ─── Light 22–28 (BUG FIX: missing from TS) ───
        def(
            "TableStyleLight22",
            "Light 22",
            "#4472C4",
            "#FFFFFF",
            "#FFFFFF",
            "#D6E4F0",
            "#000000",
            "#4472C4",
            "#FFFFFF",
            "#8FAADC",
            None,
        ),
        def(
            "TableStyleLight23",
            "Light 23",
            "#ED7D31",
            "#FFFFFF",
            "#FFFFFF",
            "#F8CBAD",
            "#000000",
            "#ED7D31",
            "#FFFFFF",
            "#F4B183",
            None,
        ),
        def(
            "TableStyleLight24",
            "Light 24",
            "#A5A5A5",
            "#FFFFFF",
            "#FFFFFF",
            "#D9D9D9",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#C0C0C0",
            None,
        ),
        def(
            "TableStyleLight25",
            "Light 25",
            "#FFC000",
            "#FFFFFF",
            "#FFFFFF",
            "#FFE699",
            "#000000",
            "#FFC000",
            "#FFFFFF",
            "#FFD966",
            None,
        ),
        def(
            "TableStyleLight26",
            "Light 26",
            "#5B9BD5",
            "#FFFFFF",
            "#FFFFFF",
            "#BDD7EE",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#9DC3E6",
            None,
        ),
        def(
            "TableStyleLight27",
            "Light 27",
            "#70AD47",
            "#FFFFFF",
            "#FFFFFF",
            "#C6EFCE",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#A9D18E",
            None,
        ),
        def(
            "TableStyleLight28",
            "Light 28",
            "#264478",
            "#FFFFFF",
            "#FFFFFF",
            "#B4C6E7",
            "#000000",
            "#264478",
            "#FFFFFF",
            "#8DB4E2",
            None,
        ),
        // ─── Medium 1–28 ───
        def(
            "TableStyleMedium1",
            "Medium 1",
            "#FFFFFF",
            "#000000",
            "#FFFFFF",
            "#F2F2F2",
            "#000000",
            "#FFFFFF",
            "#000000",
            "#9B9B9B",
            None,
        ),
        def(
            "TableStyleMedium2",
            "Medium 2",
            "#4472C4",
            "#FFFFFF",
            "#FFFFFF",
            "#D6DCE5",
            "#000000",
            "#4472C4",
            "#FFFFFF",
            "#8FAADC",
            None,
        ),
        def(
            "TableStyleMedium3",
            "Medium 3",
            "#ED7D31",
            "#FFFFFF",
            "#FFFFFF",
            "#FCE4D6",
            "#000000",
            "#ED7D31",
            "#FFFFFF",
            "#F4B183",
            None,
        ),
        def(
            "TableStyleMedium4",
            "Medium 4",
            "#A5A5A5",
            "#FFFFFF",
            "#FFFFFF",
            "#EDEDED",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#C9C9C9",
            None,
        ),
        def(
            "TableStyleMedium5",
            "Medium 5",
            "#FFC000",
            "#000000",
            "#FFFFFF",
            "#FFF2CC",
            "#000000",
            "#FFC000",
            "#000000",
            "#FFD966",
            None,
        ),
        def(
            "TableStyleMedium6",
            "Medium 6",
            "#5B9BD5",
            "#FFFFFF",
            "#FFFFFF",
            "#DDEBF7",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#9DC3E6",
            None,
        ),
        def(
            "TableStyleMedium7",
            "Medium 7",
            "#70AD47",
            "#FFFFFF",
            "#FFFFFF",
            "#E2EFDA",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#A9D18E",
            None,
        ),
        def(
            "TableStyleMedium8",
            "Medium 8",
            "#4472C4",
            "#FFFFFF",
            "#D6DCE5",
            "#B4C6E7",
            "#000000",
            "#4472C4",
            "#FFFFFF",
            "#4472C4",
            None,
        ),
        def(
            "TableStyleMedium9",
            "Medium 9",
            "#ED7D31",
            "#FFFFFF",
            "#FCE4D6",
            "#F8CBAD",
            "#000000",
            "#ED7D31",
            "#FFFFFF",
            "#ED7D31",
            None,
        ),
        def(
            "TableStyleMedium10",
            "Medium 10",
            "#A5A5A5",
            "#FFFFFF",
            "#EDEDED",
            "#DBDBDB",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#A5A5A5",
            None,
        ),
        def(
            "TableStyleMedium11",
            "Medium 11",
            "#FFC000",
            "#000000",
            "#FFF2CC",
            "#FFE699",
            "#000000",
            "#FFC000",
            "#000000",
            "#FFC000",
            None,
        ),
        def(
            "TableStyleMedium12",
            "Medium 12",
            "#5B9BD5",
            "#FFFFFF",
            "#DDEBF7",
            "#BDD7EE",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#5B9BD5",
            None,
        ),
        def(
            "TableStyleMedium13",
            "Medium 13",
            "#70AD47",
            "#FFFFFF",
            "#E2EFDA",
            "#C6E0B4",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#70AD47",
            None,
        ),
        def(
            "TableStyleMedium14",
            "Medium 14",
            "#FFFFFF",
            "#4472C4",
            "#FFFFFF",
            "#D6DCE5",
            "#000000",
            "#4472C4",
            "#FFFFFF",
            "#4472C4",
            None,
        ),
        def(
            "TableStyleMedium15",
            "Medium 15",
            "#FFFFFF",
            "#ED7D31",
            "#FFFFFF",
            "#FCE4D6",
            "#000000",
            "#ED7D31",
            "#FFFFFF",
            "#ED7D31",
            None,
        ),
        def(
            "TableStyleMedium16",
            "Medium 16",
            "#FFFFFF",
            "#A5A5A5",
            "#FFFFFF",
            "#EDEDED",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#A5A5A5",
            None,
        ),
        def(
            "TableStyleMedium17",
            "Medium 17",
            "#FFFFFF",
            "#BF8F00",
            "#FFFFFF",
            "#FFF2CC",
            "#000000",
            "#FFC000",
            "#000000",
            "#FFC000",
            None,
        ),
        def(
            "TableStyleMedium18",
            "Medium 18",
            "#FFFFFF",
            "#5B9BD5",
            "#FFFFFF",
            "#DDEBF7",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#5B9BD5",
            None,
        ),
        def(
            "TableStyleMedium19",
            "Medium 19",
            "#FFFFFF",
            "#70AD47",
            "#FFFFFF",
            "#E2EFDA",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#70AD47",
            None,
        ),
        def(
            "TableStyleMedium20",
            "Medium 20",
            "#FFFFFF",
            "#000000",
            "#FFFFFF",
            "#D9D9D9",
            "#000000",
            "#000000",
            "#FFFFFF",
            "#000000",
            None,
        ),
        def(
            "TableStyleMedium21",
            "Medium 21",
            "#4472C4",
            "#FFFFFF",
            "#FFFFFF",
            "#B4C6E7",
            "#000000",
            "#4472C4",
            "#FFFFFF",
            "#4472C4",
            None,
        ),
        def(
            "TableStyleMedium22",
            "Medium 22",
            "#ED7D31",
            "#FFFFFF",
            "#FFFFFF",
            "#F8CBAD",
            "#000000",
            "#ED7D31",
            "#FFFFFF",
            "#ED7D31",
            None,
        ),
        def(
            "TableStyleMedium23",
            "Medium 23",
            "#A5A5A5",
            "#FFFFFF",
            "#FFFFFF",
            "#DBDBDB",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#A5A5A5",
            None,
        ),
        def(
            "TableStyleMedium24",
            "Medium 24",
            "#FFC000",
            "#000000",
            "#FFFFFF",
            "#FFE699",
            "#000000",
            "#FFC000",
            "#000000",
            "#FFC000",
            None,
        ),
        def(
            "TableStyleMedium25",
            "Medium 25",
            "#5B9BD5",
            "#FFFFFF",
            "#FFFFFF",
            "#BDD7EE",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#5B9BD5",
            None,
        ),
        def(
            "TableStyleMedium26",
            "Medium 26",
            "#70AD47",
            "#FFFFFF",
            "#FFFFFF",
            "#C6E0B4",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#70AD47",
            None,
        ),
        def(
            "TableStyleMedium27",
            "Medium 27",
            "#9E480E",
            "#FFFFFF",
            "#FFFFFF",
            "#F4B183",
            "#000000",
            "#9E480E",
            "#FFFFFF",
            "#9E480E",
            None,
        ),
        def(
            "TableStyleMedium28",
            "Medium 28",
            "#7030A0",
            "#FFFFFF",
            "#FFFFFF",
            "#CDA3DE",
            "#000000",
            "#7030A0",
            "#FFFFFF",
            "#7030A0",
            None,
        ),
        // ─── Dark 1–11 ───
        def(
            "TableStyleDark1",
            "Dark 1",
            "#000000",
            "#FFFFFF",
            "#737373",
            "#595959",
            "#FFFFFF",
            "#000000",
            "#FFFFFF",
            "#000000",
            None,
        ),
        def(
            "TableStyleDark2",
            "Dark 2",
            "#4472C4",
            "#FFFFFF",
            "#8FAADC",
            "#6F92D2",
            "#FFFFFF",
            "#4472C4",
            "#FFFFFF",
            "#4472C4",
            None,
        ),
        def(
            "TableStyleDark3",
            "Dark 3",
            "#ED7D31",
            "#FFFFFF",
            "#F4B183",
            "#E9956A",
            "#FFFFFF",
            "#ED7D31",
            "#FFFFFF",
            "#ED7D31",
            None,
        ),
        def(
            "TableStyleDark4",
            "Dark 4",
            "#A5A5A5",
            "#FFFFFF",
            "#C9C9C9",
            "#B7B7B7",
            "#000000",
            "#A5A5A5",
            "#FFFFFF",
            "#A5A5A5",
            None,
        ),
        def(
            "TableStyleDark5",
            "Dark 5",
            "#FFC000",
            "#000000",
            "#FFD966",
            "#FFC93D",
            "#000000",
            "#FFC000",
            "#000000",
            "#FFC000",
            None,
        ),
        def(
            "TableStyleDark6",
            "Dark 6",
            "#5B9BD5",
            "#FFFFFF",
            "#9DC3E6",
            "#7DAFE0",
            "#000000",
            "#5B9BD5",
            "#FFFFFF",
            "#5B9BD5",
            None,
        ),
        def(
            "TableStyleDark7",
            "Dark 7",
            "#70AD47",
            "#FFFFFF",
            "#A9D18E",
            "#8CC265",
            "#000000",
            "#70AD47",
            "#FFFFFF",
            "#70AD47",
            None,
        ),
        def(
            "TableStyleDark8",
            "Dark 8",
            "#4472C4",
            "#FFFFFF",
            "#4472C4",
            "#2F5496",
            "#FFFFFF",
            "#2F5496",
            "#FFFFFF",
            "#2F5496",
            None,
        ),
        def(
            "TableStyleDark9",
            "Dark 9",
            "#ED7D31",
            "#FFFFFF",
            "#ED7D31",
            "#C65911",
            "#FFFFFF",
            "#C65911",
            "#FFFFFF",
            "#C65911",
            None,
        ),
        def(
            "TableStyleDark10",
            "Dark 10",
            "#A5A5A5",
            "#FFFFFF",
            "#A5A5A5",
            "#7F7F7F",
            "#FFFFFF",
            "#7F7F7F",
            "#FFFFFF",
            "#7F7F7F",
            None,
        ),
        def(
            "TableStyleDark11",
            "Dark 11",
            "#5B9BD5",
            "#FFFFFF",
            "#5B9BD5",
            "#2E75B6",
            "#FFFFFF",
            "#2E75B6",
            "#FFFFFF",
            "#2E75B6",
            None,
        ),
    ];

    let mut map = HashMap::with_capacity(entries.len());
    for (id, style_def) in entries {
        map.insert(id, style_def);
    }
    map
});

// =============================================================================
// Public API
// =============================================================================

/// Look up a built-in table style by ID.
pub fn get_built_in_style(id: &str) -> Option<&'static TableStyleDef> {
    BUILT_IN_STYLES.get(id)
}

/// Return all built-in Excel table style definitions.
pub fn get_all_built_in_styles() -> Vec<&'static TableStyleDef> {
    BUILT_IN_STYLES.values().collect()
}

/// Resolve the cell format for a given grid position within a table.
///
/// Pure function: Table + (row, col) -> Option<TableCellFormat>.
///
/// Returns None if (row, col) is outside the table range.
///
/// Resolution priority (highest to lowest):
///   1. Header row
///   2. Totals row
///   3. First column emphasis
///   4. Last column emphasis
///   5. Column banding
///   6. Row banding
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
    let style_def = BUILT_IN_STYLES
        .get(&table.style)
        .or_else(|| BUILT_IN_STYLES.get(DEFAULT_STYLE_ID))
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

// =============================================================================
// Internal helpers
// =============================================================================

fn thin_border(color: Color) -> BorderDef {
    BorderDef {
        style: BorderStyle::Thin,
        color,
    }
}

fn medium_border(color: Color) -> BorderDef {
    BorderDef {
        style: BorderStyle::Medium,
        color,
    }
}

/// Add left/right/top/bottom edge borders to a format object (mutates in place).
fn add_edge_borders(
    fmt: &mut TableCellFormat,
    left: bool,
    right: bool,
    top: bool,
    bottom: bool,
    border_color: Color,
) {
    let thin = || thin_border(border_color);
    if left && fmt.border_left.is_none() {
        fmt.border_left = Some(thin());
    }
    if right && fmt.border_right.is_none() {
        fmt.border_right = Some(thin());
    }
    if top && fmt.border_top.is_none() {
        fmt.border_top = Some(thin());
    }
    if bottom && fmt.border_bottom.is_none() {
        fmt.border_bottom = Some(thin());
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Table, TableColumn, TableRange};

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    /// Create a minimal table for testing.
    fn make_table(overrides: Option<TableOverrides>) -> Table {
        let o = overrides.unwrap_or_default();
        let cols = o.columns.unwrap_or_else(|| {
            vec![
                TableColumn {
                    id: "col-0".to_string(),
                    name: "Name".to_string(),
                    index: 0,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
                TableColumn {
                    id: "col-1".to_string(),
                    name: "Value".to_string(),
                    index: 1,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
                TableColumn {
                    id: "col-2".to_string(),
                    name: "Score".to_string(),
                    index: 2,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
            ]
        });

        Table {
            id: "test-table".to_string(),
            name: "TestTable".to_string(),
            display_name: "TestTable".to_string(),
            sheet_id: "sheet1".to_string(),
            range: o.range.unwrap_or(TableRange::new(2, 1, 7, 3)),
            columns: cols,
            has_header_row: o.has_header_row.unwrap_or(true),
            has_totals_row: o.has_totals_row.unwrap_or(true),
            style: o.style.unwrap_or_else(|| "TableStyleMedium2".to_string()),
            banded_rows: o.banded_rows.unwrap_or(true),
            banded_columns: o.banded_columns.unwrap_or(false),
            emphasize_first_column: o.emphasize_first_column.unwrap_or(false),
            emphasize_last_column: o.emphasize_last_column.unwrap_or(false),
            show_filter_buttons: o.show_filter_buttons.unwrap_or(true),
            auto_expand: true,
            auto_calculated_columns: true,
        }
    }

    /// Create a 4-column wide table for testing.
    fn make_wide_table(overrides: Option<TableOverrides>) -> Table {
        let o = overrides.unwrap_or_default();
        let cols = vec![
            TableColumn {
                id: "col-0".to_string(),
                name: "A".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            TableColumn {
                id: "col-1".to_string(),
                name: "B".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            TableColumn {
                id: "col-2".to_string(),
                name: "C".to_string(),
                index: 2,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            TableColumn {
                id: "col-3".to_string(),
                name: "D".to_string(),
                index: 3,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
        ];

        Table {
            id: "wide-table".to_string(),
            name: "WideTable".to_string(),
            display_name: "WideTable".to_string(),
            sheet_id: "sheet1".to_string(),
            range: o.range.unwrap_or(TableRange::new(0, 0, 6, 3)),
            columns: cols,
            has_header_row: o.has_header_row.unwrap_or(true),
            has_totals_row: o.has_totals_row.unwrap_or(true),
            style: o.style.unwrap_or_else(|| "TableStyleMedium2".to_string()),
            banded_rows: o.banded_rows.unwrap_or(true),
            banded_columns: o.banded_columns.unwrap_or(false),
            emphasize_first_column: o.emphasize_first_column.unwrap_or(false),
            emphasize_last_column: o.emphasize_last_column.unwrap_or(false),
            show_filter_buttons: o.show_filter_buttons.unwrap_or(true),
            auto_expand: true,
            auto_calculated_columns: true,
        }
    }

    #[derive(Default)]
    struct TableOverrides {
        range: Option<TableRange>,
        columns: Option<Vec<TableColumn>>,
        has_header_row: Option<bool>,
        has_totals_row: Option<bool>,
        style: Option<String>,
        banded_rows: Option<bool>,
        banded_columns: Option<bool>,
        emphasize_first_column: Option<bool>,
        emphasize_last_column: Option<bool>,
        show_filter_buttons: Option<bool>,
    }

    // -----------------------------------------------------------------------
    // get_all_built_in_styles — style count
    // -----------------------------------------------------------------------

    #[test]
    fn built_in_styles_count_is_67() {
        let styles = get_all_built_in_styles();
        assert_eq!(styles.len(), 67);
    }

    #[test]
    fn includes_all_light_styles_1_to_28() {
        for i in 1..=28 {
            let id = format!("TableStyleLight{}", i);
            assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
        }
    }

    #[test]
    fn includes_all_medium_styles_1_to_28() {
        for i in 1..=28 {
            let id = format!("TableStyleMedium{}", i);
            assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
        }
    }

    #[test]
    fn includes_all_dark_styles_1_to_11() {
        for i in 1..=11 {
            let id = format!("TableStyleDark{}", i);
            assert!(get_built_in_style(&id).is_some(), "Missing style: {}", id);
        }
    }

    #[test]
    fn all_style_ids_are_unique() {
        let styles = get_all_built_in_styles();
        let mut ids: Vec<&str> = styles.iter().map(|s| s.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), styles.len());
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — outside table
    // -----------------------------------------------------------------------

    #[test]
    fn outside_table_row_above() {
        let table = make_table(None);
        assert!(resolve_table_cell_format(&table, 1, 1).is_none());
    }

    #[test]
    fn outside_table_row_below() {
        let table = make_table(None);
        assert!(resolve_table_cell_format(&table, 8, 1).is_none());
    }

    #[test]
    fn outside_table_col_left() {
        let table = make_table(None);
        assert!(resolve_table_cell_format(&table, 3, 0).is_none());
    }

    #[test]
    fn outside_table_col_right() {
        let table = make_table(None);
        assert!(resolve_table_cell_format(&table, 3, 4).is_none());
    }

    #[test]
    fn outside_table_diagonal() {
        let table = make_table(None);
        assert!(resolve_table_cell_format(&table, 0, 0).is_none());
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — header row
    // -----------------------------------------------------------------------

    #[test]
    fn header_fill_and_font_color() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleMedium2".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    }

    #[test]
    fn header_is_bold() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn header_has_medium_bottom_border() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert!(fmt.border_bottom.is_some());
        assert_eq!(
            fmt.border_bottom.as_ref().unwrap().style,
            BorderStyle::Medium
        );
    }

    #[test]
    fn header_has_top_border() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert!(fmt.border_top.is_some());
    }

    #[test]
    fn header_first_col_has_left_border() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert!(fmt.border_left.is_some());
    }

    #[test]
    fn header_last_col_has_right_border() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 2, 3).unwrap();
        assert!(fmt.border_right.is_some());
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — totals row
    // -----------------------------------------------------------------------

    #[test]
    fn totals_fill_and_font_color() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleMedium2".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    }

    #[test]
    fn totals_is_bold() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn totals_has_medium_top_border() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
        assert!(fmt.border_top.is_some());
        assert_eq!(fmt.border_top.as_ref().unwrap().style, BorderStyle::Medium);
    }

    #[test]
    fn totals_has_bottom_border() {
        let table = make_table(None);
        let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
        assert!(fmt.border_bottom.is_some());
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — banded rows
    // -----------------------------------------------------------------------

    #[test]
    fn banded_rows_first_data_row_odd_fill() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    }

    #[test]
    fn banded_rows_second_data_row_even_fill() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
    }

    #[test]
    fn banded_rows_third_data_row_odd_fill() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 5, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    }

    #[test]
    fn banded_rows_fourth_data_row_even_fill() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 6, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — banded columns
    // -----------------------------------------------------------------------

    #[test]
    fn banded_columns_col_index_0_odd() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    }

    #[test]
    fn banded_columns_col_index_1_even() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
    }

    #[test]
    fn banded_columns_col_index_2_odd() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 3).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — first column emphasis
    // -----------------------------------------------------------------------

    #[test]
    fn first_column_emphasis_fill() {
        let table = make_table(Some(TableOverrides {
            emphasize_first_column: Some(true),
            banded_rows: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn non_first_column_keeps_banding() {
        let table = make_table(Some(TableOverrides {
            emphasize_first_column: Some(true),
            banded_rows: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
        assert!(fmt.font_bold.is_none());
    }

    // -----------------------------------------------------------------------
    // resolve_table_cell_format — last column emphasis
    // -----------------------------------------------------------------------

    #[test]
    fn last_column_emphasis_fill() {
        let table = make_table(Some(TableOverrides {
            emphasize_last_column: Some(true),
            banded_rows: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 3).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn non_last_column_keeps_banding() {
        let table = make_table(Some(TableOverrides {
            emphasize_last_column: Some(true),
            banded_rows: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
        assert!(fmt.font_bold.is_none());
    }

    // -----------------------------------------------------------------------
    // priority: first column emphasis overrides banding
    // -----------------------------------------------------------------------

    #[test]
    fn first_col_emphasis_overrides_odd_row_banding() {
        let table = make_table(Some(TableOverrides {
            emphasize_first_column: Some(true),
            banded_rows: Some(true),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn first_col_emphasis_overrides_even_row_banding() {
        let table = make_table(Some(TableOverrides {
            emphasize_first_column: Some(true),
            banded_rows: Some(true),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    // -----------------------------------------------------------------------
    // different style presets
    // -----------------------------------------------------------------------

    #[test]
    fn light1_header_colors() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleLight1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#000000")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn light1_odd_row_fill() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleLight1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    }

    #[test]
    fn light1_even_row_fill() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleLight1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 4, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#F2F2F2")));
    }

    #[test]
    fn medium1_header_colors() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleMedium1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
        assert_eq!(fmt.font_color, Some(hex("#000000")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn medium1_border_color() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleMedium1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert_eq!(fmt.border_bottom.as_ref().unwrap().color, hex("#9B9B9B"));
    }

    #[test]
    fn dark1_header_colors() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleDark1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#000000")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    }

    #[test]
    fn dark1_data_row_banding() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleDark1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#737373"))); // odd
        let fmt2 = resolve_table_cell_format(&table, 4, 2).unwrap();
        assert_eq!(fmt2.fill, Some(hex("#595959"))); // even
    }

    #[test]
    fn dark1_totals_row() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleDark1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 7, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#000000")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    // -----------------------------------------------------------------------
    // data cell fontColor (dataText)
    // -----------------------------------------------------------------------

    #[test]
    fn dark1_data_cells_have_white_font() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleDark1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
        let fmt2 = resolve_table_cell_format(&table, 4, 2).unwrap();
        assert_eq!(fmt2.font_color, Some(hex("#FFFFFF")));
    }

    #[test]
    fn all_dark_styles_set_font_color_on_data_cells() {
        for i in 1..=11 {
            let table = make_table(Some(TableOverrides {
                style: Some(format!("TableStyleDark{}", i)),
                ..Default::default()
            }));
            let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
            assert!(fmt.font_color.is_some(), "Dark{} missing fontColor", i);
        }
    }

    #[test]
    fn dark_white_data_text_styles() {
        let white_styles = [1, 2, 3, 8, 9, 10, 11];
        for i in white_styles {
            let table = make_table(Some(TableOverrides {
                style: Some(format!("TableStyleDark{}", i)),
                ..Default::default()
            }));
            let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
            assert_eq!(
                fmt.font_color,
                Some(hex("#FFFFFF")),
                "Dark{} should have white data font",
                i
            );
        }
    }

    #[test]
    fn dark_black_data_text_styles() {
        let black_styles = [4, 5, 6, 7];
        for i in black_styles {
            let table = make_table(Some(TableOverrides {
                style: Some(format!("TableStyleDark{}", i)),
                ..Default::default()
            }));
            let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
            assert_eq!(
                fmt.font_color,
                Some(hex("#000000")),
                "Dark{} should have black data font",
                i
            );
        }
    }

    #[test]
    fn light1_data_cells_have_black_font() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleLight1".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.font_color, Some(hex("#000000")));
    }

    #[test]
    fn medium2_data_cells_have_black_font() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleMedium2".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt.font_color, Some(hex("#000000")));
    }

    // -----------------------------------------------------------------------
    // no header row
    // -----------------------------------------------------------------------

    #[test]
    fn no_header_first_row_is_data() {
        let table = make_table(Some(TableOverrides {
            has_header_row: Some(false),
            has_totals_row: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF"))); // odd row fill
        assert!(fmt.font_bold.is_none());
    }

    #[test]
    fn no_header_totals_still_works() {
        let table = make_table(Some(TableOverrides {
            has_header_row: Some(false),
            has_totals_row: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn no_header_banding_starts_from_first_row() {
        let table = make_table(Some(TableOverrides {
            has_header_row: Some(false),
            has_totals_row: Some(true),
            ..Default::default()
        }));
        let fmt2 = resolve_table_cell_format(&table, 2, 2).unwrap();
        let fmt3 = resolve_table_cell_format(&table, 3, 2).unwrap();
        assert_eq!(fmt2.fill, Some(hex("#FFFFFF")));
        assert_eq!(fmt3.fill, Some(hex("#D6DCE5")));
    }

    // -----------------------------------------------------------------------
    // no totals row
    // -----------------------------------------------------------------------

    #[test]
    fn no_totals_last_row_is_data() {
        let table = make_table(Some(TableOverrides {
            has_header_row: Some(true),
            has_totals_row: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
        // data row index = 7 - 3 = 4, 4 % 2 == 0 -> oddRowFill
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
        assert!(fmt.font_bold.is_none());
    }

    #[test]
    fn no_totals_last_data_row_has_bottom_border() {
        let table = make_table(Some(TableOverrides {
            has_header_row: Some(true),
            has_totals_row: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 7, 2).unwrap();
        assert!(fmt.border_bottom.is_some());
    }

    #[test]
    fn no_totals_header_still_works() {
        let table = make_table(Some(TableOverrides {
            has_header_row: Some(true),
            has_totals_row: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 2).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    // -----------------------------------------------------------------------
    // both banding off — BUG FIX test
    // -----------------------------------------------------------------------

    #[test]
    fn both_banding_off_data_cells_have_no_fill() {
        let table = make_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(false),
            ..Default::default()
        }));
        let fmt3 = resolve_table_cell_format(&table, 3, 2).unwrap();
        let fmt4 = resolve_table_cell_format(&table, 4, 2).unwrap();
        let fmt5 = resolve_table_cell_format(&table, 5, 2).unwrap();
        // BUG FIX: When banding is OFF, fill should be None
        assert!(fmt3.fill.is_none());
        assert!(fmt4.fill.is_none());
        assert!(fmt5.fill.is_none());
    }

    // -----------------------------------------------------------------------
    // unknown style falls back to default
    // -----------------------------------------------------------------------

    #[test]
    fn unknown_style_falls_back_to_medium2() {
        let table = make_table(Some(TableOverrides {
            style: Some("TableStyleNonExistent99".to_string()),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 2, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_color, Some(hex("#FFFFFF")));
    }

    // -----------------------------------------------------------------------
    // edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn single_cell_table() {
        let table = make_table(Some(TableOverrides {
            range: Some(TableRange::new(0, 0, 0, 0)),
            columns: Some(vec![TableColumn {
                id: "c".to_string(),
                name: "X".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }]),
            has_header_row: Some(false),
            has_totals_row: Some(false),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 0, 0);
        assert!(fmt.is_some());
    }

    #[test]
    fn both_first_last_emphasis_single_column() {
        let table = make_table(Some(TableOverrides {
            range: Some(TableRange::new(0, 0, 3, 0)),
            columns: Some(vec![TableColumn {
                id: "c".to_string(),
                name: "X".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }]),
            has_header_row: Some(true),
            has_totals_row: Some(true),
            emphasize_first_column: Some(true),
            emphasize_last_column: Some(true),
            ..Default::default()
        }));
        // Data row at row 1
        let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
        // First column emphasis takes precedence (applied after last column)
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    #[test]
    fn table_at_non_zero_origin() {
        let table = make_table(Some(TableOverrides {
            range: Some(TableRange::new(100, 50, 105, 52)),
            has_header_row: Some(true),
            has_totals_row: Some(false),
            ..Default::default()
        }));
        assert!(resolve_table_cell_format(&table, 0, 0).is_none());
        let fmt = resolve_table_cell_format(&table, 100, 50).unwrap();
        assert_eq!(fmt.font_bold, Some(true));
        let fmt_data = resolve_table_cell_format(&table, 101, 51);
        assert!(fmt_data.is_some());
        assert!(fmt_data.unwrap().fill.is_some());
    }

    // -----------------------------------------------------------------------
    // dual banding (rows + columns)
    // -----------------------------------------------------------------------

    #[test]
    fn dual_banding_data_cells_get_row_banding_fill() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
        let fmt2 = resolve_table_cell_format(&table, 2, 0).unwrap();
        assert_eq!(fmt2.fill, Some(hex("#D6DCE5")));
    }

    #[test]
    fn dual_banding_even_row_fill_all_columns() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(true),
            ..Default::default()
        }));
        for c in 0..=3 {
            let fmt = resolve_table_cell_format(&table, 2, c).unwrap();
            assert_eq!(fmt.fill, Some(hex("#D6DCE5")), "col {} mismatch", c);
        }
    }

    #[test]
    fn dual_banding_column_transition_border() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 1).unwrap();
        assert!(fmt.border_left.is_some());
        assert_eq!(fmt.border_left.as_ref().unwrap().style, BorderStyle::Thin);
        assert_eq!(fmt.border_left.as_ref().unwrap().color, hex("#8FAADC"));
    }

    #[test]
    fn dual_banding_col3_transition_border() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 3).unwrap();
        assert!(fmt.border_left.is_some());
        assert_eq!(fmt.border_left.as_ref().unwrap().style, BorderStyle::Thin);
    }

    #[test]
    fn dual_banding_odd_columns_no_band_border() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(true),
            banded_columns: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 2).unwrap();
        assert!(fmt.border_left.is_none());
    }

    // -----------------------------------------------------------------------
    // column banding with last column emphasis
    // -----------------------------------------------------------------------

    #[test]
    fn col_banding_with_last_col_emphasis_col0() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(true),
            emphasize_last_column: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 0).unwrap();
        assert_eq!(fmt.fill, Some(hex("#FFFFFF")));
    }

    #[test]
    fn col_banding_with_last_col_emphasis_col1() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(true),
            emphasize_last_column: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 1).unwrap();
        assert_eq!(fmt.fill, Some(hex("#D6DCE5")));
    }

    #[test]
    fn col_banding_with_last_col_emphasis_last_col() {
        let table = make_wide_table(Some(TableOverrides {
            banded_rows: Some(false),
            banded_columns: Some(true),
            emphasize_last_column: Some(true),
            ..Default::default()
        }));
        let fmt = resolve_table_cell_format(&table, 1, 3).unwrap();
        assert_eq!(fmt.fill, Some(hex("#4472C4")));
        assert_eq!(fmt.font_bold, Some(true));
    }

    // -----------------------------------------------------------------------
    // Light 22-28 (new styles)
    // -----------------------------------------------------------------------

    #[test]
    fn light22_style_exists() {
        let style = get_built_in_style("TableStyleLight22").unwrap();
        assert_eq!(style.header_fill, Some(hex("#4472C4")));
        assert_eq!(style.header_font_color, Some(hex("#FFFFFF")));
        assert_eq!(style.odd_row_fill, Some(hex("#FFFFFF")));
        assert_eq!(style.even_row_fill, Some(hex("#D6E4F0")));
        assert_eq!(style.border_color, Some(hex("#8FAADC")));
    }

    #[test]
    fn light28_style_exists() {
        let style = get_built_in_style("TableStyleLight28").unwrap();
        assert_eq!(style.header_fill, Some(hex("#264478")));
        assert_eq!(style.header_font_color, Some(hex("#FFFFFF")));
        assert_eq!(style.odd_row_fill, Some(hex("#FFFFFF")));
        assert_eq!(style.even_row_fill, Some(hex("#B4C6E7")));
        assert_eq!(style.border_color, Some(hex("#8DB4E2")));
    }

    // -----------------------------------------------------------------------
    // DEFAULT_STYLE_ID
    // -----------------------------------------------------------------------

    #[test]
    fn default_style_id_is_medium2() {
        assert_eq!(DEFAULT_STYLE_ID, "TableStyleMedium2");
    }

    // -----------------------------------------------------------------------
    // pathological: 1-row range with header + totals (data_end_row underflow)
    // -----------------------------------------------------------------------

    #[test]
    fn one_row_range_with_header_and_totals_returns_none_for_data() {
        // A 1-row range where both has_header_row and has_totals_row are true
        // means the header *is* the totals row (row 0 is claimed by header).
        // data_start_row = 0 + 1 = 1, data_end_row = saturating_sub(0, 1) = 0.
        // So there is NO valid data area. Querying row 0 should match header,
        // not panic from u32 underflow.
        let table = make_table(Some(TableOverrides {
            range: Some(TableRange::new(0, 0, 0, 0)),
            columns: Some(vec![TableColumn {
                id: "c".to_string(),
                name: "X".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }]),
            has_header_row: Some(true),
            has_totals_row: Some(true),
            ..Default::default()
        }));

        // Row 0 is the header row (header takes priority over totals).
        let fmt = resolve_table_cell_format(&table, 0, 0);
        assert!(fmt.is_some());
        // It must be treated as header (bold, header fill)
        let fmt = fmt.unwrap();
        assert_eq!(fmt.font_bold, Some(true));

        // Outside the table: no format
        assert!(resolve_table_cell_format(&table, 1, 0).is_none());
    }
}
