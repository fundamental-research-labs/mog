//! Property-based roundtrip tests for the compute-wire binary format.
//!
//! These tests serialize data via the public API and then read back every byte
//! using the wire format constants, verifying that each field matches.
//! This mirrors what the TypeScript consumer does and catches any
//! offset, stride, or encoding regressions.

#![allow(clippy::pedantic, clippy::all, missing_docs)]

use std::collections::HashMap;

use compute_wire::constants::*;
use compute_wire::flags::*;
use compute_wire::types::*;
use compute_wire::{serialize_mutation_result, serialize_viewport_binary};
use domain_types::CellFormat;
use snapshot_types::{
    CellChange, CellErrorInfo, ProjectionCellData, ProjectionChange, RecalcResult,
};
use value_types::{CellError, CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Little-endian reader helpers
// ---------------------------------------------------------------------------

fn read_u8(buf: &[u8], off: usize) -> u8 {
    buf[off]
}

fn read_u16(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

fn read_u32(buf: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
}

fn read_f32(buf: &[u8], off: usize) -> f32 {
    f32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
}

fn read_f64(buf: &[u8], off: usize) -> f64 {
    f64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
}

fn read_string(buf: &[u8], pool_start: usize, offset: u32, len: u16) -> String {
    if offset == NO_STRING {
        panic!("attempted to read NO_STRING sentinel as a string");
    }
    let start = pool_start + offset as usize;
    let end = start + len as usize;
    String::from_utf8(buf[start..end].to_vec()).expect("invalid UTF-8 in string pool")
}

// ---------------------------------------------------------------------------
// Helper: build a ViewportRenderCell with common defaults
// ---------------------------------------------------------------------------

fn cell(
    row: u32,
    col: u32,
    flags: u16,
    number_value: f64,
    formatted: Option<&str>,
    error: Option<&str>,
) -> ViewportRenderCell {
    ViewportRenderCell {
        row,
        col,
        format_idx: 0,
        flags,
        number_value,
        formatted: formatted.map(String::from),
        error: error.map(String::from),
        bg_color_override: 0,
        font_color_override: 0,
        cf_extras: None,
    }
}

// ---------------------------------------------------------------------------
// a. Viewport roundtrip — comprehensive
// ---------------------------------------------------------------------------

#[test]
fn viewport_roundtrip_comprehensive() {
    // Build cells exercising every value type and many flag combos
    let cells = vec![
        // Cell 0: number with formula
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
        // Cell 1: text with comment
        cell(
            0,
            1,
            VALUE_TYPE_TEXT | HAS_COMMENT,
            f64::NAN,
            Some("Hello World"),
            None,
        ),
        // Cell 2: boolean TRUE with sparkline flag
        cell(
            0,
            2,
            VALUE_TYPE_BOOL | HAS_SPARKLINE,
            1.0,
            Some("TRUE"),
            None,
        ),
        // Cell 3: error with hyperlink
        cell(
            1,
            0,
            VALUE_TYPE_ERROR | HAS_HYPERLINK,
            f64::NAN,
            Some("#DIV/0!"),
            Some("#DIV/0!"),
        ),
        // Cell 4: null with checkbox + spill member + validation error flags
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
        // Cell 5: number with CF extras (data bar + icon)
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

    // Length = viewport_{rows,cols} + 1 (in-range entries + 1 trailing sentinel).
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

    // -- Read back header (36 bytes) ------------------------------------------

    assert_eq!(read_u32(&buf, 0), 10, "start_row");
    assert_eq!(read_u32(&buf, 4), 5, "start_col");
    let cell_count = read_u32(&buf, 8) as usize;
    assert_eq!(cell_count, 6, "cell_count = rows*cols");
    let palette_len = read_u32(&buf, 12) as usize;
    let string_pool_bytes = read_u32(&buf, 16) as usize;
    assert_eq!(read_u16(&buf, 20), 2, "viewport_rows");
    assert_eq!(read_u16(&buf, 22), 3, "viewport_cols");
    let merge_count = read_u16(&buf, 24) as usize;
    assert_eq!(merge_count, 2);
    let row_dim_count = read_u16(&buf, 26) as usize;
    assert_eq!(row_dim_count, 2);
    let col_dim_count = read_u16(&buf, 28) as usize;
    assert_eq!(col_dim_count, 3);
    let hdr_flags = read_u8(&buf, 30);
    assert_eq!(hdr_flags & 0x01, 0, "is_delta should be false");
    assert_eq!(read_u8(&buf, 31), generation, "generation");
    let data_bar_count = read_u16(&buf, 32) as usize;
    assert_eq!(data_bar_count, 1);
    let icon_count = read_u16(&buf, 34) as usize;
    assert_eq!(icon_count, 1);

    // -- Section offsets (computed from header values) -------------------------

    let cells_start = VIEWPORT_HEADER_SIZE;
    let string_pool_start = cells_start + cell_count * CELL_STRIDE;
    let merges_start = string_pool_start + string_pool_bytes;
    let row_dims_start = merges_start + merge_count * MERGE_STRIDE;
    let col_dims_start = row_dims_start + row_dim_count * DIM_STRIDE;
    let palette_start = col_dims_start + col_dim_count * DIM_STRIDE;
    let data_bars_start = palette_start + palette_len;
    let icons_start = data_bars_start + data_bar_count * DATA_BAR_ENTRY_STRIDE;
    let row_pos_start = icons_start + icon_count * ICON_ENTRY_STRIDE;
    let col_pos_start = row_pos_start + data.row_positions.len() * POSITION_ENTRY_SIZE;
    let expected_end = col_pos_start + data.col_positions.len() * POSITION_ENTRY_SIZE;
    assert_eq!(buf.len(), expected_end, "total buffer length");

    // -- Read back cell records -----------------------------------------------

    // Cell 0: number 42.5, formatted "42.50", format_idx=1, has_formula, bg_color=0xFF0000FF
    {
        let base = cells_start + 0 * CELL_STRIDE;
        assert_eq!(read_f64(&buf, base + OFF_NUMBER_VALUE), 42.5);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        assert_ne!(disp_off, NO_STRING);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "42.50");
        let err_off = read_u32(&buf, base + OFF_ERROR_OFF);
        assert_eq!(err_off, NO_STRING, "no error string");
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
        assert_ne!(flags & HAS_FORMULA, 0);
        // HAS_CF_EXTRAS should NOT be set on cell 0
        assert_eq!(flags & HAS_CF_EXTRAS, 0);
        assert_eq!(read_u16(&buf, base + OFF_FORMAT_IDX), 1);
        assert_eq!(read_u32(&buf, base + OFF_BG_COLOR_OVERRIDE), 0xFF0000FF);
        assert_eq!(read_u32(&buf, base + OFF_FONT_COLOR_OVERRIDE), 0);
    }

    // Cell 1: text "Hello World", has_comment
    {
        let base = cells_start + 1 * CELL_STRIDE;
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_TEXT);
        assert_ne!(flags & HAS_COMMENT, 0);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "Hello World");
        // number_value should be NaN for text
        assert!(read_f64(&buf, base + OFF_NUMBER_VALUE).is_nan());
    }

    // Cell 2: boolean TRUE, sparkline
    {
        let base = cells_start + 2 * CELL_STRIDE;
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_BOOL);
        assert_ne!(flags & HAS_SPARKLINE, 0);
        assert_eq!(read_f64(&buf, base + OFF_NUMBER_VALUE), 1.0);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "TRUE");
    }

    // Cell 3: error "#DIV/0!" with hyperlink
    {
        let base = cells_start + 3 * CELL_STRIDE;
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_ERROR);
        assert_ne!(flags & HAS_HYPERLINK, 0);
        let err_off = read_u32(&buf, base + OFF_ERROR_OFF);
        let err_len = read_u16(&buf, base + OFF_ERROR_LEN);
        let err = read_string(&buf, string_pool_start, err_off, err_len);
        assert_eq!(err, "#DIV/0!");
        // Display should also be set
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, base + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "#DIV/0!");
    }

    // Cell 4: null with checkbox + spill_member + validation_error, font_color override
    {
        let base = cells_start + 4 * CELL_STRIDE;
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NULL);
        assert_ne!(flags & IS_CHECKBOX, 0);
        assert_ne!(flags & IS_SPILL_MEMBER, 0);
        assert_ne!(flags & HAS_VALIDATION_ERROR, 0);
        let disp_off = read_u32(&buf, base + OFF_DISPLAY_OFF);
        assert_eq!(disp_off, NO_STRING, "null cell has no display string");
        assert_eq!(read_u32(&buf, base + OFF_FONT_COLOR_OVERRIDE), 0x00FF00FF);
    }

    // Cell 5: number with CF extras (HAS_CF_EXTRAS should be set by serializer)
    {
        let base = cells_start + 5 * CELL_STRIDE;
        let flags = read_u16(&buf, base + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
        assert_ne!(flags & HAS_CF_EXTRAS, 0, "HAS_CF_EXTRAS must be set");
        assert_eq!(read_u16(&buf, base + OFF_FORMAT_IDX), 2);
        assert_eq!(read_f64(&buf, base + OFF_NUMBER_VALUE), 99.9);
    }

    // -- Read back string pool (verify all strings are extractable) ------------

    // The pool is just a packed byte array; we already verified individual strings above.
    assert!(string_pool_bytes > 0, "string pool should be non-empty");

    // -- Read back merge records -----------------------------------------------

    {
        let m0 = merges_start;
        assert_eq!(read_u32(&buf, m0), 0, "merge 0 start_row");
        assert_eq!(read_u32(&buf, m0 + 4), 0, "merge 0 start_col");
        assert_eq!(read_u32(&buf, m0 + 8), 0, "merge 0 end_row");
        assert_eq!(read_u32(&buf, m0 + 12), 1, "merge 0 end_col");

        let m1 = merges_start + MERGE_STRIDE;
        assert_eq!(read_u32(&buf, m1), 1, "merge 1 start_row");
        assert_eq!(read_u32(&buf, m1 + 4), 1, "merge 1 start_col");
        assert_eq!(read_u32(&buf, m1 + 8), 2, "merge 1 end_row");
        assert_eq!(read_u32(&buf, m1 + 12), 2, "merge 1 end_col");
    }

    // -- Read back row dimensions ----------------------------------------------

    {
        let d0 = row_dims_start;
        assert_eq!(read_u32(&buf, d0), 0, "row dim 0 row");
        assert_eq!(read_f32(&buf, d0 + 4), 20.0, "row dim 0 height");
        assert_eq!(read_u32(&buf, d0 + 8), 0, "row dim 0 not hidden");

        let d1 = row_dims_start + DIM_STRIDE;
        assert_eq!(read_u32(&buf, d1), 1, "row dim 1 row");
        assert_eq!(read_f32(&buf, d1 + 4), 30.5, "row dim 1 height");
        assert_eq!(read_u32(&buf, d1 + 8), 1, "row dim 1 hidden");
    }

    // -- Read back col dimensions ----------------------------------------------

    {
        let d0 = col_dims_start;
        assert_eq!(read_u32(&buf, d0), 0, "col dim 0 col");
        assert_eq!(read_f32(&buf, d0 + 4), 100.0, "col dim 0 width");
        assert_eq!(read_u32(&buf, d0 + 8), 0, "col dim 0 not hidden");

        let d1 = col_dims_start + DIM_STRIDE;
        assert_eq!(read_u32(&buf, d1), 1, "col dim 1 col");
        assert_eq!(read_f32(&buf, d1 + 4), 64.25, "col dim 1 width");
        assert_eq!(read_u32(&buf, d1 + 8), 0, "col dim 1 not hidden");

        let d2 = col_dims_start + 2 * DIM_STRIDE;
        assert_eq!(read_u32(&buf, d2), 2, "col dim 2 col");
        assert_eq!(read_f32(&buf, d2 + 4), 80.0, "col dim 2 width");
        assert_eq!(read_u32(&buf, d2 + 8), 1, "col dim 2 hidden");
    }

    // -- Read back format palette (binary) -----------------------------------------

    {
        let palette_slice = &buf[palette_start..palette_start + palette_len];
        let (start_idx, formats) =
            compute_wire::palette_binary::deserialize_palette_binary(palette_slice)
                .expect("palette binary must parse");
        assert_eq!(start_idx, 0);
        assert_eq!(formats.len(), 3);
        // Check that bold=true is in format 1
        assert_eq!(formats[1].bold, Some(true));
        // Check that italic=true is in format 2
        assert_eq!(formats[2].italic, Some(true));
    }

    // -- Read back data bar entries --------------------------------------------

    {
        let db0 = data_bars_start;
        assert_eq!(read_u32(&buf, db0), 5, "data bar cell_index = 5");
        assert_eq!(read_f32(&buf, db0 + 4), 0.75, "fill_percent");
        assert_eq!(read_u32(&buf, db0 + 8), 0x3366FFFF, "color");
        let db_flags = read_u32(&buf, db0 + 12);
        // flags: gradient=bit0, is_negative=bit1, show_value=bit2, show_axis=bit3
        assert_ne!(db_flags & 0x01, 0, "gradient");
        assert_eq!(db_flags & 0x02, 0, "not negative");
        assert_ne!(db_flags & 0x04, 0, "show_value");
        assert_eq!(db_flags & 0x08, 0, "no show_axis");
        assert_eq!(read_f32(&buf, db0 + 16), 0.0, "axis_position");
        assert_eq!(read_u32(&buf, db0 + 20), 0xFF0000FF, "negative_color");
    }

    // -- Read back icon entries ------------------------------------------------

    {
        let i0 = icons_start;
        assert_eq!(read_u32(&buf, i0), 5, "icon cell_index = 5");
        assert_eq!(read_u8(&buf, i0 + 4), 5, "set_name_index");
        assert_eq!(read_u8(&buf, i0 + 5), 2, "icon_index");
        assert_eq!(read_u8(&buf, i0 + 6), 1, "icon_only = true");
        assert_eq!(read_u8(&buf, i0 + 7), 0, "padding byte");
    }

    // -- Read back position arrays ---------------------------------------------

    {
        assert_eq!(read_f64(&buf, row_pos_start), 0.0, "row_pos[0]");
        assert_eq!(read_f64(&buf, row_pos_start + 8), 20.0, "row_pos[1]");

        assert_eq!(read_f64(&buf, col_pos_start), 0.0, "col_pos[0]");
        assert_eq!(read_f64(&buf, col_pos_start + 8), 100.0, "col_pos[1]");
        assert_eq!(read_f64(&buf, col_pos_start + 16), 164.25, "col_pos[2]");
    }
}

