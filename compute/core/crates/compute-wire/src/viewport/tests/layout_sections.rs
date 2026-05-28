use super::*;

#[test]
fn test_merge_record_roundtrip() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_start = HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes;
    let sr = u32::from_le_bytes(buf[merge_start..merge_start + 4].try_into().unwrap());
    let sc = u32::from_le_bytes(buf[merge_start + 4..merge_start + 8].try_into().unwrap());
    let er = u32::from_le_bytes(buf[merge_start + 8..merge_start + 12].try_into().unwrap());
    let ec = u32::from_le_bytes(buf[merge_start + 12..merge_start + 16].try_into().unwrap());
    assert_eq!((sr, sc, er, ec), (0, 0, 1, 1));
}

#[test]
fn test_row_dimension_roundtrip() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_start =
        HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes + merge_count * MERGE_STRIDE;
    let row = u32::from_le_bytes(buf[row_dim_start..row_dim_start + 4].try_into().unwrap());
    let height = f32::from_le_bytes(
        buf[row_dim_start + 4..row_dim_start + 8]
            .try_into()
            .unwrap(),
    );
    let flags = u32::from_le_bytes(
        buf[row_dim_start + 8..row_dim_start + 12]
            .try_into()
            .unwrap(),
    );
    assert_eq!(row, 0);
    assert_eq!(height, 20.0);
    assert_eq!(flags, 0); // not hidden
}

#[test]
fn test_col_dimension_roundtrip() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
    let col_dim_start = HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * MERGE_STRIDE
        + row_dim_count * DIM_STRIDE;
    let col = u32::from_le_bytes(buf[col_dim_start..col_dim_start + 4].try_into().unwrap());
    let width = f32::from_le_bytes(
        buf[col_dim_start + 4..col_dim_start + 8]
            .try_into()
            .unwrap(),
    );
    let flags = u32::from_le_bytes(
        buf[col_dim_start + 8..col_dim_start + 12]
            .try_into()
            .unwrap(),
    );
    assert_eq!(col, 1);
    assert_eq!(width, 100.5);
    assert_eq!(flags, 1); // hidden
}

#[test]
fn test_multiple_merges() {
    let mut data = make_test_data();
    data.merges = vec![
        RenderViewportMerge {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
        },
        RenderViewportMerge {
            start_row: 2,
            start_col: 3,
            end_row: 4,
            end_col: 5,
        },
        RenderViewportMerge {
            start_row: 10,
            start_col: 20,
            end_row: 15,
            end_col: 25,
        },
    ];
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap());
    assert_eq!(merge_count, 3);

    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_start = HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes;

    let expected = [(0u32, 0u32, 1u32, 1u32), (2, 3, 4, 5), (10, 20, 15, 25)];
    for (i, &(sr, sc, er, ec)) in expected.iter().enumerate() {
        let off = merge_start + i * MERGE_STRIDE;
        assert_eq!(
            u32::from_le_bytes(buf[off..off + 4].try_into().unwrap()),
            sr
        );
        assert_eq!(
            u32::from_le_bytes(buf[off + 4..off + 8].try_into().unwrap()),
            sc
        );
        assert_eq!(
            u32::from_le_bytes(buf[off + 8..off + 12].try_into().unwrap()),
            er
        );
        assert_eq!(
            u32::from_le_bytes(buf[off + 12..off + 16].try_into().unwrap()),
            ec
        );
    }
}

#[test]
fn test_hidden_row_and_col_dimensions() {
    let mut data = make_test_data();
    data.row_dimensions = vec![
        RenderRowDimension {
            row: 0,
            height: 20.0,
            hidden: true,
        },
        RenderRowDimension {
            row: 1,
            height: 30.0,
            hidden: false,
        },
    ];
    data.col_dimensions = vec![
        RenderColDimension {
            col: 0,
            width: 80.0,
            hidden: false,
        },
        RenderColDimension {
            col: 1,
            width: 100.0,
            hidden: true,
        },
    ];
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
    let row_dim_start =
        HEADER_SIZE + cell_count * CELL_STRIDE + string_pool_bytes + merge_count * MERGE_STRIDE;

    // Row 0: hidden=true → flags=1
    let flags0 = u32::from_le_bytes(
        buf[row_dim_start + 8..row_dim_start + 12]
            .try_into()
            .unwrap(),
    );
    assert_eq!(flags0, 1);
    // Row 1: hidden=false → flags=0
    let flags1 = u32::from_le_bytes(
        buf[row_dim_start + DIM_STRIDE + 8..row_dim_start + DIM_STRIDE + 12]
            .try_into()
            .unwrap(),
    );
    assert_eq!(flags1, 0);

    let col_dim_start = row_dim_start + 2 * DIM_STRIDE;
    // Col 0: hidden=false → flags=0
    let cflags0 = u32::from_le_bytes(
        buf[col_dim_start + 8..col_dim_start + 12]
            .try_into()
            .unwrap(),
    );
    assert_eq!(cflags0, 0);
    // Col 1: hidden=true → flags=1
    let cflags1 = u32::from_le_bytes(
        buf[col_dim_start + DIM_STRIDE + 8..col_dim_start + DIM_STRIDE + 12]
            .try_into()
            .unwrap(),
    );
    assert_eq!(cflags1, 1);
}
