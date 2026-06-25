use std::collections::HashMap;

use super::super::*;
use snapshot_types::{CellChange, RecalcResult};
use value_types::CellValue;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, NO_STRING, PATCH_STRIDE};
use crate::flags::{self as render_flags, MUT_HAS_ERRORS, MUT_HAS_PROJECTION_CHANGES};
use crate::types::ViewportBounds;

fn pooled_text(buf: &[u8], pool_start: usize, patch_start: usize) -> &str {
    let offset =
        u32::from_le_bytes(buf[patch_start + 16..patch_start + 20].try_into().unwrap()) as usize;
    let len =
        u16::from_le_bytes(buf[patch_start + 28..patch_start + 30].try_into().unwrap()) as usize;
    std::str::from_utf8(&buf[pool_start + offset..pool_start + offset + len]).unwrap()
}

fn projection_section(buf: &[u8]) -> (usize, usize, usize) {
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_start = pool_start + string_bytes;
    let proj_count =
        u32::from_le_bytes(buf[proj_start..proj_start + 4].try_into().unwrap()) as usize;

    (pool_start, proj_start, proj_count)
}

fn assert_spill_bool(buf: &[u8], pool_start: usize, patch_start: usize, value: bool, text: &str) {
    let flags = u16::from_le_bytes(buf[patch_start + 24..patch_start + 26].try_into().unwrap());
    assert_eq!(
        flags,
        render_flags::IS_SPILL_MEMBER | render_flags::VALUE_TYPE_BOOL
    );

    let number_value =
        f64::from_le_bytes(buf[patch_start + 8..patch_start + 16].try_into().unwrap());
    assert_eq!(number_value, if value { 1.0 } else { 0.0 });
    if !value {
        assert!(!number_value.is_nan());
    }
    assert_eq!(pooled_text(buf, pool_start, patch_start), text);
}

fn assert_spill_null(buf: &[u8], patch_start: usize) {
    let flags = u16::from_le_bytes(buf[patch_start + 24..patch_start + 26].try_into().unwrap());
    assert_eq!(
        flags,
        render_flags::IS_SPILL_MEMBER | render_flags::VALUE_TYPE_NULL
    );

    let display_offset =
        u32::from_le_bytes(buf[patch_start + 16..patch_start + 20].try_into().unwrap());
    assert_eq!(display_offset, NO_STRING);

    let number_value =
        f64::from_le_bytes(buf[patch_start + 8..patch_start + 16].try_into().unwrap());
    assert!(number_value.is_nan());
}

#[test]
fn test_viewport_spill_filtered_by_bounds() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::number(10.0),
            display_text: Some("10".into()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: Some(0),
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "c1".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                snapshot_types::ProjectionCellData {
                    cell_id: "sp1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::number(20.0),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::number(30.0),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp3".into(),
                    row: 3,
                    col: 0,
                    value: CellValue::number(40.0),
                },
            ],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    // Bounds (0,0,1,1) should include the changed cell at (0,0)
    // and only the spill cell at (1,0), excluding (2,0) and (3,0)
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
        },
        None,
        None,
    );

    // Header flag should indicate projection changes
    assert_ne!(buf[10] & MUT_HAS_PROJECTION_CHANGES, 0);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    assert_eq!(patch_count, 1); // only (0,0) changed cell

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_section_start = pool_start + string_bytes;

    let proj_count = u32::from_le_bytes(
        buf[proj_section_start..proj_section_start + 4]
            .try_into()
            .unwrap(),
    );
    assert_eq!(proj_count, 1); // only spill cell at (1,0)

    // Verify it's the cell at row=1
    let sp0 = proj_section_start + 4;
    let sp0_row = u32::from_le_bytes(buf[sp0..sp0 + 4].try_into().unwrap());
    assert_eq!(sp0_row, 1);
}

