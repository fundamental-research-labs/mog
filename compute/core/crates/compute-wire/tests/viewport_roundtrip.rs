#![allow(clippy::pedantic, clippy::all, missing_docs)]

mod support;

use compute_wire::constants::*;
use compute_wire::flags::*;
use compute_wire::serialize_viewport_binary;
use compute_wire::types::*;
use domain_types::CellFormat;
use support::fixtures::viewport_cell as cell;
use support::layout::ViewportLayout;
use support::wire::{read_f32, read_f64, read_string, read_u8, read_u16, read_u32};

#[test]
fn viewport_roundtrip_comprehensive() {
    let cells = vec![
        {
            let mut c = cell(
                0,
                0,
                VALUE_TYPE_NUMBER | HAS_FORMULA,
                42.5,
                Some("42.50"),
                None,
            );
            c.format_idx = 1;
            c.bg_color_override = 0xFF0000FF; // red bg
            c
        },
        cell(
            0,
            1,
            VALUE_TYPE_TEXT | HAS_COMMENT,
            f64::NAN,
            Some("Hello World"),
            None,
        ),
        cell(
            0,
            2,
            VALUE_TYPE_BOOL | HAS_SPARKLINE,
            1.0,
            Some("TRUE"),
            None,
        ),
        cell(
            1,
            0,
            VALUE_TYPE_ERROR | HAS_HYPERLINK,
            f64::NAN,
            Some("#DIV/0!"),
            Some("#DIV/0!"),
        ),
        {
            let mut c = cell(
                1,
                1,
                VALUE_TYPE_NULL | IS_CHECKBOX | IS_SPILL_MEMBER | HAS_VALIDATION_ERROR,
                f64::NAN,
                None,
                None,
            );
            c.font_color_override = 0x00FF00FF; // green font
            c
        },
        {
            let mut c = cell(1, 2, VALUE_TYPE_NUMBER, 99.9, Some("99.9"), None);
            c.format_idx = 2;
            c.cf_extras = Some(CellCFExtras {
                data_bar: Some(DataBarRenderData {
                    fill_percent: 0.75,
                    color: 0x3366FFFF,
                    is_negative: false,
                    gradient: true,
                    show_value: true,
                    show_axis: false,
                    axis_position: 0.0,
                    negative_color: 0xFF0000FF,
                }),
                icon: Some(IconRenderData {
                    set_name_index: 5,
                    icon_index: 2,
                    icon_only: true,
                }),
            });
            c
        },
    ];

    let merges = vec![
        RenderViewportMerge {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 1,
        },
        RenderViewportMerge {
            start_row: 1,
            start_col: 1,
            end_row: 2,
            end_col: 2,
        },
    ];

    let row_dims = vec![
        RenderRowDimension {
            row: 0,
            height: 20.0,
            hidden: false,
        },
        RenderRowDimension {
            row: 1,
            height: 30.5,
            hidden: true,
        },
    ];

    let col_dims = vec![
        RenderColDimension {
            col: 0,
            width: 100.0,
            hidden: false,
        },
        RenderColDimension {
            col: 1,
            width: 64.25,
            hidden: false,
        },
        RenderColDimension {
            col: 2,
            width: 80.0,
            hidden: true,
        },
    ];

    let row_positions = vec![0.0, 20.0, 40.0];
    let col_positions = vec![0.0, 100.0, 164.25, 228.5];

    let format_palette = vec![
        CellFormat::default(),
        CellFormat {
            bold: Some(true),
            ..Default::default()
        },
        CellFormat {
            italic: Some(true),
            ..Default::default()
        },
    ];

    let data = ViewportRenderData {
        cells,
        format_palette,
        merges,
        row_dimensions: row_dims,
        col_dimensions: col_dims,
        viewport_rows: 2,
        viewport_cols: 3,
        start_row: 10,
        start_col: 5,
        row_positions,
        col_positions,
    };

    let generation = 42u8;
    let buf = serialize_viewport_binary(&data, generation, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    assert_eq!(read_u32(&buf, 0), 10, "start_row");
    assert_eq!(read_u32(&buf, 4), 5, "start_col");
    assert_eq!(layout.cell_count, 6, "cell_count = rows*cols");
    assert_eq!(read_u16(&buf, 20), 2, "viewport_rows");
    assert_eq!(read_u16(&buf, 22), 3, "viewport_cols");
    assert_eq!(layout.merge_count, 2);
    assert_eq!(layout.row_dim_count, 2);
    assert_eq!(layout.col_dim_count, 3);
    let hdr_flags = read_u8(&buf, 30);
    assert_eq!(hdr_flags & 0x01, 0, "is_delta should be false");
    assert_eq!(read_u8(&buf, 31), generation, "generation");
    assert_eq!(layout.data_bar_count, 1);
    assert_eq!(layout.icon_count, 1);
    assert_eq!(buf.len(), layout.expected_end, "total buffer length");

    {
        let base = layout.cell_base(0);
        assert_eq!(read_f64(&buf, base + OFF_NUMBER_VALUE), 42.5);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        assert_ne!(disp_off, NO_STRING);
        let disp = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "42.50");
        let err_off = read_u32(&buf, base + OFF_ERROR_OFF);
        assert_eq!(err_off, NO_STRING, "no error string");
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
        assert_ne!(flags & HAS_FORMULA, 0);
        assert_eq!(flags & HAS_CF_EXTRAS, 0);
        assert_eq!(read_u16(&buf, base + OFF_FORMAT_IDX), 1);
        assert_eq!(read_u32(&buf, base + OFF_BG_COLOR_OVERRIDE), 0xFF0000FF);
        assert_eq!(read_u32(&buf, base + OFF_FONT_COLOR_OVERRIDE), 0);
    }

    {
        let base = layout.cell_base(1);
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_TEXT);
        assert_ne!(flags & HAS_COMMENT, 0);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "Hello World");
        assert!(read_f64(&buf, base + OFF_NUMBER_VALUE).is_nan());
    }

    {
        let base = layout.cell_base(2);
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_BOOL);
        assert_ne!(flags & HAS_SPARKLINE, 0);
        assert_eq!(read_f64(&buf, base + OFF_NUMBER_VALUE), 1.0);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "TRUE");
    }

    {
        let base = layout.cell_base(3);
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_ERROR);
        assert_ne!(flags & HAS_HYPERLINK, 0);
        let err_off = read_u32(&buf, base + OFF_ERROR_OFF);
        let err_len = read_u16(&buf, base + OFF_ERROR_LEN);
        let err = read_string(&buf, layout.string_pool_start, err_off, err_len);
        assert_eq!(err, "#DIV/0!");
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "#DIV/0!");
    }

    {
        let base = layout.cell_base(4);
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NULL);
        assert_ne!(flags & IS_CHECKBOX, 0);
        assert_ne!(flags & IS_SPILL_MEMBER, 0);
        assert_ne!(flags & HAS_VALIDATION_ERROR, 0);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        assert_eq!(disp_off, NO_STRING, "null cell has no display string");
        assert_eq!(read_u32(&buf, base + OFF_FONT_COLOR_OVERRIDE), 0x00FF00FF);
    }

    {
        let base = layout.cell_base(5);
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
        assert_ne!(flags & HAS_CF_EXTRAS, 0, "HAS_CF_EXTRAS must be set");
        assert_eq!(read_u16(&buf, base + OFF_FORMAT_IDX), 2);
        assert_eq!(read_f64(&buf, base + OFF_NUMBER_VALUE), 99.9);
    }

    assert!(
        layout.string_pool_bytes > 0,
        "string pool should be non-empty"
    );

    {
        let m0 = layout.merges_start;
        assert_eq!(read_u32(&buf, m0), 0, "merge 0 start_row");
        assert_eq!(read_u32(&buf, m0 + 4), 0, "merge 0 start_col");
        assert_eq!(read_u32(&buf, m0 + 8), 0, "merge 0 end_row");
        assert_eq!(read_u32(&buf, m0 + 12), 1, "merge 0 end_col");

        let m1 = layout.merges_start + MERGE_STRIDE;
        assert_eq!(read_u32(&buf, m1), 1, "merge 1 start_row");
        assert_eq!(read_u32(&buf, m1 + 4), 1, "merge 1 start_col");
        assert_eq!(read_u32(&buf, m1 + 8), 2, "merge 1 end_row");
        assert_eq!(read_u32(&buf, m1 + 12), 2, "merge 1 end_col");
    }

    {
        let d0 = layout.row_dims_start;
        assert_eq!(read_u32(&buf, d0), 0, "row dim 0 row");
        assert_eq!(read_f32(&buf, d0 + 4), 20.0, "row dim 0 height");
        assert_eq!(read_u32(&buf, d0 + 8), 0, "row dim 0 not hidden");

        let d1 = layout.row_dims_start + DIM_STRIDE;
        assert_eq!(read_u32(&buf, d1), 1, "row dim 1 row");
        assert_eq!(read_f32(&buf, d1 + 4), 30.5, "row dim 1 height");
        assert_eq!(read_u32(&buf, d1 + 8), 1, "row dim 1 hidden");
    }

    {
        let d0 = layout.col_dims_start;
        assert_eq!(read_u32(&buf, d0), 0, "col dim 0 col");
        assert_eq!(read_f32(&buf, d0 + 4), 100.0, "col dim 0 width");
        assert_eq!(read_u32(&buf, d0 + 8), 0, "col dim 0 not hidden");

        let d1 = layout.col_dims_start + DIM_STRIDE;
        assert_eq!(read_u32(&buf, d1), 1, "col dim 1 col");
        assert_eq!(read_f32(&buf, d1 + 4), 64.25, "col dim 1 width");
        assert_eq!(read_u32(&buf, d1 + 8), 0, "col dim 1 not hidden");

        let d2 = layout.col_dims_start + 2 * DIM_STRIDE;
        assert_eq!(read_u32(&buf, d2), 2, "col dim 2 col");
        assert_eq!(read_f32(&buf, d2 + 4), 80.0, "col dim 2 width");
        assert_eq!(read_u32(&buf, d2 + 8), 1, "col dim 2 hidden");
    }

    {
        let palette_slice = &buf[layout.palette_start..layout.palette_start + layout.palette_len];
        let (start_idx, formats) =
            compute_wire::palette_binary::deserialize_palette_binary(palette_slice)
                .expect("palette binary must parse");
        assert_eq!(start_idx, 0);
        assert_eq!(formats.len(), 3);
        assert_eq!(formats[1].bold, Some(true));
        assert_eq!(formats[2].italic, Some(true));
    }

    {
        let db0 = layout.data_bar_base(0);
        assert_eq!(read_u32(&buf, db0), 5, "data bar cell_index = 5");
        assert_eq!(read_f32(&buf, db0 + 4), 0.75, "fill_percent");
        assert_eq!(read_u32(&buf, db0 + 8), 0x3366FFFF, "color");
        let db_flags = read_u32(&buf, db0 + 12);
        assert_ne!(db_flags & 0x01, 0, "gradient");
        assert_eq!(db_flags & 0x02, 0, "not negative");
        assert_ne!(db_flags & 0x04, 0, "show_value");
        assert_eq!(db_flags & 0x08, 0, "no show_axis");
        assert_eq!(read_f32(&buf, db0 + 16), 0.0, "axis_position");
        assert_eq!(read_u32(&buf, db0 + 20), 0xFF0000FF, "negative_color");
    }

    {
        let i0 = layout.icon_base(0);
        assert_eq!(read_u32(&buf, i0), 5, "icon cell_index = 5");
        assert_eq!(read_u8(&buf, i0 + 4), 5, "set_name_index");
        assert_eq!(read_u8(&buf, i0 + 5), 2, "icon_index");
        assert_eq!(read_u8(&buf, i0 + 6), 1, "icon_only = true");
        assert_eq!(read_u8(&buf, i0 + 7), 0, "padding byte");
    }

    {
        assert_eq!(read_f64(&buf, layout.row_pos_start), 0.0, "row_pos[0]");
        assert_eq!(read_f64(&buf, layout.row_pos_start + 8), 20.0, "row_pos[1]");

        assert_eq!(read_f64(&buf, layout.col_pos_start), 0.0, "col_pos[0]");
        assert_eq!(
            read_f64(&buf, layout.col_pos_start + 8),
            100.0,
            "col_pos[1]"
        );
        assert_eq!(
            read_f64(&buf, layout.col_pos_start + 16),
            164.25,
            "col_pos[2]"
        );
    }
}

