//! Tests for outline-group collapse affecting `get_row_height_query`/`get_col_width_query`.
//!
//! These two queries used to consult only the explicit `KEY_HIDDEN_ROWS` /
//! `KEY_HIDDEN_COLS` maps. Outline groups (Data > Group / Outline) collapse
//! state was tracked separately and not surfaced by the layout queries, so
//! the renderer would paint collapsed rows at their stored height. The TS
//! devtools API used to mirror the collapse state into a JS shim to mask
//! this gap. The shim is now deleted; the queries themselves return 0 for
//! rows/cols inside a collapsed outline group.

use super::super::*;
use super::helpers::*;
use compute_wire::constants::{CELL_STRIDE, DIM_STRIDE, MERGE_STRIDE, VIEWPORT_HEADER_SIZE};

#[derive(serde::Deserialize)]
struct GroupDefId {
    id: String,
}

fn created_group_id(group_result: MutationResult) -> String {
    let group_def = group_result
        .data
        .expect("group definition returned in MutationResult.data");
    serde_json::from_value::<GroupDefId>(group_def)
        .expect("parse group def")
        .id
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn read_f32(bytes: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn viewport_dimension_offsets(viewport_bytes: &[u8]) -> (usize, usize, usize, usize) {
    let cell_count = read_u32(viewport_bytes, 8) as usize;
    let string_pool_bytes = read_u32(viewport_bytes, 16) as usize;
    let merge_count = read_u16(viewport_bytes, 24) as usize;
    let row_dim_count = read_u16(viewport_bytes, 26) as usize;
    let col_dim_count = read_u16(viewport_bytes, 28) as usize;

    let row_dims_start = VIEWPORT_HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * MERGE_STRIDE;
    let col_dims_start = row_dims_start + row_dim_count * DIM_STRIDE;
    (row_dims_start, row_dim_count, col_dims_start, col_dim_count)
}

fn viewport_row_height(viewport_bytes: &[u8], target_row: u32) -> Option<f32> {
    let (row_dims_start, row_dim_count, _, _) = viewport_dimension_offsets(viewport_bytes);
    for index in 0..row_dim_count {
        let offset = row_dims_start + index * DIM_STRIDE;
        if read_u32(viewport_bytes, offset) == target_row {
            return Some(read_f32(viewport_bytes, offset + 4));
        }
    }
    None
}

fn viewport_col_width(viewport_bytes: &[u8], target_col: u32) -> Option<f32> {
    let (_, _, col_dims_start, col_dim_count) = viewport_dimension_offsets(viewport_bytes);
    for index in 0..col_dim_count {
        let offset = col_dims_start + index * DIM_STRIDE;
        if read_u32(viewport_bytes, offset) == target_col {
            return Some(read_f32(viewport_bytes, offset + 4));
        }
    }
    None
}

#[test]
fn collapsed_outline_group_returns_zero_row_height() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Group rows 2..=4 (inclusive). Three rows, default height before collapse.
    let (_, group_result) = engine.group_rows(&sid, 2, 4).expect("group_rows");
    let group_id = created_group_id(group_result);

    // Sanity: before collapse, rows 2..=4 have non-zero height.
    for row in 2..=4 {
        let h = engine.get_row_height_query(&sid, row);
        assert!(
            h > 0.0,
            "row {row} should have non-zero height before collapse (got {h})"
        );
    }

    // Collapse the group.
    engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("set_group_collapsed");

    // Excel collapse semantics: with `summary_rows_below=true` (the default),
    // the last row of the group is the summary row and stays visible.
    // Rows 2..=3 (the non-summary members) become hidden.
    for row in 2..=3 {
        let h = engine.get_row_height_query(&sid, row);
        assert_eq!(
            h, 0.0,
            "row {row} should have zero rendered height when its outline group is collapsed (got {h})"
        );
    }
    // The summary row (4 = group.end) remains visible.
    assert!(
        engine.get_row_height_query(&sid, 4) > 0.0,
        "summary row 4 should remain visible when its group is collapsed"
    );

    // Row 1 (above the group) and row 5 (below the group) must remain visible.
    assert!(
        engine.get_row_height_query(&sid, 1) > 0.0,
        "row 1 (outside group) should keep its height"
    );
    assert!(
        engine.get_row_height_query(&sid, 5) > 0.0,
        "row 5 (outside group) should keep its height"
    );
}

#[test]
fn collapsed_outline_column_group_returns_zero_col_width() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Group columns 3..=6 (inclusive).
    let (_, group_result) = engine.group_columns(&sid, 3, 6).expect("group_columns");
    let group_id = created_group_id(group_result);

    // Before collapse: non-zero widths.
    for col in 3..=6 {
        let w = engine.get_col_width_query(&sid, col);
        assert!(
            w > 0.0,
            "col {col} should have non-zero width before collapse (got {w})"
        );
    }

    engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("set_group_collapsed");

    // With `summary_columns_right=true` (default), the rightmost column of
    // the group is the summary column and stays visible. Cols 3..=5 (the
    // non-summary members) become hidden.
    for col in 3..=5 {
        let w = engine.get_col_width_query(&sid, col);
        assert_eq!(
            w, 0.0,
            "col {col} should have zero rendered width when its outline group is collapsed (got {w})"
        );
    }
    assert!(
        engine.get_col_width_query(&sid, 6) > 0.0,
        "summary column 6 should remain visible when its group is collapsed"
    );

    assert!(
        engine.get_col_width_query(&sid, 2) > 0.0,
        "col 2 (outside group) should keep its width"
    );
    assert!(
        engine.get_col_width_query(&sid, 7) > 0.0,
        "col 7 (outside group) should keep its width"
    );
}