#[test]
fn test_mutation_cf_colors_for_viewport() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
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
        }],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let mut cf_colors = CfColorOverrides::default();
    cf_colors.insert(0, 0, 0xAABBCCDD, 0x11223344);

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 10,
        },
        None,
        Some(&cf_colors),
    );

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    let bg = u32::from_le_bytes(buf[off + 32..off + 36].try_into().unwrap());
    let font = u32::from_le_bytes(buf[off + 36..off + 40].try_into().unwrap());
    assert_eq!(bg, 0xAABBCCDD);
    assert_eq!(font, 0x11223344);
}

#[test]
fn test_viewport_boolean_and_array_cells() {
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
                value: CellValue::Boolean(true),
                display_text: Some("TRUE".into()),
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
                position: Some(snapshot_types::CellPosition { row: 0, col: 1 }),
                value: CellValue::Boolean(false),
                display_text: Some("FALSE".into()),
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
                position: Some(snapshot_types::CellPosition { row: 1, col: 0 }),
                value: CellValue::Array(std::sync::Arc::new(value_types::CellArray::from_rows(
                    vec![vec![CellValue::number(1.0)]],
                ))),
                display_text: Some("{1}".into()),
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
    };

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
        },
        None,
        None,
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    assert_eq!(patch_count, 3);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;

    // Boolean(true) at (0,0): VALUE_TYPE_BOOL, number_value = 1.0
    let p0 = HEADER_SIZE + sheet_id_len;
    let p0_flags = u16::from_le_bytes(buf[p0 + 24..p0 + 26].try_into().unwrap());
    assert_eq!(
        p0_flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
    let p0_num = f64::from_le_bytes(buf[p0 + 8..p0 + 16].try_into().unwrap());
    assert_eq!(p0_num, 1.0);

    // Boolean(false) at (0,1): VALUE_TYPE_BOOL, number_value = 0.0
    let p1 = p0 + PATCH_STRIDE;
    let p1_flags = u16::from_le_bytes(buf[p1 + 24..p1 + 26].try_into().unwrap());
    assert_eq!(
        p1_flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
    let p1_num = f64::from_le_bytes(buf[p1 + 8..p1 + 16].try_into().unwrap());
    assert_eq!(p1_num, 0.0);
    assert!(!p1_num.is_nan());

    // Array at (1,0): VALUE_TYPE_NUMBER (arrays map to number), number_value is NaN
    let p2 = p1 + PATCH_STRIDE;
    let p2_flags = u16::from_le_bytes(buf[p2 + 24..p2 + 26].try_into().unwrap());
    assert_eq!(
        p2_flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NUMBER
    );
    let p2_num = f64::from_le_bytes(buf[p2 + 8..p2 + 16].try_into().unwrap());
    assert!(p2_num.is_nan());

    // Verify display text for array cell
    let p2_d_off = u32::from_le_bytes(buf[p2 + 16..p2 + 20].try_into().unwrap()) as usize;
    let p2_d_len = u16::from_le_bytes(buf[p2 + 28..p2 + 30].try_into().unwrap()) as usize;
    let p2_text =
        std::str::from_utf8(&buf[pool_start + p2_d_off..pool_start + p2_d_off + p2_d_len]).unwrap();
    assert_eq!(p2_text, "{1}");

    // String pool should contain exactly "TRUE" + "FALSE" + "{1}" bytes
    assert_eq!(string_bytes, "TRUE".len() + "FALSE".len() + "{1}".len());
}

#[test]
fn test_viewport_unresolved_positions_filtered() {
    // sub-scope sub-scope D: `CellChange.position: None` is the unresolved
    // signal; both `u32::MAX`-style sentinels are gone from the wire shape.
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: None,
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
                position: None,
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
                position: Some(snapshot_types::CellPosition { row: 1, col: 1 }),
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
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    // Use bounds that would include all valid positions
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: u32::MAX,
            end_col: u32::MAX,
        },
        None,
        None,
    );

    // Only (1,1) should survive; the two unresolved cells are skipped before bounds check
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 1);

    // Verify the surviving cell is at (1,1)
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;
    let row = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap());
    let col = u32::from_le_bytes(buf[off + 4..off + 8].try_into().unwrap());
    assert_eq!(row, 1);
    assert_eq!(col, 1);
}

