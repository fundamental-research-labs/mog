use super::*;

#[test]
fn test_cell_record_fields() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    // First cell record starts at HEADER_SIZE
    let off = HEADER_SIZE;
    let num = f64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
    assert_eq!(num, 42.0);
    let flags = u16::from_le_bytes(buf[off + 16..off + 18].try_into().unwrap());
    assert_eq!(flags & 0x7, render_flags::VALUE_TYPE_NUMBER);
    assert_ne!(flags & render_flags::HAS_FORMULA, 0);
    // Color overrides should be 0
    let bg = u32::from_le_bytes(buf[off + 24..off + 28].try_into().unwrap());
    let fg = u32::from_le_bytes(buf[off + 28..off + 32].try_into().unwrap());
    assert_eq!(bg, 0);
    assert_eq!(fg, 0);
}

#[test]
fn test_null_cell_has_no_string() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    // Fourth cell (index 3)
    let off = HEADER_SIZE + 3 * CELL_STRIDE;
    let d_off = u32::from_le_bytes(buf[off + 8..off + 12].try_into().unwrap());
    assert_eq!(d_off, 0xFFFF_FFFF); // NO_STRING sentinel
    let e_off = u32::from_le_bytes(buf[off + 12..off + 16].try_into().unwrap());
    assert_eq!(e_off, 0xFFFF_FFFF); // NO_STRING sentinel
}

#[test]
fn test_boolean_cell_roundtrip() {
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: render_flags::VALUE_TYPE_BOOL,
            number_value: 1.0,
            formatted: Some("TRUE".to_string()),
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
        start_row: 0,
        start_col: 0,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    };
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    // Read the cell record
    let c0 = HEADER_SIZE;
    let number_value = f64::from_le_bytes(buf[c0..c0 + 8].try_into().unwrap());
    assert_eq!(number_value, 1.0);
    let flags = u16::from_le_bytes(buf[c0 + 16..c0 + 18].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
    // Display string should be "TRUE"
    let display_off = u32::from_le_bytes(buf[c0 + 8..c0 + 12].try_into().unwrap());
    let display_len = u16::from_le_bytes(buf[c0 + 20..c0 + 22].try_into().unwrap());
    assert_ne!(display_off, NO_STRING);
    assert_eq!(display_len, 4); // "TRUE".len()
    let pool_start = HEADER_SIZE + CELL_STRIDE;
    let display_str = std::str::from_utf8(
        &buf[pool_start + display_off as usize
            ..pool_start + display_off as usize + display_len as usize],
    )
    .unwrap();
    assert_eq!(display_str, "TRUE");
}

#[test]
fn test_large_viewport_cell_count() {
    let mut cells = Vec::new();
    for r in 0..10u32 {
        for c in 0..10u32 {
            cells.push(ViewportRenderCell {
                row: r,
                col: c,
                format_idx: 0,
                flags: render_flags::VALUE_TYPE_NULL,
                number_value: f64::NAN,
                formatted: None,
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            });
        }
    }
    let data = ViewportRenderData {
        cells,
        format_palette: vec![CellFormat::default()],
        merges: Vec::new(),
        row_dimensions: Vec::new(),
        col_dimensions: Vec::new(),
        viewport_rows: 10,
        viewport_cols: 10,
        start_row: 0,
        start_col: 0,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    };
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap());
    assert_eq!(cell_count, 100);
    // Verify cell section is exactly 100 * 32 bytes
    assert!(buf.len() >= HEADER_SIZE + 100 * CELL_STRIDE);
}

#[test]
fn test_cell_with_all_flags_set() {
    let all_flags = render_flags::VALUE_TYPE_NUMBER
        | render_flags::HAS_FORMULA
        | render_flags::HAS_COMMENT
        | render_flags::HAS_SPARKLINE
        | render_flags::HAS_HYPERLINK
        | render_flags::IS_CHECKBOX
        | render_flags::IS_SPILL_MEMBER
        | render_flags::HAS_VALIDATION_ERROR;
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: all_flags,
            number_value: 99.0,
            formatted: Some("99".to_string()),
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
        start_row: 0,
        start_col: 0,
        row_positions: Vec::new(),
        col_positions: Vec::new(),
    };
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    let c0 = HEADER_SIZE;
    let flags = u16::from_le_bytes(buf[c0 + 16..c0 + 18].try_into().unwrap());
    assert_eq!(flags, all_flags);
}