#[test]
fn viewport_delta_flag() {
    let data = ViewportRenderData {
        cells: vec![cell(0, 0, VALUE_TYPE_NUMBER, 1.0, Some("1"), None)],
        format_palette: vec![CellFormat::default()],
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

    let buf = serialize_viewport_binary(&data, 7, true, 3);
    let hdr_flags = read_u8(&buf, 30);
    assert_ne!(hdr_flags & 0x01, 0, "is_delta bit should be set");
    assert_eq!(read_u8(&buf, 31), 7, "generation");

    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());
    let palette_slice = &buf[layout.palette_start..layout.palette_start + layout.palette_len];
    let (start_idx, _) =
        compute_wire::palette_binary::deserialize_palette_binary(palette_slice).unwrap();
    assert_eq!(start_idx, 3, "palette_start_index in binary");
}

#[test]
fn viewport_empty_zero_cells() {
    let data = ViewportRenderData {
        cells: vec![],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 0,
        viewport_cols: 0,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);

    assert_eq!(read_u32(&buf, 8), 0, "cell_count = 0");
    assert_eq!(read_u16(&buf, 20), 0, "viewport_rows = 0");
    assert_eq!(read_u16(&buf, 22), 0, "viewport_cols = 0");
    assert_eq!(read_u16(&buf, 24), 0, "merge_count = 0");
    assert_eq!(read_u16(&buf, 26), 0, "row_dim_count = 0");
    assert_eq!(read_u16(&buf, 28), 0, "col_dim_count = 0");
    assert_eq!(read_u16(&buf, 32), 0, "data_bar_count = 0");
    assert_eq!(read_u16(&buf, 34), 0, "icon_count = 0");

    let palette_len = read_u32(&buf, 12) as usize;
    assert!(palette_len > 0, "palette JSON is always written");
    let expected_size = VIEWPORT_HEADER_SIZE + palette_len;
    assert_eq!(buf.len(), expected_size);
}