#[test]
fn test_viewport_spill_text_and_error() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c0".into(),
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
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "c0".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                snapshot_types::ProjectionCellData {
                    cell_id: "sp1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("spill text".into()),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::Error(value_types::CellError::Na, None),
                },
            ],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 5,
        },
        None,
        None,
    );

    // MUT_HAS_PROJECTION_CHANGES flag should be set
    assert_ne!(buf[10] & MUT_HAS_PROJECTION_CHANGES, 0);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_start = pool_start + string_bytes;

    let proj_count =
        u32::from_le_bytes(buf[proj_start..proj_start + 4].try_into().unwrap()) as usize;
    assert_eq!(proj_count, 2);

    // First spill cell: Text("spill text")
    let sp0 = proj_start + 4;
    let sp0_flags = u16::from_le_bytes(buf[sp0 + 24..sp0 + 26].try_into().unwrap());
    assert_eq!(
        sp0_flags,
        render_flags::IS_SPILL_MEMBER | render_flags::VALUE_TYPE_TEXT
    );
    let sp0_d_off = u32::from_le_bytes(buf[sp0 + 16..sp0 + 20].try_into().unwrap()) as usize;
    let sp0_d_len = u16::from_le_bytes(buf[sp0 + 28..sp0 + 30].try_into().unwrap()) as usize;
    let sp0_text =
        std::str::from_utf8(&buf[pool_start + sp0_d_off..pool_start + sp0_d_off + sp0_d_len])
            .unwrap();
    assert_eq!(sp0_text, "spill text");

    // Second spill cell: Error(Na)
    let sp1 = sp0 + PATCH_STRIDE;
    let sp1_flags = u16::from_le_bytes(buf[sp1 + 24..sp1 + 26].try_into().unwrap());
    assert_eq!(
        sp1_flags,
        render_flags::IS_SPILL_MEMBER | render_flags::VALUE_TYPE_ERROR
    );
    // Display text "#N/A"
    let sp1_d_off = u32::from_le_bytes(buf[sp1 + 16..sp1 + 20].try_into().unwrap()) as usize;
    let sp1_d_len = u16::from_le_bytes(buf[sp1 + 28..sp1 + 30].try_into().unwrap()) as usize;
    let sp1_display =
        std::str::from_utf8(&buf[pool_start + sp1_d_off..pool_start + sp1_d_off + sp1_d_len])
            .unwrap();
    assert_eq!(sp1_display, "#N/A");
    // Error string "#N/A" in error pool
    let sp1_e_off = u32::from_le_bytes(buf[sp1 + 20..sp1 + 24].try_into().unwrap()) as usize;
    let sp1_e_len = u16::from_le_bytes(buf[sp1 + 30..sp1 + 32].try_into().unwrap()) as usize;
    let sp1_error =
        std::str::from_utf8(&buf[pool_start + sp1_e_off..pool_start + sp1_e_off + sp1_e_len])
            .unwrap();
    assert_eq!(sp1_error, "#N/A");
}

#[test]
fn test_viewport_spill_boolean_and_null() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c0".into(),
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
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "c0".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                snapshot_types::ProjectionCellData {
                    cell_id: "sp1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::Boolean(true),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::Boolean(false),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp3".into(),
                    row: 3,
                    col: 0,
                    value: CellValue::Null,
                },
            ],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 5,
        },
        None,
        None,
    );

    let (pool_start, proj_start, proj_count) = projection_section(&buf);
    assert_eq!(proj_count, 3);

    // Boolean(true) spill at (1,0)
    let sp0 = proj_start + 4;
    assert_spill_bool(&buf, pool_start, sp0, true, "TRUE");

    // Boolean(false) spill at (2,0)
    let sp1 = sp0 + PATCH_STRIDE;
    assert_spill_bool(&buf, pool_start, sp1, false, "FALSE");

    // Null spill at (3,0)
    let sp2 = sp1 + PATCH_STRIDE;
    assert_spill_null(&buf, sp2);
}