#[test]
fn explicit_hide_still_works_alongside_outline_groups() {
    // Sanity: the new check is OR-ed with the existing hide check. An
    // explicitly hidden row outside any group must still report height 0.
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let _ = engine.hide_rows(&sid, &[10]).expect("hide_rows");
    let h = engine.get_row_height_query(&sid, 10);
    assert_eq!(h, 0.0, "explicitly hidden row must still report height 0");
}

#[test]
fn expanded_outline_group_does_not_zero_height() {
    // Sanity: a group that was created but never collapsed must NOT zero
    // the row heights — it's just an outline marker until a user clicks
    // the collapse arrow.
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine.group_rows(&sid, 2, 4).expect("group_rows");

    for row in 2..=4 {
        let h = engine.get_row_height_query(&sid, row);
        assert!(
            h > 0.0,
            "row {row} in an expanded group should keep its height (got {h})"
        );
    }
}

#[test]
fn collapsed_outline_group_updates_layout_index_and_viewport_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 8, 6)
        .expect("register viewport");

    let (_, group_result) = engine.group_rows(&sid, 2, 4).expect("group_rows");
    let group_id = created_group_id(group_result);

    let (collapse_patches, _) = engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("set_group_collapsed");

    let layout = engine.layout_index(&sid).expect("layout index");
    assert_eq!(layout.get_row_height(2).0, 0.0);
    assert_eq!(layout.get_row_height(3).0, 0.0);
    assert!(layout.get_row_height(4).0 > 0.0);

    let render_data = engine.build_viewport_render_data(&sid, 0, 0, 8, 6);
    assert_eq!(render_data.row_dimensions[2].height, 0.0);
    assert_eq!(render_data.row_dimensions[3].height, 0.0);
    assert!(render_data.row_dimensions[4].height > 0.0);
    assert!(
        !render_data.row_dimensions[2].hidden,
        "outline collapse affects effective height, not explicit hidden state"
    );

    let viewport_bytes =
        extract_first_viewport_mutation(&collapse_patches).expect("viewport patch");
    assert_eq!(viewport_row_height(&viewport_bytes, 2), Some(0.0));
    assert_eq!(viewport_row_height(&viewport_bytes, 3), Some(0.0));
    assert!(viewport_row_height(&viewport_bytes, 4).is_some_and(|height| height > 0.0));

    let (expand_patches, _) = engine
        .set_group_collapsed(&sid, &group_id, false)
        .expect("set_group_collapsed");
    let layout = engine.layout_index(&sid).expect("layout index");
    assert!(layout.get_row_height(2).0 > 0.0);
    assert!(layout.get_row_height(3).0 > 0.0);

    let viewport_bytes = extract_first_viewport_mutation(&expand_patches).expect("viewport patch");
    assert!(viewport_row_height(&viewport_bytes, 2).is_some_and(|height| height > 0.0));
    assert!(viewport_row_height(&viewport_bytes, 3).is_some_and(|height| height > 0.0));
}

#[test]
fn collapsed_outline_group_updates_layout_index_and_viewport_columns() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 8, 8)
        .expect("register viewport");

    let (_, group_result) = engine.group_columns(&sid, 3, 6).expect("group_columns");
    let group_id = created_group_id(group_result);

    let (collapse_patches, _) = engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("set_group_collapsed");

    let layout = engine.layout_index(&sid).expect("layout index");
    assert_eq!(layout.get_col_width(3).0, 0.0);
    assert_eq!(layout.get_col_width(4).0, 0.0);
    assert_eq!(layout.get_col_width(5).0, 0.0);
    assert!(layout.get_col_width(6).0 > 0.0);

    let render_data = engine.build_viewport_render_data(&sid, 0, 0, 8, 8);
    assert_eq!(render_data.col_dimensions[3].width, 0.0);
    assert_eq!(render_data.col_dimensions[4].width, 0.0);
    assert_eq!(render_data.col_dimensions[5].width, 0.0);
    assert!(render_data.col_dimensions[6].width > 0.0);
    assert!(
        !render_data.col_dimensions[3].hidden,
        "outline collapse affects effective width, not explicit hidden state"
    );

    let viewport_bytes =
        extract_first_viewport_mutation(&collapse_patches).expect("viewport patch");
    assert_eq!(viewport_col_width(&viewport_bytes, 3), Some(0.0));
    assert_eq!(viewport_col_width(&viewport_bytes, 4), Some(0.0));
    assert_eq!(viewport_col_width(&viewport_bytes, 5), Some(0.0));
    assert!(viewport_col_width(&viewport_bytes, 6).is_some_and(|width| width > 0.0));
}
