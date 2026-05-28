#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod cells;
#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod cf_extras;
#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod header;
#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod layout_sections;
#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod positions;
#[allow(
    clippy::unreadable_literal,
    clippy::similar_names,
    clippy::float_cmp,
    clippy::default_trait_access
)]
mod strings;

use crate::constants::{
    CELL_STRIDE, DATA_BAR_ENTRY_STRIDE, DIM_STRIDE, ICON_ENTRY_STRIDE, MERGE_STRIDE, NO_STRING,
    POSITION_ENTRY_SIZE, VIEWPORT_HEADER_SIZE as HEADER_SIZE, WIRE_VERSION,
};
use crate::flags as render_flags;
use crate::types::{
    CellCFExtras, DataBarRenderData, IconRenderData, RenderColDimension, RenderRowDimension,
    RenderViewportMerge, ViewportRenderCell, ViewportRenderData,
};
use crate::viewport::serialize_viewport_binary;
use domain_types::CellFormat;

fn make_test_data() -> ViewportRenderData {
    ViewportRenderData {
        cells: vec![
            ViewportRenderCell {
                row: 0,
                col: 0,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_NUMBER | render_flags::HAS_FORMULA,
                number_value: 42.0,
                formatted: Some("42".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
            ViewportRenderCell {
                row: 0,
                col: 1,
                format_idx: 1,
                flags: render_flags::VALUE_TYPE_TEXT,
                number_value: f64::NAN,
                formatted: Some("Hello".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
            ViewportRenderCell {
                row: 1,
                col: 0,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_ERROR,
                number_value: f64::NAN,
                formatted: None,
                error: Some("#DIV/0!".to_string()),
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
            ViewportRenderCell {
                row: 1,
                col: 1,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_NULL,
                number_value: f64::NAN,
                formatted: None,
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            },
        ],
        format_palette: vec![
            CellFormat::default(),
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        ],
        merges: vec![RenderViewportMerge {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
        }],
        row_dimensions: vec![RenderRowDimension {
            row: 0,
            height: 20.0,
            hidden: false,
        }],
        col_dimensions: vec![RenderColDimension {
            col: 1,
            width: 100.5,
            hidden: true,
        }],
        viewport_rows: 2,
        viewport_cols: 2,
        start_row: 0,
        start_col: 0,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    }
}