#[test]
fn test_viewport_spill_array() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c0".into(),
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
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "c0".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![snapshot_types::ProjectionCellData {
                cell_id: "sp1".into(),
                row: 1,
                col: 0,
                value: CellValue::Array(std::sync::Arc::new(value_types::CellArray::from_rows(
                    vec![vec![CellValue::number(1.0), CellValue::number(2.0)]],
                ))),
            }],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 5,
        },
        None,
        None,
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_start = pool_start + string_bytes;

    let proj_count =
        u32::from_le_bytes(buf[proj_start..proj_start + 4].try_into().unwrap()) as usize;
    assert_eq!(proj_count, 1);

    let sp0 = proj_start + 4;
    let sp0_flags = u16::from_le_bytes(buf[sp0 + 24..sp0 + 26].try_into().unwrap());
    assert_eq!(
        sp0_flags,
        render_flags::IS_SPILL_MEMBER | render_flags::VALUE_TYPE_NUMBER
    );

    let sp0_num = f64::from_le_bytes(buf[sp0 + 8..sp0 + 16].try_into().unwrap());
    assert!(sp0_num.is_nan());

    // Display text should be "{...}"
    let sp0_d_off = u32::from_le_bytes(buf[sp0 + 16..sp0 + 20].try_into().unwrap()) as usize;
    let sp0_d_len = u16::from_le_bytes(buf[sp0 + 28..sp0 + 30].try_into().unwrap()) as usize;
    let sp0_text =
        std::str::from_utf8(&buf[pool_start + sp0_d_off..pool_start + sp0_d_off + sp0_d_len])
            .unwrap();
    assert_eq!(sp0_text, "{...}");
}

#[test]
fn test_viewport_errors_flag() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
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
        }],
        projection_changes: vec![],
        errors: vec![snapshot_types::CellErrorInfo {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            error: "div0".into(),
        }],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 5,
        },
        None,
        None,
    );

    // MUT_HAS_ERRORS (bit 1) should be set
    assert_eq!(buf[10] & MUT_HAS_ERRORS, MUT_HAS_ERRORS);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 1);
}

#[test]
fn test_viewport_spill_cf_colors() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c0".into(),
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
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "c0".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                snapshot_types::ProjectionCellData {
                    cell_id: "sp1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::number(10.0),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::number(20.0),
                },
            ],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let mut cf_colors = CfColorOverrides::default();
    cf_colors.insert(1, 0, 0xAABBCCDD, 0x11223344);
    cf_colors.insert(2, 0, 0x55667788, 0x99AABBCC);

    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 5,
        },
        None,
        Some(&cf_colors),
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_start = pool_start + string_bytes;

    let proj_count =
        u32::from_le_bytes(buf[proj_start..proj_start + 4].try_into().unwrap()) as usize;
    assert_eq!(proj_count, 2);

    // First spill cell (1,0): bg=0xAABBCCDD, font=0x11223344
    let sp0 = proj_start + 4;
    let sp0_bg = u32::from_le_bytes(buf[sp0 + 32..sp0 + 36].try_into().unwrap());
    let sp0_font = u32::from_le_bytes(buf[sp0 + 36..sp0 + 40].try_into().unwrap());
    assert_eq!(sp0_bg, 0xAABBCCDD);
    assert_eq!(sp0_font, 0x11223344);

    // Second spill cell (2,0): bg=0x55667788, font=0x99AABBCC
    let sp1 = sp0 + PATCH_STRIDE;
    let sp1_bg = u32::from_le_bytes(buf[sp1 + 32..sp1 + 36].try_into().unwrap());
    let sp1_font = u32::from_le_bytes(buf[sp1 + 36..sp1 + 40].try_into().unwrap());
    assert_eq!(sp1_bg, 0x55667788);
    assert_eq!(sp1_font, 0x99AABBCC);
}
