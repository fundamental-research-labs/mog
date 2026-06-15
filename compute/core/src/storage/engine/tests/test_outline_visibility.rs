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
use crate::snapshot::Axis;
use domain_types::{
    ColDimension, OutlineGroup, ParseOutput, RowDimension, SheetData, SheetDimensions,
};

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

fn assert_empty_viewport_patches(patches: &[u8]) {
    assert_eq!(
        patches,
        &[0, 0],
        "visibility-changing outline mutations should not duplicate the client geometry refresh"
    );
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

    assert_eq!(
        engine.get_hidden_rows(&sid),
        vec![2, 3, 4],
        "bulk hidden-row query must include rows hidden by collapsed outline groups"
    );

    // Excel collapse semantics: group.start..=group.end are detail rows.
    // With `summary_rows_below=true` (the default), the summary row is the
    // adjacent row after the group and every grouped detail row is hidden.
    for row in 2..=4 {
        let h = engine.get_row_height_query(&sid, row);
        assert_eq!(
            h, 0.0,
            "row {row} should have zero rendered height when its outline group is collapsed (got {h})"
        );
    }

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

    assert_eq!(
        engine.get_hidden_columns(&sid),
        vec![3, 4, 5, 6],
        "bulk hidden-column query must include columns hidden by collapsed outline groups"
    );

    // With `summary_columns_right=true` (default), the summary column is the
    // adjacent column after the group and every grouped detail column is hidden.
    for col in 3..=6 {
        let w = engine.get_col_width_query(&sid, col);
        assert_eq!(
            w, 0.0,
            "col {col} should have zero rendered width when its outline group is collapsed (got {w})"
        );
    }

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
fn imported_hidden_outline_columns_expand_to_visible_columns() {
    let mut col_widths: Vec<ColDimension> = (3..=6)
        .map(|col| ColDimension {
            col,
            width: 8.43,
            width_present: Some(true),
            hidden: true,
            hidden_attr: Some(true),
            ..Default::default()
        })
        .collect();
    col_widths.push(ColDimension {
        col: 7,
        width: 8.43,
        width_present: Some(true),
        collapsed: true,
        collapsed_attr: Some(true),
        ..Default::default()
    });

    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Imported".to_string(),
            rows: 20,
            cols: 12,
            dimensions: SheetDimensions {
                col_widths,
                ..Default::default()
            },
            outline_groups: vec![OutlineGroup {
                is_row: false,
                start: 3,
                end: 6,
                level: 1,
                collapsed: true,
                hidden: true,
                collapsed_on_member: false,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut engine = engine_from_parse_output_normal(&input);
    let sid = *engine.mirror().sheet_ids().next().expect("sheet id");

    assert_eq!(engine.get_col_width_query(&sid, 3), 0.0);
    assert!(
        engine.is_col_hidden_query(&sid, 3),
        "imported collapsed outline columns should report hidden before expansion"
    );
    let exported_before_expand = engine
        .export_to_parse_output()
        .expect("export before expand")
        .parse_output;
    assert!(
        exported_before_expand.sheets[0]
            .dimensions
            .col_widths
            .iter()
            .any(|col| col.col == 7 && col.collapsed),
        "imported collapsed summary column marker should be present before expansion"
    );

    let group_id = engine
        .get_groups(&sid, "column")
        .first()
        .expect("column group")
        .id
        .clone();
    engine
        .set_group_collapsed(&sid, &group_id, false)
        .expect("expand group");

    assert!(engine.get_col_width_query(&sid, 3) > 0.0);
    assert!(!engine.is_col_hidden_query(&sid, 3));
    let group = engine
        .get_group_in_sheet(&sid, &group_id)
        .expect("expanded group");
    assert!(!group.collapsed);
    assert!(!group.hidden);
    let exported_after_expand = engine
        .export_to_parse_output()
        .expect("export after expand")
        .parse_output;
    assert!(
        !exported_after_expand.sheets[0]
            .dimensions
            .col_widths
            .iter()
            .any(|col| col.col == 7 && col.collapsed),
        "expanded outline export must not keep the stale collapsed summary column marker"
    );

    engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("collapse group");
    assert_eq!(engine.get_col_width_query(&sid, 3), 0.0);
    assert!(engine.is_col_hidden_query(&sid, 3));
}

#[test]
fn imported_hidden_outline_rows_expand_to_visible_rows() {
    let mut row_heights: Vec<RowDimension> = (3..=6)
        .map(|row| RowDimension {
            row,
            height: 0.0,
            custom_height: true,
            hidden: true,
            explicit_hidden: true,
            ..Default::default()
        })
        .collect();
    row_heights.push(RowDimension {
        row: 7,
        height: 15.0,
        collapsed: Some(true),
        ..Default::default()
    });

    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Imported".to_string(),
            rows: 20,
            cols: 12,
            dimensions: SheetDimensions {
                row_heights,
                ..Default::default()
            },
            outline_groups: vec![OutlineGroup {
                is_row: true,
                start: 3,
                end: 6,
                level: 1,
                collapsed: true,
                hidden: true,
                collapsed_on_member: false,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut engine = engine_from_parse_output_normal(&input);
    let sid = *engine.mirror().sheet_ids().next().expect("sheet id");

    assert_eq!(engine.get_row_height_query(&sid, 3), 0.0);
    assert!(
        engine.is_row_hidden_query(&sid, 3),
        "imported collapsed outline rows should report hidden before expansion"
    );
    let exported_before_expand = engine
        .export_to_parse_output()
        .expect("export before expand")
        .parse_output;
    assert!(
        exported_before_expand.sheets[0]
            .dimensions
            .row_heights
            .iter()
            .any(|row| row.row == 7 && row.collapsed == Some(true)),
        "imported collapsed summary row marker should be present before expansion"
    );

    let group_id = engine
        .get_groups(&sid, "row")
        .first()
        .expect("row group")
        .id
        .clone();
    engine
        .set_group_collapsed(&sid, &group_id, false)
        .expect("expand group");

    assert!(engine.get_row_height_query(&sid, 3) > 0.0);
    assert!(!engine.is_row_hidden_query(&sid, 3));
    let group = engine
        .get_group_in_sheet(&sid, &group_id)
        .expect("expanded group");
    assert!(!group.collapsed);
    assert!(!group.hidden);
    let exported_after_expand = engine
        .export_to_parse_output()
        .expect("export after expand")
        .parse_output;
    assert!(
        !exported_after_expand.sheets[0]
            .dimensions
            .row_heights
            .iter()
            .any(|row| row.row == 7 && row.collapsed == Some(true)),
        "expanded outline export must not keep the stale collapsed summary row marker"
    );
    assert!(
        !exported_after_expand.sheets[0]
            .dimensions
            .row_heights
            .iter()
            .any(|row| row.row == 3 && row.hidden),
        "expanded outline export must not keep hidden detail rows"
    );

    engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("collapse group");
    assert_eq!(engine.get_row_height_query(&sid, 3), 0.0);
    assert!(engine.is_row_hidden_query(&sid, 3));
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
fn collapsed_outline_group_updates_layout_index_and_defers_viewport_refresh_rows() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 8, 6)
        .expect("register viewport");

    let (_, group_result) = engine.group_rows(&sid, 2, 4).expect("group_rows");
    let group_id = created_group_id(group_result);

    let (collapse_patches, collapse_result) = engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("set_group_collapsed");
    assert_eq!(
        collapse_result
            .visibility_changes
            .iter()
            .map(|change| (change.axis, change.index, change.hidden))
            .collect::<Vec<_>>(),
        vec![
            (Axis::Row, 2, true),
            (Axis::Row, 3, true),
            (Axis::Row, 4, true)
        ],
        "outline collapse must surface effective row visibility transitions"
    );

    let layout = engine.layout_index(&sid).expect("layout index");
    assert_eq!(layout.get_row_height(2).0, 0.0);
    assert_eq!(layout.get_row_height(3).0, 0.0);
    assert_eq!(layout.get_row_height(4).0, 0.0);

    let render_data = engine.build_viewport_render_data(&sid, 0, 0, 8, 6);
    assert_eq!(render_data.row_dimensions[2].height, 0.0);
    assert_eq!(render_data.row_dimensions[3].height, 0.0);
    assert_eq!(render_data.row_dimensions[4].height, 0.0);
    assert!(
        !render_data.row_dimensions[2].hidden,
        "outline collapse affects effective height, not explicit hidden state"
    );

    assert_empty_viewport_patches(&collapse_patches);

    let (expand_patches, expand_result) = engine
        .set_group_collapsed(&sid, &group_id, false)
        .expect("set_group_collapsed");
    assert_eq!(
        expand_result
            .visibility_changes
            .iter()
            .map(|change| (change.axis, change.index, change.hidden))
            .collect::<Vec<_>>(),
        vec![
            (Axis::Row, 2, false),
            (Axis::Row, 3, false),
            (Axis::Row, 4, false)
        ],
        "outline expansion must surface effective row visibility transitions"
    );
    let layout = engine.layout_index(&sid).expect("layout index");
    assert!(layout.get_row_height(2).0 > 0.0);
    assert!(layout.get_row_height(3).0 > 0.0);
    assert!(layout.get_row_height(4).0 > 0.0);

    assert_empty_viewport_patches(&expand_patches);
}

#[test]
fn collapsed_outline_group_updates_layout_index_and_defers_viewport_refresh_columns() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 8, 8)
        .expect("register viewport");

    let (_, group_result) = engine.group_columns(&sid, 3, 6).expect("group_columns");
    let group_id = created_group_id(group_result);

    let (collapse_patches, collapse_result) = engine
        .set_group_collapsed(&sid, &group_id, true)
        .expect("set_group_collapsed");
    assert_eq!(
        collapse_result
            .visibility_changes
            .iter()
            .map(|change| (change.axis, change.index, change.hidden))
            .collect::<Vec<_>>(),
        vec![
            (Axis::Col, 3, true),
            (Axis::Col, 4, true),
            (Axis::Col, 5, true),
            (Axis::Col, 6, true)
        ],
        "outline collapse must surface effective column visibility transitions"
    );

    let layout = engine.layout_index(&sid).expect("layout index");
    assert_eq!(layout.get_col_width(3).0, 0.0);
    assert_eq!(layout.get_col_width(4).0, 0.0);
    assert_eq!(layout.get_col_width(5).0, 0.0);
    assert_eq!(layout.get_col_width(6).0, 0.0);

    let render_data = engine.build_viewport_render_data(&sid, 0, 0, 8, 8);
    assert_eq!(render_data.col_dimensions[3].width, 0.0);
    assert_eq!(render_data.col_dimensions[4].width, 0.0);
    assert_eq!(render_data.col_dimensions[5].width, 0.0);
    assert_eq!(render_data.col_dimensions[6].width, 0.0);
    assert!(
        !render_data.col_dimensions[3].hidden,
        "outline collapse affects effective width, not explicit hidden state"
    );

    assert_empty_viewport_patches(&collapse_patches);
}
