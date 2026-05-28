use super::*;

#[test]
fn test_cf_extras_data_bar_and_icon() {
    let mut data = make_test_data();
    // Add CF extras to the first cell (data bar + icon)
    data.cells[0].bg_color_override = 0xFF0000FF; // red bg
    data.cells[0].font_color_override = 0x00FF00FF; // green font
    data.cells[0].cf_extras = Some(CellCFExtras {
        data_bar: Some(DataBarRenderData {
            fill_percent: 0.75,
            color: 0x0000FFFF,
            is_negative: false,
            gradient: true,
            show_value: true,
            show_axis: true,
            axis_position: 0.5,
            negative_color: 0xFF000088,
        }),
        icon: Some(IconRenderData {
            set_name_index: 3,
            icon_index: 2,
            icon_only: true,
        }),
    });
    // Add icon-only CF extras to the second cell
    data.cells[1].cf_extras = Some(CellCFExtras {
        data_bar: None,
        icon: Some(IconRenderData {
            set_name_index: 1,
            icon_index: 0,
            icon_only: false,
        }),
    });

    let buf = serialize_viewport_binary(&data, 0, false, 0);

    // Header: data_bar_count and icon_count
    let db_count = u16::from_le_bytes(buf[32..34].try_into().unwrap());
    let icon_count = u16::from_le_bytes(buf[34..36].try_into().unwrap());
    assert_eq!(db_count, 1);
    assert_eq!(icon_count, 2);

    // Cell 0: verify color overrides in the cell record
    let c0 = HEADER_SIZE;
    let bg = u32::from_le_bytes(buf[c0 + 24..c0 + 28].try_into().unwrap());
    let fg = u32::from_le_bytes(buf[c0 + 28..c0 + 32].try_into().unwrap());
    assert_eq!(bg, 0xFF0000FF);
    assert_eq!(fg, 0x00FF00FF);

    // Cell 0: HAS_CF_EXTRAS flag should be set
    let flags0 = u16::from_le_bytes(buf[c0 + 16..c0 + 18].try_into().unwrap());
    assert_ne!(flags0 & render_flags::HAS_CF_EXTRAS, 0);

    // Cell 1: HAS_CF_EXTRAS flag should also be set
    let c1 = HEADER_SIZE + CELL_STRIDE;
    let flags1 = u16::from_le_bytes(buf[c1 + 16..c1 + 18].try_into().unwrap());
    assert_ne!(flags1 & render_flags::HAS_CF_EXTRAS, 0);

    // Locate data bar section: after palette JSON
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
    let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
    let db_start = HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * MERGE_STRIDE
        + row_dim_count * DIM_STRIDE
        + col_dim_count * DIM_STRIDE
        + palette_len;

    // Read data bar entry (24 bytes)
    let db_cell_idx = u32::from_le_bytes(buf[db_start..db_start + 4].try_into().unwrap());
    assert_eq!(db_cell_idx, 0); // cell index 0
    let fill = f32::from_le_bytes(buf[db_start + 4..db_start + 8].try_into().unwrap());
    assert_eq!(fill, 0.75);
    let db_color = u32::from_le_bytes(buf[db_start + 8..db_start + 12].try_into().unwrap());
    assert_eq!(db_color, 0x0000FFFF);
    let db_flags = u32::from_le_bytes(buf[db_start + 12..db_start + 16].try_into().unwrap());
    assert_eq!(db_flags & 0x1, 1); // gradient
    assert_eq!(db_flags & 0x2, 0); // not negative
    assert_eq!(db_flags & 0x4, 4); // show_value
    assert_eq!(db_flags & 0x8, 8); // show_axis
    let axis = f32::from_le_bytes(buf[db_start + 16..db_start + 20].try_into().unwrap());
    assert_eq!(axis, 0.5);
    let neg_color = u32::from_le_bytes(buf[db_start + 20..db_start + 24].try_into().unwrap());
    assert_eq!(neg_color, 0xFF000088);

    // Read icon entries (8 bytes each)
    let icon_start = db_start + DATA_BAR_ENTRY_STRIDE;
    // First icon (cell 0)
    let icon0_cell = u32::from_le_bytes(buf[icon_start..icon_start + 4].try_into().unwrap());
    assert_eq!(icon0_cell, 0);
    assert_eq!(buf[icon_start + 4], 3); // set_name_index
    assert_eq!(buf[icon_start + 5], 2); // icon_index
    assert_eq!(buf[icon_start + 6], 1); // icon_only = true
    assert_eq!(buf[icon_start + 7], 0); // padding

    // Second icon (cell 1)
    let icon1_start = icon_start + ICON_ENTRY_STRIDE;
    let icon1_cell = u32::from_le_bytes(buf[icon1_start..icon1_start + 4].try_into().unwrap());
    assert_eq!(icon1_cell, 1);
    assert_eq!(buf[icon1_start + 4], 1); // set_name_index
    assert_eq!(buf[icon1_start + 5], 0); // icon_index
    assert_eq!(buf[icon1_start + 6], 0); // icon_only = false
}

#[test]
fn test_data_bar_negative() {
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: render_flags::VALUE_TYPE_NUMBER,
            number_value: -5.0,
            formatted: Some("-5".to_string()),
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: Some(CellCFExtras {
                data_bar: Some(DataBarRenderData {
                    fill_percent: 0.3,
                    color: 0xFF0000FF,
                    is_negative: true,
                    gradient: false,
                    show_value: false,
                    show_axis: false,
                    axis_position: 0.0,
                    negative_color: 0x00FF00FF,
                }),
                icon: None,
            }),
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

    // Locate data bar section
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
    let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
    let db_start = HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * MERGE_STRIDE
        + row_dim_count * DIM_STRIDE
        + col_dim_count * DIM_STRIDE
        + palette_len;

    let db_flags = u32::from_le_bytes(buf[db_start + 12..db_start + 16].try_into().unwrap());
    // gradient=false(0), is_negative=true(1<<1=2), show_value=false(0), show_axis=false(0)
    assert_eq!(db_flags, 0x2);

    // Verify fill_percent and colors too
    let fill = f32::from_le_bytes(buf[db_start + 4..db_start + 8].try_into().unwrap());
    assert_eq!(fill, 0.3);
    let neg_color = u32::from_le_bytes(buf[db_start + 20..db_start + 24].try_into().unwrap());
    assert_eq!(neg_color, 0x00FF00FF);
}
