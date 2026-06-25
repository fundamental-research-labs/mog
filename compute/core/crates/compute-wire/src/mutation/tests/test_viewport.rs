use std::collections::HashMap;

use super::super::*;
use super::helpers::*;
use snapshot_types::{CellChange, RecalcResult};
use value_types::CellValue;

use crate::constants::MUTATION_HEADER_SIZE as HEADER_SIZE;
use crate::flags::{self as render_flags};
use crate::types::ViewportBounds;

fn viewport_patch_count(result: &RecalcResult, bounds: ViewportBounds) -> u32 {
    let buf = serialize_mutation_result_for_viewport(result, "s1", 0, bounds, None, None);
    u32::from_le_bytes(buf[0..4].try_into().unwrap())
}

fn frozen_pane_result() -> RecalcResult {
    RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
                value: CellValue::number(1.0),
                display_text: Some("1".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c2".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 5 }),
                value: CellValue::number(2.0),
                display_text: Some("2".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c3".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 5, col: 0 }),
                value: CellValue::number(3.0),
                display_text: Some("3".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c4".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 5, col: 5 }),
                value: CellValue::number(4.0),
                display_text: Some("4".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
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
    }
}

#[test]
fn test_viewport_filter_includes_cells_in_bounds() {
    let result = make_test_result(); // cells at (0,0), (1,3), (2,0)
    // Viewport covers rows 0-1, cols 0-3 — should include cells (0,0) and (1,3)
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        5,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 3,
        },
        None,
        None,
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 2); // (0,0) and (1,3)
    assert_eq!(buf[11], 5); // generation
}

#[test]
fn test_viewport_filter_excludes_cells_outside_bounds() {
    let result = make_test_result(); // cells at (0,0), (1,3), (2,0)
    // Viewport covers rows 5-10, cols 0-5 — no cells in bounds
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 5,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        },
        None,
        None,
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 0);

    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap());
    assert_eq!(string_bytes, 0);
}

#[test]
fn test_viewport_filter_partial_overlap() {
    let result = make_test_result(); // cells at (0,0), (1,3), (2,0)
    // Viewport covers only (2,0) — just the error cell
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 2,
            start_col: 0,
            end_row: 2,
            end_col: 0,
        },
        None,
        None,
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 1);

    // Verify it's the error cell at (2,0)
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;
    let row = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap());
    let col = u32::from_le_bytes(buf[off + 4..off + 8].try_into().unwrap());
    assert_eq!(row, 2);
    assert_eq!(col, 0);

    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_ERROR
    );
}

#[test]
fn test_viewport_empty_result() {
    let result = RecalcResult::empty();
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 100,
            end_col: 100,
        },
        None,
        None,
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 0);
}

#[test]
fn test_viewport_filter_with_four_frozen_panes() {
    // Simulate 4 frozen pane viewports: top-left, top-right, bottom-left, bottom-right
    // Frozen at row=2, col=2
    let result = frozen_pane_result();

    // Top-left (frozen corner): rows 0-1, cols 0-1
    let tl_count = viewport_patch_count(
        &result,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
        },
    );
    assert_eq!(tl_count, 1); // only (0,0)

    // Top-right: rows 0-1, cols 2-10
    let tr_count = viewport_patch_count(
        &result,
        ViewportBounds {
            start_row: 0,
            start_col: 2,
            end_row: 1,
            end_col: 10,
        },
    );
    assert_eq!(tr_count, 1); // only (0,5)

    // Bottom-left: rows 2-10, cols 0-1
    let bl_count = viewport_patch_count(
        &result,
        ViewportBounds {
            start_row: 2,
            start_col: 0,
            end_row: 10,
            end_col: 1,
        },
    );
    assert_eq!(bl_count, 1); // only (5,0)

    // Bottom-right: rows 2-10, cols 2-10
    let br_count = viewport_patch_count(
        &result,
        ViewportBounds {
            start_row: 2,
            start_col: 2,
            end_row: 10,
            end_col: 10,
        },
    );
    assert_eq!(br_count, 1); // only (5,5)
}

#[test]
fn test_no_viewports_produces_empty_header() {
    let buf = serialize_multi_viewport_patches(&[]);
    assert_eq!(buf.len(), 2);
    assert_eq!(u16::from_le_bytes(buf[0..2].try_into().unwrap()), 0);
}