// ---------------------------------------------------------------------------
// a (cont). Viewport with is_delta flag
// ---------------------------------------------------------------------------

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

    // palette_start_index should appear in the palette JSON
    let cell_count = read_u32(&buf, 8) as usize;
    let palette_len = read_u32(&buf, 12) as usize;
    let string_pool_bytes = read_u32(&buf, 16) as usize;
    let merge_count = read_u16(&buf, 24) as usize;
    let row_dim_count = read_u16(&buf, 26) as usize;
    let col_dim_count = read_u16(&buf, 28) as usize;

    let palette_start = VIEWPORT_HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * MERGE_STRIDE
        + row_dim_count * DIM_STRIDE
        + col_dim_count * DIM_STRIDE;
    let palette_slice = &buf[palette_start..palette_start + palette_len];
    let (start_idx, _) =
        compute_wire::palette_binary::deserialize_palette_binary(palette_slice).unwrap();
    assert_eq!(start_idx, 3, "palette_start_index in binary");
}

// ---------------------------------------------------------------------------
// b. Mutation roundtrip
// ---------------------------------------------------------------------------

#[test]
fn mutation_roundtrip() {
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "cell-1".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 3, col: 7 }),
                value: CellValue::Number(FiniteF64::new(123.456).unwrap()),
                display_text: Some("123.456".into()),
                format_idx: Some(2),
                extra_flags: HAS_FORMULA,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-2".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 4, col: 0 }),
                value: CellValue::Text("Hello".into()),
                display_text: Some("Hello".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-3".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 5, col: 1 }),
                value: CellValue::Boolean(true),
                display_text: Some("TRUE".into()),
                format_idx: None,
                extra_flags: HAS_COMMENT,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-4".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 6, col: 2 }),
                value: CellValue::Error(CellError::Div0, None),
                display_text: Some("#DIV/0!".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-5".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 7, col: 3 }),
                value: CellValue::Null,
                display_text: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let sheet_id = "abc-def-123";
    let generation = 99u8;
    let buf = serialize_mutation_result(&result, sheet_id, generation, None);

    // -- Read header (16 bytes) ------------------------------------------------

    let patch_count = read_u32(&buf, 0) as usize;
    assert_eq!(patch_count, 5, "patch_count");
    let string_bytes = read_u32(&buf, 4) as usize;
    let sheet_id_len = read_u16(&buf, 8) as usize;
    assert_eq!(sheet_id_len, sheet_id.len());
    let hdr_flags = read_u8(&buf, 10);
    assert_eq!(hdr_flags & MUT_HAS_PROJECTION_CHANGES, 0, "no projections");
    assert_eq!(hdr_flags & MUT_HAS_ERRORS, 0, "no errors flag");
    assert_eq!(read_u8(&buf, 11), generation);

    // -- Read sheet ID ---------------------------------------------------------

    let sheet_id_start = MUTATION_HEADER_SIZE;
    let read_sheet_id =
        String::from_utf8(buf[sheet_id_start..sheet_id_start + sheet_id_len].to_vec()).unwrap();
    assert_eq!(read_sheet_id, sheet_id);

    // -- Compute section offsets -----------------------------------------------

    let patches_start = sheet_id_start + sheet_id_len;
    let string_pool_start = patches_start + patch_count * PATCH_STRIDE;

    // -- Read back cell patches ------------------------------------------------

    // Patch 0: row=3, col=7, Number(123.456), "123.456", format_idx=2, HAS_FORMULA
    {
        let base = patches_start;
        assert_eq!(read_u32(&buf, base), 3, "patch 0 row");
        assert_eq!(read_u32(&buf, base + 4), 7, "patch 0 col");
        // Cell record starts at base + 8
        let cr = base + 8;
        assert_eq!(read_f64(&buf, cr + OFF_NUMBER_VALUE), 123.456);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
        assert_ne!(disp_off, NO_STRING);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "123.456");
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
        assert_ne!(flags & HAS_FORMULA, 0);
        assert_eq!(read_u16(&buf, cr + OFF_FORMAT_IDX), 2);
    }

    // Patch 1: row=4, col=0, Text("Hello")
    {
        let base = patches_start + PATCH_STRIDE;
        assert_eq!(read_u32(&buf, base), 4);
        assert_eq!(read_u32(&buf, base + 4), 0);
        let cr = base + 8;
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_TEXT);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "Hello");
        // number_value should be NaN for text
        assert!(read_f64(&buf, cr + OFF_NUMBER_VALUE).is_nan());
    }

    // Patch 2: Boolean(true), HAS_COMMENT
    {
        let base = patches_start + 2 * PATCH_STRIDE;
        assert_eq!(read_u32(&buf, base), 5);
        assert_eq!(read_u32(&buf, base + 4), 1);
        let cr = base + 8;
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_BOOL);
        assert_ne!(flags & HAS_COMMENT, 0);
        assert_eq!(read_f64(&buf, cr + OFF_NUMBER_VALUE), 1.0);
    }

    // Patch 3: Error(Div0)
    {
        let base = patches_start + 3 * PATCH_STRIDE;
        assert_eq!(read_u32(&buf, base), 6);
        assert_eq!(read_u32(&buf, base + 4), 2);
        let cr = base + 8;
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_ERROR);
        // Error string
        let err_off = read_u32(&buf, cr + OFF_ERROR_OFF);
        let err_len = read_u16(&buf, cr + OFF_ERROR_LEN);
        assert_ne!(err_off, NO_STRING);
        let err = read_string(&buf, string_pool_start, err_off, err_len);
        assert_eq!(err, "#DIV/0!");
    }

    // Patch 4: Null
    {
        let base = patches_start + 4 * PATCH_STRIDE;
        assert_eq!(read_u32(&buf, base), 7);
        assert_eq!(read_u32(&buf, base + 4), 3);
        let cr = base + 8;
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NULL);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        assert_eq!(disp_off, NO_STRING);
        let err_off = read_u32(&buf, cr + OFF_ERROR_OFF);
        assert_eq!(err_off, NO_STRING);
    }

    // Verify total size
    let expected_size =
        MUTATION_HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE + string_bytes;
    assert_eq!(buf.len(), expected_size, "total mutation buffer size");
}

