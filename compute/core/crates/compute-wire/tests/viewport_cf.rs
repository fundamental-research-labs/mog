#![allow(clippy::pedantic, clippy::all, missing_docs)]

mod support;

use compute_wire::constants::*;
use compute_wire::flags::*;
use compute_wire::serialize_viewport_binary;
use compute_wire::types::*;
use support::fixtures::viewport_cell as cell;
use support::layout::ViewportLayout;
use support::wire::{read_f32, read_u8, read_u16, read_u32};

#[test]
fn viewport_maximum_flag_combinations() {
    // Test a cell with ALL flags set simultaneously
    let all_flags = VALUE_TYPE_NUMBER
        | HAS_FORMULA
        | HAS_COMMENT
        | HAS_SPARKLINE
        | HAS_HYPERLINK
        | IS_CHECKBOX
        | IS_SPILL_MEMBER
        | HAS_VALIDATION_ERROR;

    let data = ViewportRenderData {
        cells: vec![{
            let mut c = cell(0, 0, all_flags, 7.0, Some("7"), None);
            c.bg_color_override = 0xFFFFFFFF;
            c.font_color_override = 0xFFFFFFFF;
            c
        }],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    let cr = layout.cell_base(0);
    let flags = read_u16(&buf, cr + OFF_FLAGS);
    assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
    assert_ne!(flags & HAS_FORMULA, 0);
    assert_ne!(flags & HAS_COMMENT, 0);
    assert_ne!(flags & HAS_SPARKLINE, 0);
    assert_ne!(flags & HAS_HYPERLINK, 0);
    assert_ne!(flags & IS_CHECKBOX, 0);
    assert_ne!(flags & IS_SPILL_MEMBER, 0);
    assert_ne!(flags & HAS_VALIDATION_ERROR, 0);
    assert_eq!(read_u32(&buf, cr + OFF_BG_COLOR_OVERRIDE), 0xFFFFFFFF);
    assert_eq!(read_u32(&buf, cr + OFF_FONT_COLOR_OVERRIDE), 0xFFFFFFFF);
}

#[test]
fn viewport_data_bar_only_no_icon() {
    // Cell with data bar but no icon
    let data = ViewportRenderData {
        cells: vec![{
            let mut c = cell(0, 0, VALUE_TYPE_NUMBER, 50.0, Some("50"), None);
            c.cf_extras = Some(CellCFExtras {
                data_bar: Some(DataBarRenderData {
                    fill_percent: 0.5,
                    color: 0x00FF00FF,
                    is_negative: true,
                    gradient: false,
                    show_value: false,
                    show_axis: true,
                    axis_position: 0.25,
                    negative_color: 0xFF000088,
                }),
                icon: None,
            });
            c
        }],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    assert_eq!(read_u16(&buf, 32), 1, "1 data bar");
    assert_eq!(read_u16(&buf, 34), 0, "0 icons");

    // Verify HAS_CF_EXTRAS is set on the cell
    let cr = layout.cell_base(0);
    let flags = read_u16(&buf, cr + OFF_FLAGS);
    assert_ne!(flags & HAS_CF_EXTRAS, 0);

    // Find data bar section
    let db_start = layout.data_bar_base(0);

    assert_eq!(read_u32(&buf, db_start), 0, "data bar cell_index");
    assert_eq!(read_f32(&buf, db_start + 4), 0.5);
    assert_eq!(read_u32(&buf, db_start + 8), 0x00FF00FF);
    let db_flags = read_u32(&buf, db_start + 12);
    assert_eq!(db_flags & 0x01, 0, "gradient = false");
    assert_ne!(db_flags & 0x02, 0, "is_negative = true");
    assert_eq!(db_flags & 0x04, 0, "show_value = false");
    assert_ne!(db_flags & 0x08, 0, "show_axis = true");
    assert_eq!(read_f32(&buf, db_start + 16), 0.25, "axis_position");
    assert_eq!(read_u32(&buf, db_start + 20), 0xFF000088, "negative_color");
}

#[test]
fn viewport_icon_only_no_data_bar() {
    // Cell with icon but no data bar
    let data = ViewportRenderData {
        cells: vec![{
            let mut c = cell(0, 0, VALUE_TYPE_NUMBER, 1.0, Some("1"), None);
            c.cf_extras = Some(CellCFExtras {
                data_bar: None,
                icon: Some(IconRenderData {
                    set_name_index: 20,
                    icon_index: 4,
                    icon_only: false,
                }),
            });
            c
        }],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    assert_eq!(read_u16(&buf, 32), 0, "0 data bars");
    assert_eq!(read_u16(&buf, 34), 1, "1 icon");

    let icons_start = layout.icon_base(0);

    assert_eq!(read_u32(&buf, icons_start), 0, "icon cell_index");
    assert_eq!(read_u8(&buf, icons_start + 4), 20, "set_name_index");
    assert_eq!(read_u8(&buf, icons_start + 5), 4, "icon_index");
    assert_eq!(read_u8(&buf, icons_start + 6), 0, "icon_only = false");
}