#[test]
fn viewport_single_cell() {
    let data = ViewportRenderData {
        cells: vec![cell(0, 0, VALUE_TYPE_NUMBER, 3.14, Some("3.14"), None)],
        format_palette: vec![CellFormat::default()],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 100,
        start_col: 200,
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    };

    let buf = serialize_viewport_binary(&data, 255, false, 0);

    assert_eq!(read_u32(&buf, 0), 100, "start_row");
    assert_eq!(read_u32(&buf, 4), 200, "start_col");
    assert_eq!(read_u32(&buf, 8), 1, "cell_count");
    assert_eq!(read_u8(&buf, 31), 255, "generation max");

    let cr = VIEWPORT_HEADER_SIZE;
    assert_eq!(read_f64(&buf, cr + OFF_NUMBER_VALUE), 3.14);
    let flags = read_u16(&buf, cr + OFF_FLAGS);
    assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
}

#[test]
fn viewport_stride_alignment_smoke() {
    let data = ViewportRenderData {
        cells: vec![
            cell(0, 0, VALUE_TYPE_NUMBER, 1.0, Some("1"), None),
            cell(0, 1, VALUE_TYPE_NUMBER, 2.0, Some("2"), None),
            cell(0, 2, VALUE_TYPE_NUMBER, 3.0, Some("3"), None),
        ],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 3,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);

    for i in 0..3 {
        let expected_val = (i + 1) as f64;
        let actual = read_f64(
            &buf,
            VIEWPORT_HEADER_SIZE + i * CELL_STRIDE + OFF_NUMBER_VALUE,
        );
        assert_eq!(actual, expected_val, "cell {} number_value", i);
    }
}