// ---------------------------------------------------------------------------
// b (cont). Mutation with projections and errors flags
// ---------------------------------------------------------------------------

#[test]
fn mutation_with_projections_and_errors() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Number(FiniteF64::new(10.0).unwrap()),
            display_text: Some("10".into()),
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![ProjectionChange {
            source_cell_id: "src-1".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                ProjectionCellData {
                    cell_id: "p1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::new(20.0).unwrap()),
                },
                ProjectionCellData {
                    cell_id: "p2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("spill text".into()),
                },
            ],
        }],
        errors: vec![CellErrorInfo {
            cell_id: "c-err".into(),
            sheet_id: "s1".into(),
            error: "#VALUE!".into(),
        }],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "sheet-x", 1, None);

    // Header flags
    let hdr_flags = read_u8(&buf, 10);
    assert_ne!(
        hdr_flags & MUT_HAS_PROJECTION_CHANGES,
        0,
        "has_projection_changes"
    );
    assert_ne!(hdr_flags & MUT_HAS_ERRORS, 0, "has_errors");

    // Read patch count
    let patch_count = read_u32(&buf, 0) as usize;
    assert_eq!(patch_count, 1, "only 1 changed cell");

    let sheet_id_len = read_u16(&buf, 8) as usize;
    let string_bytes = read_u32(&buf, 4) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let string_pool_start = patches_start + patch_count * PATCH_STRIDE;
    let spill_section_start = string_pool_start + string_bytes;

    // Read spill section header
    let proj_count = read_u32(&buf, spill_section_start) as usize;
    assert_eq!(proj_count, 2, "2 projection patches");

    // Read first spill patch
    let sp0 = spill_section_start + 4;
    assert_eq!(read_u32(&buf, sp0), 1, "spill patch 0 row");
    assert_eq!(read_u32(&buf, sp0 + 4), 0, "spill patch 0 col");
    let cr0 = sp0 + 8;
    let flags0 = read_u16(&buf, cr0 + OFF_FLAGS);
    assert_ne!(flags0 & IS_SPILL_MEMBER, 0, "IS_SPILL_MEMBER set");
    assert_eq!(flags0 & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);

    // Read second spill patch
    let sp1 = sp0 + PATCH_STRIDE;
    assert_eq!(read_u32(&buf, sp1), 2, "spill patch 1 row");
    let cr1 = sp1 + 8;
    let flags1 = read_u16(&buf, cr1 + OFF_FLAGS);
    assert_ne!(flags1 & IS_SPILL_MEMBER, 0);
    assert_eq!(flags1 & VALUE_TYPE_MASK, VALUE_TYPE_TEXT);
}

