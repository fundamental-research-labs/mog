use super::*;

#[test]
fn test_serialized_size_matches_expected() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    // 36 header + 4*32 cells + string_pool + 1*16 merge + 1*12 row_dim + 1*12 col_dim + palette_binary
    let string_pool_len = "42".len() + "Hello".len() + "#DIV/0!".len(); // 2 + 5 + 7 = 14
    let expected_min = HEADER_SIZE + 4 * CELL_STRIDE + string_pool_len + 16 + 12 + 12;
    assert!(buf.len() > expected_min); // palette JSON adds variable bytes
}

#[test]
fn test_header_fields_roundtrip() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 42, false, 0);
    // Read header fields back (little-endian)
    assert_eq!(u32::from_le_bytes(buf[0..4].try_into().unwrap()), 0); // start_row
    assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()), 0); // start_col
    assert_eq!(u32::from_le_bytes(buf[8..12].try_into().unwrap()), 4); // cell_count
    assert_eq!(u16::from_le_bytes(buf[20..22].try_into().unwrap()), 2); // viewport_rows
    assert_eq!(u16::from_le_bytes(buf[22..24].try_into().unwrap()), 2); // viewport_cols
    assert_eq!(u16::from_le_bytes(buf[24..26].try_into().unwrap()), 1); // merge_count
    assert_eq!(u16::from_le_bytes(buf[26..28].try_into().unwrap()), 1); // row_dim_count
    assert_eq!(u16::from_le_bytes(buf[28..30].try_into().unwrap()), 1); // col_dim_count
    assert_eq!(buf[30] & 0x01, 0); // not delta
    assert_eq!(buf[30] >> 4, WIRE_VERSION); // version in bits 4-7
    assert_eq!(buf[31], 42); // generation
    assert_eq!(u16::from_le_bytes(buf[32..34].try_into().unwrap()), 0); // data_bar_count
    assert_eq!(u16::from_le_bytes(buf[34..36].try_into().unwrap()), 0); // icon_count
}

#[test]
fn test_is_delta_flag() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, true, 5);
    assert_eq!(buf[30] & 0x01, 1); // is_delta bit set
}

#[test]
fn test_format_palette_binary_included() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
    assert!(palette_len > 0);
    // Extract palette bytes from the buffer and decode them
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
    let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
    let palette_start = HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * crate::constants::MERGE_STRIDE
        + row_dim_count * crate::constants::DIM_STRIDE
        + col_dim_count * crate::constants::DIM_STRIDE;
    let palette_bytes = &buf[palette_start..palette_start + palette_len];
    let (start_idx, formats) =
        crate::palette_binary::deserialize_palette_binary(palette_bytes).unwrap();
    assert_eq!(start_idx, 0);
    assert_eq!(formats.len(), 2);
}

#[test]
fn test_delta_palette_start_index() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, true, 7);
    let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
    let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
    let palette_start = HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * crate::constants::MERGE_STRIDE
        + row_dim_count * crate::constants::DIM_STRIDE
        + col_dim_count * crate::constants::DIM_STRIDE;
    let palette_bytes = &buf[palette_start..palette_start + palette_len];
    let (start_idx, _formats) =
        crate::palette_binary::deserialize_palette_binary(palette_bytes).unwrap();
    assert_eq!(start_idx, 7);
}

#[test]
fn test_empty_viewport() {
    let data = ViewportRenderData {
        cells: vec![],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 0,
        viewport_cols: 0,
        start_row: 5,
        start_col: 3,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    };
    let buf = serialize_viewport_binary(&data, 1, false, 0);
    assert_eq!(u32::from_le_bytes(buf[0..4].try_into().unwrap()), 5); // start_row
    assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()), 3); // start_col
    assert_eq!(u32::from_le_bytes(buf[8..12].try_into().unwrap()), 0); // cell_count
    assert_eq!(buf[31], 1); // generation
    // Should still have palette JSON at the end
    let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
    assert!(palette_len > 0);
}

#[test]
fn test_viewport_nonzero_start() {
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 100,
            col: 50,
            format_idx: 0,
            flags: render_flags::VALUE_TYPE_NULL,
            number_value: f64::NAN,
            formatted: None,
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }],
        format_palette: vec![CellFormat::default()],
        merges: Vec::new(),
        row_dimensions: Vec::new(),
        col_dimensions: Vec::new(),
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 100,
        start_col: 50,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    };
    let buf = serialize_viewport_binary(&data, 7, true, 0);

    let start_row = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    let start_col = u32::from_le_bytes(buf[4..8].try_into().unwrap());
    assert_eq!(start_row, 100);
    assert_eq!(start_col, 50);

    let flags_byte = buf[30];
    assert_eq!(flags_byte & 0x01, 1); // is_delta = true

    let generation = buf[31];
    assert_eq!(generation, 7);
}

/// Regression test: extreme viewport dimensions with few actual cells
/// must not OOM. Previously, `cell_count = viewport_rows * viewport_cols`
/// was used for pre-allocation, causing a 128GB allocation attempt.

#[test]
fn test_extreme_viewport_dims_no_oom() {
    let data = ViewportRenderData {
        cells: vec![],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: u32::MAX,
        viewport_cols: u32::MAX,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };
    // Must complete without OOM. Header cell_count should be 0.
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap());
    assert_eq!(cell_count, 0);
}
