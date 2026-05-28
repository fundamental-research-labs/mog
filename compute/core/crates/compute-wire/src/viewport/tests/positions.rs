use super::*;

#[test]
fn test_row_col_positions_roundtrip() {
    let mut cells = Vec::new();
    for r in 0..3u32 {
        for c in 0..3u32 {
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
        viewport_rows: 3,
        viewport_cols: 3,
        start_row: 0,
        start_col: 0,
        // Length = viewport_rows + 1 (3 in-range entries + 1 trailing sentinel).
        row_positions: vec![0.0, 25.5, 51.0, 76.5],
        col_positions: vec![0.0, 80.0, 160.5, 240.5],
    };
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    // (R+1) + (C+1) entries, each 8 bytes.
    let row_pos_count = 4usize;
    let col_pos_count = 4usize;
    let positions_total = (row_pos_count + col_pos_count) * POSITION_ENTRY_SIZE;
    let pos_start = buf.len() - positions_total;

    // Read row positions (including trailing sentinel)
    for i in 0..row_pos_count {
        let off = pos_start + i * 8;
        let val = f64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
        assert_eq!(val, data.row_positions[i]);
    }
    // Read col positions (including trailing sentinel)
    for i in 0..col_pos_count {
        let off = pos_start + row_pos_count * 8 + i * 8;
        let val = f64::from_le_bytes(buf[off..off + 8].try_into().unwrap());
        assert_eq!(val, data.col_positions[i]);
    }
}