// ---------------------------------------------------------------------------
// b (cont). Mutation with CF color overrides
// ---------------------------------------------------------------------------

#[test]
fn mutation_with_cf_color_overrides() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 2, col: 3 }),
            value: CellValue::Number(FiniteF64::new(50.0).unwrap()),
            display_text: Some("50".into()),
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let mut cf_colors = compute_wire::CfColorOverrides::default();
    cf_colors.insert(2, 3, 0xAABBCCDD, 0x11223344);

    let buf = serialize_mutation_result(&result, "s1", 0, Some(&cf_colors));

    let sheet_id_len = read_u16(&buf, 8) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let cr = patches_start + 8; // skip row+col
    assert_eq!(
        read_u32(&buf, cr + OFF_BG_COLOR_OVERRIDE),
        0xAABBCCDD,
        "bg color override"
    );
    assert_eq!(
        read_u32(&buf, cr + OFF_FONT_COLOR_OVERRIDE),
        0x11223344,
        "font color override"
    );
}

// ---------------------------------------------------------------------------
// c. Multi-viewport roundtrip
// ---------------------------------------------------------------------------

#[test]
fn multi_viewport_roundtrip() {
    use compute_wire::serialize_multi_viewport_patches;

    let vp1_data = vec![1u8, 2, 3, 4, 5];
    let vp2_data = vec![10, 20, 30];
    let patches = vec![
        ("viewport-A".to_string(), vp1_data.clone()),
        ("viewport-B".to_string(), vp2_data.clone()),
    ];

    let buf = serialize_multi_viewport_patches(&patches);

    // Header: u16 viewport_count
    let vp_count = read_u16(&buf, 0) as usize;
    assert_eq!(vp_count, 2);

    // Entry 0
    let mut off = 2;
    let id_len_0 = read_u8(&buf, off) as usize;
    off += 1;
    let id_0 = String::from_utf8(buf[off..off + id_len_0].to_vec()).unwrap();
    assert_eq!(id_0, "viewport-A");
    off += id_len_0;
    let patch_len_0 = read_u32(&buf, off) as usize;
    off += 4;
    assert_eq!(patch_len_0, 5);
    assert_eq!(&buf[off..off + patch_len_0], &vp1_data[..]);
    off += patch_len_0;

    // Entry 1
    let id_len_1 = read_u8(&buf, off) as usize;
    off += 1;
    let id_1 = String::from_utf8(buf[off..off + id_len_1].to_vec()).unwrap();
    assert_eq!(id_1, "viewport-B");
    off += id_len_1;
    let patch_len_1 = read_u32(&buf, off) as usize;
    off += 4;
    assert_eq!(patch_len_1, 3);
    assert_eq!(&buf[off..off + patch_len_1], &vp2_data[..]);
    off += patch_len_1;

    assert_eq!(off, buf.len(), "consumed entire buffer");
}

#[test]
fn multi_viewport_empty() {
    use compute_wire::serialize_multi_viewport_patches;

    let buf = serialize_multi_viewport_patches(&[]);
    assert_eq!(buf.len(), 2);
    assert_eq!(read_u16(&buf, 0), 0);
}

// ---------------------------------------------------------------------------
// d. Edge cases
// ---------------------------------------------------------------------------

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

    // Buffer should still contain header + palette JSON (even if empty formats)
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
        // Length = viewport_{rows,cols} + 1 (1 entry + 1 sentinel).
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    };

    let buf = serialize_viewport_binary(&data, 255, false, 0);

    assert_eq!(read_u32(&buf, 0), 100, "start_row");
    assert_eq!(read_u32(&buf, 4), 200, "start_col");
    assert_eq!(read_u32(&buf, 8), 1, "cell_count");
    assert_eq!(read_u8(&buf, 31), 255, "generation max");

    // Verify the single cell
    let cr = VIEWPORT_HEADER_SIZE;
    assert_eq!(read_f64(&buf, cr + OFF_NUMBER_VALUE), 3.14);
    let flags = read_u16(&buf, cr + OFF_FLAGS);
    assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
}

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

    let cr = VIEWPORT_HEADER_SIZE;
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
fn viewport_very_long_strings() {
    // A string that is 60,000 bytes — close to u16::MAX but within range
    let long_str = "A".repeat(60_000);

    let data = ViewportRenderData {
        cells: vec![cell(0, 0, VALUE_TYPE_TEXT, f64::NAN, Some(&long_str), None)],
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

    let string_pool_bytes = read_u32(&buf, 16) as usize;
    assert!(
        string_pool_bytes >= 60_000,
        "string pool must hold the long string"
    );

    let cr = VIEWPORT_HEADER_SIZE;
    let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
    let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
    assert_eq!(disp_len, 60_000);

    let string_pool_start = VIEWPORT_HEADER_SIZE + CELL_STRIDE;
    let recovered = read_string(&buf, string_pool_start, disp_off, disp_len);
    assert_eq!(recovered.len(), 60_000);
    assert!(recovered.chars().all(|c| c == 'A'));
}

#[test]
fn viewport_unicode_strings() {
    // Emoji, CJK, RTL, combining characters
    let emoji = "\u{1F600}\u{1F680}\u{1F4A9}"; // grinning face, rocket, poo
    let cjk = "\u{4E16}\u{754C}\u{4F60}\u{597D}"; // "world hello" in Chinese
    let rtl = "\u{0645}\u{0631}\u{062D}\u{0628}\u{0627}"; // "merhaba" in Arabic script
    let combining = "e\u{0301}"; // e + combining acute accent

    let data = ViewportRenderData {
        cells: vec![
            cell(0, 0, VALUE_TYPE_TEXT, f64::NAN, Some(emoji), None),
            cell(0, 1, VALUE_TYPE_TEXT, f64::NAN, Some(cjk), None),
            cell(0, 2, VALUE_TYPE_TEXT, f64::NAN, Some(rtl), None),
            cell(0, 3, VALUE_TYPE_TEXT, f64::NAN, Some(combining), None),
        ],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 4,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);

    let cell_count = read_u32(&buf, 8) as usize;
    assert_eq!(cell_count, 4);
    let string_pool_start = VIEWPORT_HEADER_SIZE + cell_count * CELL_STRIDE;

    let expected_strings = [emoji, cjk, rtl, combining];
    for (i, expected) in expected_strings.iter().enumerate() {
        let cr = VIEWPORT_HEADER_SIZE + i * CELL_STRIDE;
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(&disp, expected, "unicode string {} mismatch", i);
        // Verify the byte length matches UTF-8 encoding
        assert_eq!(
            disp_len as usize,
            expected.len(),
            "byte length of string {}",
            i
        );
    }
}

#[test]
fn mutation_empty_result() {
    let result = RecalcResult {
        changed_cells: vec![],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "empty-sheet", 0, None);

    let patch_count = read_u32(&buf, 0);
    assert_eq!(patch_count, 0);
    let string_bytes = read_u32(&buf, 4);
    assert_eq!(string_bytes, 0);
    let sheet_id_len = read_u16(&buf, 8) as usize;
    assert_eq!(sheet_id_len, "empty-sheet".len());

    // Total size: header + sheet_id only
    let expected = MUTATION_HEADER_SIZE + sheet_id_len;
    assert_eq!(buf.len(), expected);
}

#[test]
fn mutation_skips_unresolved_positions() {
    // Cells with position: None should be skipped (sub-scope sub-scope D:
    // the u32::MAX sentinel was replaced with Option<CellPosition>).
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "good".into(),
                sheet_id: "s".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
                value: CellValue::Number(FiniteF64::new(1.0).unwrap()),
                display_text: Some("1".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "unresolved".into(),
                sheet_id: "s".into(),
                position: None,
                value: CellValue::Number(FiniteF64::new(2.0).unwrap()),
                display_text: Some("2".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "s", 0, None);
    let patch_count = read_u32(&buf, 0);
    assert_eq!(patch_count, 1, "only the good cell should be serialized");
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

    assert_eq!(read_u16(&buf, 32), 1, "1 data bar");
    assert_eq!(read_u16(&buf, 34), 0, "0 icons");

    // Verify HAS_CF_EXTRAS is set on the cell
    let cr = VIEWPORT_HEADER_SIZE;
    let flags = read_u16(&buf, cr + OFF_FLAGS);
    assert_ne!(flags & HAS_CF_EXTRAS, 0);

    // Find data bar section
    let cell_count = 1;
    let string_pool_bytes = read_u32(&buf, 16) as usize;
    let palette_len = read_u32(&buf, 12) as usize;
    let db_start =
        VIEWPORT_HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes + palette_len; // merges=0, row_dims=0, col_dims=0

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

    assert_eq!(read_u16(&buf, 32), 0, "0 data bars");
    assert_eq!(read_u16(&buf, 34), 1, "1 icon");

    let cell_count = 1;
    let string_pool_bytes = read_u32(&buf, 16) as usize;
    let palette_len = read_u32(&buf, 12) as usize;
    let icons_start =
        VIEWPORT_HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes + palette_len; // no data bars either

    assert_eq!(read_u32(&buf, icons_start), 0, "icon cell_index");
    assert_eq!(read_u8(&buf, icons_start + 4), 20, "set_name_index");
    assert_eq!(read_u8(&buf, icons_start + 5), 4, "icon_index");
    assert_eq!(read_u8(&buf, icons_start + 6), 0, "icon_only = false");
}

#[test]
fn viewport_multiple_cells_with_both_display_and_error_strings() {
    // Verify string pool offsets are correctly computed when multiple cells
    // contribute both display and error strings.
    let data = ViewportRenderData {
        cells: vec![
            cell(
                0,
                0,
                VALUE_TYPE_ERROR,
                f64::NAN,
                Some("Error!"),
                Some("#REF!"),
            ),
            cell(
                0,
                1,
                VALUE_TYPE_ERROR,
                f64::NAN,
                Some("Another"),
                Some("#N/A"),
            ),
        ],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 2,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);

    let cell_count = read_u32(&buf, 8) as usize;
    assert_eq!(cell_count, 2);
    let string_pool_start = VIEWPORT_HEADER_SIZE + cell_count * CELL_STRIDE;

    // Cell 0: display="Error!", error="#REF!"
    let cr0 = VIEWPORT_HEADER_SIZE;
    let d0_off = read_u32(&buf, cr0 + OFF_DISPLAY_OFF);
    let d0_len = read_u16(&buf, cr0 + OFF_DISPLAY_LEN);
    let e0_off = read_u32(&buf, cr0 + OFF_ERROR_OFF);
    let e0_len = read_u16(&buf, cr0 + OFF_ERROR_LEN);
    assert_eq!(
        read_string(&buf, string_pool_start, d0_off, d0_len),
        "Error!"
    );
    assert_eq!(
        read_string(&buf, string_pool_start, e0_off, e0_len),
        "#REF!"
    );

    // Cell 1: display="Another", error="#N/A"
    let cr1 = VIEWPORT_HEADER_SIZE + CELL_STRIDE;
    let d1_off = read_u32(&buf, cr1 + OFF_DISPLAY_OFF);
    let d1_len = read_u16(&buf, cr1 + OFF_DISPLAY_LEN);
    let e1_off = read_u32(&buf, cr1 + OFF_ERROR_OFF);
    let e1_len = read_u16(&buf, cr1 + OFF_ERROR_LEN);
    assert_eq!(
        read_string(&buf, string_pool_start, d1_off, d1_len),
        "Another"
    );
    assert_eq!(read_string(&buf, string_pool_start, e1_off, e1_len), "#N/A");

    // Verify no overlaps: all offsets and lengths should be non-overlapping
    let ranges = [
        (d0_off, d0_len as u32),
        (e0_off, e0_len as u32),
        (d1_off, d1_len as u32),
        (e1_off, e1_len as u32),
    ];
    for i in 0..ranges.len() {
        for j in (i + 1)..ranges.len() {
            let (a_off, a_len) = ranges[i];
            let (b_off, b_len) = ranges[j];
            let a_end = a_off + a_len;
            let b_end = b_off + b_len;
            assert!(
                a_end <= b_off || b_end <= a_off,
                "string pool ranges overlap: [{}, {}) vs [{}, {})",
                a_off,
                a_end,
                b_off,
                b_end
            );
        }
    }
}

#[test]
fn mutation_unicode_display_text() {
    let emoji_text = "\u{1F4B0}\u{1F4B0}\u{1F4B0}"; // money bags
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c".into(),
            sheet_id: "s".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Text(emoji_text.into()),
            display_text: Some(emoji_text.into()),
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "s", 0, None);
    let sheet_id_len = read_u16(&buf, 8) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let string_pool_start = patches_start + PATCH_STRIDE;

    let cr = patches_start + 8;
    let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
    let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
    let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
    assert_eq!(disp, emoji_text);
}

#[test]
fn viewport_stride_alignment_smoke() {
    // Verify that CELL_STRIDE (32) matches the actual written bytes per cell
    // by checking that cell N+1's data is at exactly CELL_STRIDE bytes after cell N.
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

    // Each cell should have its number_value at (HEADER + i*STRIDE + OFF_NUMBER_VALUE)
    for i in 0..3 {
        let expected_val = (i + 1) as f64;
        let actual = read_f64(
            &buf,
            VIEWPORT_HEADER_SIZE + i * CELL_STRIDE + OFF_NUMBER_VALUE,
        );
        assert_eq!(actual, expected_val, "cell {} number_value", i);
    }
}

#[test]
fn mutation_stride_alignment_smoke() {
    // Verify PATCH_STRIDE (40) = 8 (row+col) + 32 (cell record)
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "a".into(),
                sheet_id: "s".into(),
                position: Some(snapshot_types::CellPosition { row: 10, col: 20 }),
                value: CellValue::Number(FiniteF64::new(100.0).unwrap()),
                display_text: Some("100".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "b".into(),
                sheet_id: "s".into(),
                position: Some(snapshot_types::CellPosition { row: 30, col: 40 }),
                value: CellValue::Number(FiniteF64::new(200.0).unwrap()),
                display_text: Some("200".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "s", 0, None);
    let sheet_id_len = read_u16(&buf, 8) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;

    // Patch 0
    assert_eq!(read_u32(&buf, patches_start), 10);
    assert_eq!(read_u32(&buf, patches_start + 4), 20);
    assert_eq!(read_f64(&buf, patches_start + 8 + OFF_NUMBER_VALUE), 100.0);

    // Patch 1 (at patches_start + PATCH_STRIDE)
    let p1 = patches_start + PATCH_STRIDE;
    assert_eq!(read_u32(&buf, p1), 30);
    assert_eq!(read_u32(&buf, p1 + 4), 40);
    assert_eq!(read_f64(&buf, p1 + 8 + OFF_NUMBER_VALUE), 200.0);
}
